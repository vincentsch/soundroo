// Installs the sample packs of the recorded instruments (audio/library.js).
// Each pack is downloaded once from the toolkit's GitHub release into the
// samples folder, resumes where an interrupted download stopped, and is kept
// only when its size and SHA-256 match assets/samples/samples.json. Nothing is
// uploaded; the request carries no information about the music.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { compileScore } from './score.js';
import { sampleManifest, packFileName, instrumentPacks, defaultSamplesDir } from './audio/library.js';

/** Every pack: {name, file, size, installed}. */
export function samplesStatus({ samplesDir = defaultSamplesDir() } = {}) {
  return Object.entries(sampleManifest().packs).sort(([a], [b]) => a.localeCompare(b)).map(([name, pack]) => {
    const file = path.join(samplesDir, packFileName(name));
    let installed = false;
    try { installed = fs.statSync(file).size === pack.size; } catch { /* not installed */ }
    return { name, file, size: pack.size, installed, instruments: Object.entries(sampleManifest().instruments).filter(([, spec]) => spec.pack === name).map(([id]) => id).sort() };
  });
}

/** The packs a score's recorded instruments play from. */
export function scorePacks(score) {
  const compiled = compileScore(score);
  return [...new Set(compiled.parts.filter(part => part.notes.length && part.volume > 0).flatMap(part => instrumentPacks(part.instrument)))].sort();
}

function packUrl(name, env) {
  const base = env.SOUNDROO_SAMPLES_URL;
  if (base) return `${base.replace(/\/+$/, '')}/${packFileName(name)}`;
  const url = sampleManifest().packs[name].url;
  if (!url) throw new Error(`No download address is known for the ${name} recordings.`);
  return url;
}

async function hashFile(file, hash) {
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
}

async function download(name, { samplesDir, fetchImpl, log, signal, env }) {
  const pack = sampleManifest().packs[name];
  const file = path.join(samplesDir, packFileName(name)), part = `${file}.part`;
  fs.mkdirSync(samplesDir, { recursive: true });
  let have = 0;
  try { have = fs.statSync(part).size; } catch { /* a fresh download */ }
  if (have > pack.size) { fs.rmSync(part); have = 0; }
  let hash = crypto.createHash('sha256');
  if (have) await hashFile(part, hash);
  const url = packUrl(name, env);
  let lastReport = 0;
  const report = done => {
    const now = Date.now();
    if (done === pack.size || now - lastReport > 2000) {
      lastReport = now;
      log?.(`Downloading the ${name} recordings: ${(done / 1e6).toFixed(0)} of ${(pack.size / 1e6).toFixed(0)} MB`);
    }
  };
  if (have < pack.size) {
    const response = await fetchImpl(url, { headers: have ? { Range: `bytes=${have}-` } : {}, redirect: 'follow', signal });
    if (have && response.status !== 206) {
      // The server sent the whole file; start over.
      have = 0;
      hash = crypto.createHash('sha256');
    }
    if (response.status !== 200 && response.status !== 206) throw new Error(`Downloading the ${name} recordings failed: HTTP ${response.status} from ${url}.`);
    const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
    try {
      for await (const chunk of response.body) {
        if (have + chunk.length > pack.size) throw new Error(`The ${name} download is larger than expected; refusing it.`);
        hash.update(chunk);
        have += chunk.length;
        if (!out.write(chunk)) await new Promise(resolve => out.once('drain', resolve));
        report(have);
      }
    } finally {
      await new Promise(resolve => out.end(resolve));
    }
  }
  const digest = hash.digest('hex');
  if (have !== pack.size || digest !== pack.sha256) {
    fs.rmSync(part, { force: true });
    throw new Error(`The ${name} recordings did not download intact (expected ${pack.size} bytes, SHA-256 ${pack.sha256.slice(0, 16)}…). Try again.`);
  }
  fs.renameSync(part, file);
  return file;
}

/** Downloads the named packs that are missing. Options: samplesDir, log,
 * signal, fetchImpl, env. Returns the status of those packs. */
export async function installPacks(names, { samplesDir = defaultSamplesDir(), log, signal, fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const wanted = [...new Set(names)];
  for (const name of wanted) if (!sampleManifest().packs[name]) throw new Error(`Unknown sample pack ${name}. Packs: ${Object.keys(sampleManifest().packs).sort().join(', ')}.`);
  const missing = samplesStatus({ samplesDir }).filter(pack => wanted.includes(pack.name) && !pack.installed);
  if (missing.length && (env.SOUNDROO_OFFLINE === '1')) throw Object.assign(new Error(`The recorded instruments ${missing.map(p => p.name).join(', ')} are not installed and SOUNDROO_OFFLINE is set.`), { code: 'samples_missing' });
  if (missing.length) log?.(`Downloading the recorded instruments once (${(missing.reduce((sum, p) => sum + p.size, 0) / 1e9).toFixed(1)} GB) into ${samplesDir}.`);
  for (const pack of missing) await download(pack.name, { samplesDir, fetchImpl, log, signal, env });
  return samplesStatus({ samplesDir }).filter(pack => wanted.includes(pack.name));
}

/** Installs the packs a score needs before it renders with recorded instruments. */
export async function prepareSamples(score, options = {}) {
  return installPacks(scorePacks(score), options);
}
