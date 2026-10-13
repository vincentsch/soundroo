// Finds soundroo-cloud, the Rungrad CLI that performs every network request.
// Order: SOUNDROO_CLOUD_BIN, else a verified prebuilt binary from the service
// the user chose to share with. A download happens only for an explicit
// network command: never for start, render, compose or --dry-run.
//
// The service publishes <origin>/downloads/cli/manifest.json:
//   {"name":"soundroo-cloud","version":"0.1.0","protocol":1,
//    "platforms":{"linux-amd64":{"url":"0.1.0/soundroo-cloud_0.1.0_linux_amd64","sha256":"…","size":123}}}
// Binary URLs resolve against the manifest and must stay on the same origin.
// Size and SHA-256 are checked while downloading, the file is renamed into
// place only when both match, and it is checked again before every run. A
// cached binary serves only the services that vouched for it: the one it was
// downloaded from and any whose manifest listed the same build.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { sameOrigin } from './origin.js';
import { ShareError } from './errors.js';

export const CLOUD_PROTOCOL = 1;
export const MANIFEST_PATH = '/downloads/cli/manifest.json';
export const BINARY_ENV = 'SOUNDROO_CLOUD_BIN';
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_BINARY_BYTES = 96 * 1024 * 1024;

export function platformKey(platform = process.platform, arch = process.arch) {
  const goos = { linux: 'linux', darwin: 'darwin', win32: 'windows' }[platform];
  const goarch = { x64: 'amd64', arm64: 'arm64' }[arch];
  return goos && goarch ? `${goos}-${goarch}` : null;
}

export const binaryName = (platform = process.platform) => (platform === 'win32' ? 'soundroo-cloud.exe' : 'soundroo-cloud');

export function cacheDir(env = process.env) {
  return path.join(env.SOUNDROO_CACHE || path.join(os.homedir(), '.cache', 'soundroo'), 'cloud');
}

function fileSha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function verified(file, sha256, size) {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && (size == null || stat.size === size) && fileSha256(file) === sha256;
  } catch { return false; }
}

const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

// Validates the manifest and returns this platform's entry.
export function manifestEntry(manifest, key, manifestUrl, origin) {
  const fail = message => new ShareError(`The service's soundroo-cloud manifest is unusable: ${message}`, { code: 'bad_manifest', exitCode: 2 });
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw fail('it is not a JSON object.');
  if (manifest.name !== 'soundroo-cloud') throw fail('it names another program.');
  if (manifest.protocol !== CLOUD_PROTOCOL) throw new ShareError(`The service offers soundroo-cloud protocol ${manifest.protocol}; this toolkit understands protocol ${CLOUD_PROTOCOL}. Update the Soundroo toolkit.`, { code: 'protocol_mismatch', exitCode: 2 });
  if (typeof manifest.version !== 'string' || !SEMVER.test(manifest.version)) throw fail('the version is missing.');
  const entry = manifest.platforms?.[key];
  if (!entry || typeof entry !== 'object') throw new ShareError(`The service has no soundroo-cloud build for ${key}. Build it from cloud-cli with Go and set ${BINARY_ENV}.`, { code: 'unsupported_platform', exitCode: 2 });
  if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw fail('the SHA-256 is missing.');
  if (!Number.isSafeInteger(entry.size) || entry.size <= 0 || entry.size > MAX_BINARY_BYTES) throw fail('the size is missing or too large.');
  let url;
  try { url = new URL(entry.url, manifestUrl).href; } catch { throw fail('the download URL is invalid.'); }
  if (!sameOrigin(origin, url)) throw new ShareError(`The manifest points to ${new URL(url).origin}; soundroo-cloud is only downloaded from ${origin}.`, { code: 'cross_origin_download', exitCode: 2 });
  return { version: manifest.version, sha256: entry.sha256, size: entry.size, url };
}

// GET that follows redirects only within the origin.
export async function fetchSameOrigin(url, origin, { fetchImpl = globalThis.fetch, timeoutMs = 60_000 } = {}) {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!sameOrigin(origin, current)) throw new ShareError(`${origin} redirected the download to another address (${new URL(current).origin}); refusing.`, { code: 'redirect_refused', exitCode: 2 });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(current, { redirect: 'manual', signal: controller.signal, headers: { accept: 'application/json, application/octet-stream' } });
    } catch (error) {
      clearTimeout(timer);
      const reason = error?.name === 'AbortError' ? 'the request timed out' : (error?.cause?.code ?? error?.message ?? 'unknown error');
      throw new ShareError(`Could not reach ${origin}: ${reason}.`, { code: 'network', exitCode: 2 });
    }
    clearTimeout(timer);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new ShareError(`${origin} sent a redirect without a location.`, { code: 'download_failed', exitCode: 2 });
      current = new URL(location, current).href;
      continue;
    }
    if (!response.ok) {
      throw new ShareError(response.status === 404 ? `${origin} does not offer soundroo-cloud downloads.` : `${origin} answered HTTP ${response.status} for ${new URL(current).pathname}.`, { code: response.status === 404 ? 'binary_unavailable' : 'download_failed', exitCode: 2, status: response.status, hint: `Build it from cloud-cli with Go (go build -o soundroo-cloud .) and set ${BINARY_ENV} to its path.` });
    }
    return response;
  }
  throw new ShareError(`${origin} redirected too many times.`, { code: 'redirect_refused', exitCode: 2 });
}

async function readLimited(response, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > limit) throw new ShareError('The service sent an unexpectedly large manifest.', { code: 'bad_manifest', exitCode: 2 });
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function fetchManifest(origin, options = {}) {
  const url = origin + MANIFEST_PATH;
  const response = await fetchSameOrigin(url, origin, { ...options, timeoutMs: 20_000 });
  const body = await readLimited(response, MAX_MANIFEST_BYTES);
  try { return { url: response.url && sameOrigin(origin, response.url) ? response.url : url, manifest: JSON.parse(body.toString('utf8')) }; } catch { throw new ShareError('The service sent a soundroo-cloud manifest that is not JSON.', { code: 'bad_manifest', exitCode: 2 }); }
}

function readRecord(folder) {
  try { return JSON.parse(fs.readFileSync(path.join(folder, 'binary.json'), 'utf8')); } catch { return null; }
}

const vouchedBy = (record, origin) => record.origin === origin || (Array.isArray(record.origins) && record.origins.includes(origin));

// binary.json names the services whose manifests listed this exact build.
function recordOrigin(folder, entry, key, origin) {
  const previous = readRecord(folder);
  const known = previous?.sha256 === entry.sha256 ? previous : null;
  if (known && Array.isArray(known.origins) && known.origins.includes(origin)) return;
  const origins = [...new Set([...(known?.origins ?? (known?.origin ? [known.origin] : [])), origin])];
  const record = { name: 'soundroo-cloud', version: entry.version, sha256: entry.sha256, size: entry.size, platform: key, origin: known?.origin ?? origin, origins, installedAt: known?.installedAt ?? new Date().toISOString() };
  fs.writeFileSync(path.join(folder, 'binary.json'), JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
}

// Downloads, verifies and installs one binary; returns its path.
export async function installBinary(entry, { origin, dir, fetchImpl, key, onProgress = () => {} }) {
  const folder = path.join(dir, entry.sha256);
  const target = path.join(folder, binaryName());
  // The same build from another service: this origin's manifest vouches for
  // it too, so it is reused without a download.
  if (verified(target, entry.sha256, entry.size)) {
    try { recordOrigin(folder, entry, key, origin); } catch { /* verified for this run; only the offline fallback misses it */ }
    return { path: target, downloaded: false };
  }
  onProgress({ stage: 'download', version: entry.version, size: entry.size });
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const temp = path.join(folder, `.${crypto.randomBytes(6).toString('hex')}.part`);
  const response = await fetchSameOrigin(entry.url, origin, { fetchImpl, timeoutMs: 5 * 60_000 });
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > entry.size) throw new ShareError('The soundroo-cloud download is larger than the manifest says; refusing.', { code: 'binary_integrity', exitCode: 2 });
  const hash = crypto.createHash('sha256');
  let size = 0;
  const handle = await fs.promises.open(temp, 'wx', 0o600);
  try {
    for await (const chunk of response.body ?? []) {
      size += chunk.length;
      if (size > entry.size) throw new ShareError('The soundroo-cloud download is larger than the manifest says; refusing.', { code: 'binary_integrity', exitCode: 2 });
      hash.update(chunk);
      await handle.write(chunk);
    }
  } catch (error) {
    await handle.close().catch(() => {});
    fs.rmSync(temp, { force: true });
    throw error;
  }
  await handle.close();
  const digest = hash.digest('hex');
  if (size !== entry.size || digest !== entry.sha256) {
    fs.rmSync(temp, { force: true });
    throw new ShareError('The downloaded soundroo-cloud does not match the SHA-256 and size the service published; it was discarded.', { code: 'binary_integrity', exitCode: 2 });
  }
  fs.chmodSync(temp, 0o755);
  fs.rmSync(target, { force: true });
  fs.renameSync(temp, target);
  recordOrigin(folder, entry, key, origin);
  return { path: target, downloaded: true };
}

// The newest verified cached binary for this platform that this origin
// vouched for. A binary from another service is never used for this one: it
// would read this service's key.
export function cachedBinary({ origin, env = process.env, key = platformKey() } = {}) {
  const dir = cacheDir(env);
  if (!fs.existsSync(dir)) return null;
  const found = [];
  for (const name of fs.readdirSync(dir)) {
    if (!/^[a-f0-9]{64}$/.test(name)) continue;
    const record = readRecord(path.join(dir, name));
    if (record?.platform === key && record.sha256 === name && vouchedBy(record, origin)) found.push(record);
  }
  found.sort((a, b) => String(b.installedAt).localeCompare(String(a.installedAt)));
  for (const record of found) {
    const file = path.join(dir, record.sha256, binaryName());
    if (verified(file, record.sha256, record.size)) return { path: file, version: record.version, sha256: record.sha256, source: 'cache' };
  }
  return null;
}

// Returns {path, source, version?} or throws. download: false never touches
// the network and returns null when nothing is installed.
export async function ensureBinary({ origin, env = process.env, fetchImpl = globalThis.fetch, download = true, onProgress = () => {} } = {}) {
  const override = env[BINARY_ENV];
  if (override) {
    if (!fs.existsSync(override) || !fs.statSync(override).isFile()) throw new ShareError(`${BINARY_ENV} points to ${override}, which is not a file.`, { code: 'binary_missing', exitCode: 2 });
    return { path: path.resolve(override), source: 'env' };
  }
  const key = platformKey();
  if (!key) throw new ShareError(`There is no prebuilt soundroo-cloud for ${process.platform}/${process.arch}. Build it from cloud-cli with Go and set ${BINARY_ENV}.`, { code: 'unsupported_platform', exitCode: 2 });
  if (!download) return cachedBinary({ origin, env, key });
  let failure;
  try {
    const { manifest, url } = await fetchManifest(origin, { fetchImpl });
    const entry = manifestEntry(manifest, key, url, origin);
    const cached = cachedBinary({ origin, env, key });
    if (cached?.sha256 === entry.sha256) return cached;
    const installed = await installBinary(entry, { origin, dir: cacheDir(env), fetchImpl, key, onProgress });
    return { path: installed.path, version: entry.version, sha256: entry.sha256, source: installed.downloaded ? 'download' : 'cache' };
  } catch (error) {
    if (error instanceof ShareError && ['protocol_mismatch', 'binary_integrity', 'cross_origin_download', 'redirect_refused'].includes(error.code)) throw error;
    failure = error;
  }
  // The service may not offer downloads (yet); a verified binary it vouched
  // for earlier still works.
  const cached = cachedBinary({ origin, env, key });
  if (cached) return { ...cached, stale: true };
  throw failure instanceof ShareError ? failure : new ShareError(`Could not get soundroo-cloud from ${origin}: ${failure?.message ?? failure}`, { code: 'binary_unavailable', exitCode: 2 });
}
