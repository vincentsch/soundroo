// Explicit sharing of a library: local checks, then soundroo-cloud for every
// network request. The CLI's share command and the studio's Share dialog both
// run this. A dry run reads the library and nothing else.
import { libraryPath } from '../project.js';
import { resolveService } from './origin.js';
import { prepareRelease, withLibraryUid, UPLOADS, STAYS_LOCAL } from './payload.js';
import { readSharing, serviceState, ensureLibraryUid, updateService, idempotencyFor } from './state.js';
import { ensureBinary, cachedBinary, MANIFEST_PATH, BINARY_ENV } from './binary.js';
import { checkProtocol, cloudCommand } from './runner.js';
import { ShareError } from './errors.js';

export function serviceOrigin(service, env = process.env) {
  try { return resolveService(service, env); } catch (error) { throw new ShareError(error.message, { code: 'invalid_service', exitCode: 1 }); }
}

// How a dry run describes soundroo-cloud, from local files only.
export function toolStatus(origin, env, use = 'share') {
  const status = env[BINARY_ENV] ? 'from ' + BINARY_ENV : cachedBinary({ origin, env }) ? 'installed' : `downloaded on the first real ${use}`;
  return { name: 'soundroo-cloud', status, manifest: origin + MANIFEST_PATH };
}

// Resolves and checks soundroo-cloud, then returns a bound command runner.
export async function connect(origin, { env = process.env, fetchImpl, download = true, onProgress } = {}) {
  const binary = await ensureBinary({ origin, env, fetchImpl, download, onProgress });
  if (!binary) return null;
  await checkProtocol(binary.path, { env });
  return { binary, cloud: cloudCommand(binary.path, origin, { env }) };
}

const finished = status => status === 'ready' || status === 'failed';
const sleep = (ms, signal) => new Promise(resolve => { const timer = setTimeout(resolve, ms); signal?.addEventListener?.('abort', () => { clearTimeout(timer); resolve(); }, { once: true }); });

function progressOf(release) {
  const tracks = release?.tracks ?? [];
  return { ready: tracks.filter(t => t.status === 'ready').length, failed: tracks.filter(t => t.status === 'failed').length, total: tracks.length };
}

// Links and choices worth remembering in sharing.json. No keys, no claim links.
function remember(directory, origin, published, prepared) {
  const now = new Date().toISOString();
  return updateService(directory, origin, service => {
    const tracks = { ...(service.tracks ?? {}) };
    for (const t of published.tracks ?? []) {
      if (!t.localId) continue;
      const sent = prepared?.tracks.find(p => p.localId === t.localId);
      tracks[t.localId] = { id: t.id, url: t.url, shortUrl: t.shortUrl, status: t.status, access: t.access || sent?.access, visibility: t.visibility || sent?.visibility || undefined, revision: sent?.clientRevision ?? tracks[t.localId]?.revision, ...(t.error ? { error: t.error } : {}), sharedAt: sent ? now : tracks[t.localId]?.sharedAt };
    }
    const next = {
      ...service,
      collection: published.collection?.id ? published.collection : service.collection,
      ...(published.artist ? { artist: { handle: published.artist.handle, name: published.artist.name, url: published.artist.url } } : {}),
      tracks,
      lastRelease: { ...(service.lastRelease ?? {}), id: published.release.id, status: published.release.status, statusUrl: published.release.statusUrl, ...(prepared ? { payloadSha256: prepared.sha256, idempotencyKey: published.idempotencyKey, createdAt: now } : {}) },
    };
    if (prepared) delete next.pending;
    return next;
  });
}

function summary(origin, directory, uid, published, extra = {}) {
  return {
    service: origin,
    library: directory,
    libraryUid: uid,
    status: published.release.status,
    release: { id: published.release.id, status: published.release.status, replayed: Boolean(published.release.replayed) },
    collection: published.collection ?? null,
    artist: published.artist ?? null,
    tracks: (published.tracks ?? []).map(t => ({ localId: t.localId, title: t.title, id: t.id, url: t.url, shortUrl: t.shortUrl, status: t.status, access: t.access, visibility: t.visibility, ...(t.error ? { error: t.error } : {}) })),
    claimUrl: published.claimUrl ?? null,
    ...extra,
  };
}

// A claim link this computer saved for the artist page, if any: the guest key's
// own, or the guest page kept when an account was connected before claiming.
function savedClaimLink(handle, key) {
  if (!handle) return null;
  if (key?.formerGuest?.artist?.handle === handle && key.formerGuest.claimUrl) return key.formerGuest.claimUrl;
  if (key?.kind === 'guest' && !key.claimed && key.artist?.handle === handle && key.claimUrl) return key.claimUrl;
  return null;
}

// The way back is always the artist page that shared the music: claim it while
// signed in, then log in with that account. A new guest artist would be refused
// as another artist's music, so it is never suggested.
function identityError(kind, { origin, sharedAs, key, cause }) {
  const host = new URL(origin).host;
  const page = sharedAs ? `@${sharedAs}` : 'the artist page that shared it';
  const claimUrl = savedClaimLink(sharedAs, key);
  const claim = claimUrl ? `open ${page}'s claim link below while signed in to your Soundroo account` : `open ${page}'s claim link while signed in to your Soundroo account (your first share and logout printed it)`;
  const login = 'node bin/soundroo.js login';
  if (kind === 'missing') {
    return new ShareError(`This library was shared on ${host} as ${page}, and this computer has no key for it.`, {
      code: 'key_missing', exitCode: 3, claimUrl,
      hint: `To update it, sign in as its owner: if ${page} is a guest page that is not claimed yet, first ${claim}. Then run ${login} and share again.`,
    });
  }
  const fromEnv = key?.source === 'env';
  if (kind === 'rejected') {
    const own = fromEnv ? 'the key in SOUNDROO_TOKEN' : `the key stored for ${key?.artist?.handle ? `@${key.artist.handle}` : 'this service'}`;
    return new ShareError(`${host} did not accept ${own}; it may have expired or been revoked.`, {
      code: cause?.code ?? 'auth_invalid', exitCode: 3, status: cause?.status, claimUrl,
      hint: fromEnv ? 'Check the value of SOUNDROO_TOKEN, or unset it to use the stored key.' : `If ${page} is a guest page that is not claimed yet, ${claim}. Then run ${login} and share again.`,
    });
  }
  const current = key?.artist?.handle ? `@${key.artist.handle}` : null;
  const former = claimUrl && current && key.formerGuest?.artist?.handle === sharedAs;
  const who = current ? `this computer now publishes as ${current}, which` : fromEnv ? 'the key in SOUNDROO_TOKEN' : "this computer's key";
  return new ShareError(`This library was shared as ${page}, and ${who} cannot update that collection.`, {
    code: 'artist_mismatch', exitCode: 4, claimUrl,
    hint: former
      ? `${page} is the guest page you shared with before connecting ${current}. Open its claim link below while signed in to Soundroo as ${current}; the music moves into your account. Then share again.`
      : `Sign in as the owner of ${page}: if it is a guest page that is not claimed yet, ${claim}. Then run ${login} with that account and share again.`,
  });
}

// Before updating a collection this library shared: the stored key must exist
// and the service must let it edit that collection (canEdit). A guest page
// claimed into an account passes with that account, whatever its handle. The
// answer also carries the tracks' current choices, so an update never flips a
// visibility or access changed on the website.
async function checkUpdate(cloud, origin, recorded) {
  const key = (await cloud(['auth', 'status'])).key ?? {};
  const sharedAs = recorded.artist?.handle ?? null;
  if (!key.present) throw identityError('missing', { origin, sharedAs, key });
  let shown = null;
  try {
    shown = await cloud(['collection', 'show', recorded.collection.id]);
  } catch (error) {
    if (error.exitCode === 3) throw identityError('rejected', { origin, sharedAs, key, cause: error });
    if (error.exitCode !== 5) throw error;
  }
  // Not visible at all: deleted on the service, or private to another artist.
  const owner = typeof shown?.artist === 'string' && shown.artist.startsWith('@') ? shown.artist.slice(1) : sharedAs;
  const mismatch = shown ? shown.canEdit === false : Boolean(key.artist?.handle && sharedAs && key.artist.handle !== sharedAs);
  if (mismatch) throw identityError('mismatch', { origin, sharedAs: owner, key });
  const known = shown ? { collection: { visibility: shown.visibility }, tracks: Object.fromEntries((shown.tracks ?? []).filter(t => t.localId).map(t => [t.localId, { visibility: t.visibility, access: t.access, id: t.id }])) } : undefined;
  return { known, key };
}

export async function followRelease(cloud, id, { timeoutMs = 15 * 60_000, intervalMs = 3000, onProgress = () => {}, signal } = {}) {
  const deadline = Date.now() + timeoutMs;
  let release;
  for (;;) {
    release = await cloud(['release', 'show', id]);
    onProgress({ stage: 'rendering', ...progressOf(release), status: release.release?.status });
    if (finished(release.release?.status) || Date.now() >= deadline || signal?.aborted) return release;
    await sleep(intervalMs, signal);
  }
}

export async function shareLibrary(directory, options = {}) {
  const { service, tracks, visibility, access, brief, artist, rightsAccepted = false, dryRun = false, wait = true, timeoutMs = 15 * 60_000, force = false, env = process.env, fetchImpl, onProgress = () => {}, signal, intervalMs } = options;
  directory = libraryPath(directory);
  const origin = serviceOrigin(service, env);
  // Local checks come first: nothing is downloaded or sent for music that is
  // not ready.
  let prepared = prepareRelease(directory, { origin, tracks, visibility, access, brief, rightsAccepted });
  if (dryRun) {
    const state = readSharing(directory);
    const pending = serviceState(state, origin).pending;
    return {
      dryRun: true,
      service: origin,
      library: directory,
      request: { method: 'POST', path: '/api/v1/releases', bytes: prepared.bytes.length, payloadSha256: prepared.sha256, idempotencyKey: pending?.payloadSha256 === prepared.sha256 ? pending.idempotencyKey : null },
      libraryUid: prepared.libraryUid,
      collection: prepared.collection,
      tracks: prepared.tracks,
      skipped: prepared.skipped,
      uploads: UPLOADS,
      staysLocal: STAYS_LOCAL,
      rightsAccepted: rightsAccepted === true,
      tool: toolStatus(origin, env),
      changes: 'none',
    };
  }
  if (rightsAccepted !== true) {
    throw new ShareError('Sharing needs confirmation that you have the right to share this music.', { code: 'rights_not_accepted', hint: 'Pass --rights-accepted only after the person sharing the music agreed. Run with --dry-run to review what would be uploaded.' });
  }
  onProgress({ stage: 'preparing', tracks: prepared.tracks.length });
  const { cloud } = await connect(origin, { env, fetchImpl, onProgress });
  const before = serviceState(readSharing(directory), origin);
  const check = before.collection?.id ? await checkUpdate(cloud, origin, before) : null;
  prepared = prepareRelease(directory, { origin, tracks, visibility, access, brief, rightsAccepted, known: check?.known });
  const uid = ensureLibraryUid(directory);
  prepared = withLibraryUid(prepared, uid);
  const state = readSharing(directory);
  const last = serviceState(state, origin).lastRelease;
  // Nothing changed since the last share: report it, and keep following it
  // when it is still rendering, instead of publishing the same music again.
  // A release the service no longer has is shared anew.
  const previous = !force && last?.id && last.payloadSha256 === prepared.sha256 && last.status !== 'failed'
    ? await cloud(['release', 'show', last.id]).catch(error => { if (error.exitCode === 5) return null; throw error; })
    : null;
  if (previous) {
    let release = previous;
    remember(directory, origin, release);
    if (wait && !finished(release.release?.status)) {
      release = await followRelease(cloud, last.id, { timeoutMs, intervalMs, onProgress, signal });
      remember(directory, origin, release);
    }
    const claimUrl = check?.key?.claimUrl ?? null;
    return summary(origin, directory, uid, { ...release, claimUrl }, { skipped: prepared.skipped, unchanged: true, idempotencyKey: last.idempotencyKey, payloadSha256: prepared.sha256 });
  }
  const { key } = idempotencyFor(state, origin, prepared.sha256);
  // The retry intent is saved before the request, so a lost answer is retried
  // with the same key instead of publishing twice.
  updateService(directory, origin, s => ({ ...s, pending: { payloadSha256: prepared.sha256, idempotencyKey: key, startedAt: new Date().toISOString() } }));
  onProgress({ stage: 'uploading', tracks: prepared.tracks.length });
  let published;
  try {
    published = await cloud(['publish', '--payload', '-', '--rights-accepted', '--idempotency-key', key, ...(artist ? ['--artist', artist] : [])], { input: prepared.bytes, timeoutMs: 10 * 60_000, signal });
  } catch (error) {
    if (error.code === 'conflict') updateService(directory, origin, s => { delete s.pending; return s; });
    throw error;
  }
  remember(directory, origin, published, prepared);
  const credential = published.credential ?? null;
  const claimUrl = published.claimUrl ?? null;
  if (wait && !finished(published.release?.status)) {
    try {
      const followed = await followRelease(cloud, published.release.id, { timeoutMs, intervalMs, onProgress, signal });
      published = { ...followed, release: { ...followed.release, replayed: published.release.replayed }, claimUrl, credential, idempotencyKey: published.idempotencyKey };
      remember(directory, origin, published);
    } catch (error) {
      // The release exists; report it with the links already known.
      onProgress({ stage: 'follow-failed', message: error.message });
    }
  }
  return summary(origin, directory, uid, { ...published, claimUrl }, { skipped: prepared.skipped, credential, idempotencyKey: key, payloadSha256: prepared.sha256 });
}

// What this library shared to the service. refresh asks the service for the
// latest rendering status of the last release; with dryRun it only says so.
export async function shareStatus(directory, { service, refresh = false, dryRun = false, env = process.env, fetchImpl } = {}) {
  directory = libraryPath(directory);
  const origin = serviceOrigin(service, env);
  const state = readSharing(directory);
  let stored = serviceState(state, origin);
  const asking = refresh && stored.lastRelease?.id;
  if (asking && !dryRun) {
    const { cloud } = await connect(origin, { env, fetchImpl });
    const release = await cloud(['release', 'show', stored.lastRelease.id]);
    stored = remember(directory, origin, release);
  }
  return {
    ...(dryRun ? { dryRun: true, request: asking ? { method: 'GET', path: `/api/v1/releases/${stored.lastRelease.id}` } : null, changes: 'none' } : {}),
    service: origin,
    library: directory,
    libraryUid: state.libraryUid ?? null,
    shared: Boolean(stored.collection?.id),
    collection: stored.collection ?? null,
    artist: stored.artist ?? null,
    tracks: Object.entries(stored.tracks ?? {}).map(([localId, t]) => ({ localId, ...t })),
    lastRelease: stored.lastRelease ? { id: stored.lastRelease.id, status: stored.lastRelease.status, createdAt: stored.lastRelease.createdAt ?? null } : null,
    pending: Boolean(stored.pending),
  };
}
