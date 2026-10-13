// Helpers for the sharing tests: small personal libraries and a recording
// soundroo-cloud stand-in.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initLibrary, addTrack, readScore, readMix, trackPath, writeJson, sourceIdentity } from '../../src/project.js';

export const STUB_SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cloud-stub.cjs');
export const posix = process.platform !== 'win32';

const created = [];
process.on('exit', () => { for (const dir of created) fs.rmSync(dir, { recursive: true, force: true }); });

export function tempDir(prefix = 'soundroo-share-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

export function score(id, { title = id, line = 'E2/.5 E2 G2/.5 A2 -/1', extra = {} } = {}) {
  return {
    version: 2, id, title, genre: 'Funk', mood: 'Bright', bpm: 120, beats: 48,
    sections: [{ id: 'a', name: 'A', beat: 0, beats: 48 }],
    parts: [
      { id: 'bass', name: 'Bass', instrument: 'electric-bass', volume: 0.8, tone: {}, patterns: { riff: { beats: 4, line } }, clips: [{ pattern: 'riff', beat: 0, repeat: 12 }] },
      { id: 'kick', name: 'Kick', instrument: 'rock-kick', patterns: { '0': { beats: 4, steps: 'x...x...x...x...' } }, clips: [{ pattern: '0', beat: 0, repeat: 12 }] },
    ],
    ...extra,
  };
}

// Marks a track as rendered for its current score and mix without running the
// synthesizer, the way the studio's own tests prepare renders.
export function markRendered(directory, id) {
  const revision = sourceIdentity(directory, readScore(directory, id), readMix(directory, id), 44100);
  fs.mkdirSync(trackPath(directory, id, 'renders'), { recursive: true });
  fs.writeFileSync(trackPath(directory, id, 'renders', revision + '.wav'), 'RIFF');
  writeJson(trackPath(directory, id, 'renders', revision + '.report.json'), { duration: 24 });
  writeJson(trackPath(directory, id, 'renders', 'index.json'), [{ id: revision, label: 'Version 1', duration: 24, sampleRate: 44100 }]);
  writeJson(trackPath(directory, id, 'renders', 'current.json'), { id: revision, duration: 24, sampleRate: 44100 });
  return revision;
}

export async function makeLibrary({ title = 'Night Trains', tracks = ['night-train', 'city-lights'], rendered = true } = {}) {
  const directory = tempDir();
  await initLibrary(directory, { title, description: 'Ten minutes after midnight.' });
  for (const id of tracks) {
    await addTrack(directory, typeof id === 'string' ? score(id, { title: id.replace(/-/g, ' ') }) : id);
    if (rendered) markRendered(directory, typeof id === 'string' ? id : id.id);
  }
  return directory;
}

// A soundroo-cloud stand-in in its own folder. behavior maps commands
// ("publish", "release show", …) to an answer, {fail: {exit, code, error}} or
// a list of answers used in turn.
export function installStub(behavior) {
  const dir = tempDir('soundroo-stub-');
  const file = path.join(dir, 'soundroo-cloud');
  fs.copyFileSync(STUB_SOURCE, file);
  fs.chmodSync(file, 0o755);
  const write = value => fs.writeFileSync(path.join(dir, 'behavior.json'), JSON.stringify(value));
  write(behavior);
  return {
    dir,
    file,
    env: { ...process.env, SOUNDROO_CLOUD_BIN: file, STUB_DIR: dir, SOUNDROO_CACHE: path.join(dir, 'cache'), SOUNDROO_URL: '' },
    set: write,
    calls: () => (fs.existsSync(path.join(dir, 'calls.jsonl')) ? fs.readFileSync(path.join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : []),
    reset: () => { fs.rmSync(path.join(dir, 'calls.jsonl'), { force: true }); fs.rmSync(path.join(dir, 'counts.json'), { force: true }); },
  };
}

// The JSON soundroo-cloud prints for a publish or release show.
export function releaseAnswer({ id = '01JRELEASE0000000000000001', status = 'queued', tracks = ['night-train', 'city-lights'], claimUrl = 'https://soundroo.com/claim/secretclaimtoken', replayed = false, visibility = 'unlisted', access = 'open' } = {}) {
  return {
    service: 'https://soundroo.com',
    release: { id, status, replayed, statusUrl: `https://soundroo.com/api/v1/releases/${id}` },
    collection: { id: '01JCOLLECTION0000000000001', title: 'Night Trains', url: 'https://soundroo.com/@amber-orchard/collections/night-trains', shortUrl: 'https://soundroo.com/c/01JCOLLECTION0000000000001', visibility },
    artist: { id: '01JARTIST00000000000000001', handle: 'amber-orchard', name: 'Amber Orchard', url: 'https://soundroo.com/@amber-orchard' },
    tracks: tracks.map((localId, i) => ({ localId, id: `01JTRACK${String(i).padStart(18, '0')}`, title: localId, status: status === 'queued' ? 'queued' : status, url: `https://soundroo.com/@amber-orchard/${localId}`, shortUrl: `https://soundroo.com/t/01JTRACK${String(i).padStart(18, '0')}`, visibility, access })),
    ...(claimUrl ? { claimUrl } : {}),
    credential: { source: 'file', created: true, kind: 'guest' },
    idempotencyKey: 'from-stub',
    payloadSha256: 'from-stub',
  };
}

export function snapshot(directory) {
  const out = {};
  const walk = dir => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else out[path.relative(directory, file)] = fs.readFileSync(file).toString('base64');
    }
  };
  walk(directory);
  return out;
}
