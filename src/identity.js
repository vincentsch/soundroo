// Content identities for the engine, a render's source and a score's music.
//
//   engineHash        the rendering and validation source, built-in voices and
//                     recorded instrument samples.
//                     Toolkit version, CLI, studio and network code do not count.
//   sourceIdentity    one render's revision: score, mix, sample rate, engine and
//                     referenced local WAVs. Speech recipes count by their words,
//                     so another machine computes the same revision.
//   musicFingerprint  the expanded music: tempo, instruments, effective tone,
//                     sample treatment and normalized note events. Metadata, ids,
//                     sections, seed, mix, artwork and values that no instrument
//                     reads are ignored.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { compileScore } from './score.js';
import { getCatalog } from './catalog.js';
import { audibleNote, audibleSample } from './render.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENGINE_FILES = ['src/identity.js', 'src/catalog.js', 'src/headless.js', 'src/notation.js', 'src/render.js', 'src/score.js', 'src/speech.js'];
const ENGINE_FOLDERS = [['src/audio', '.js'], ['assets/voices', '.wav'], ['assets/samples', '.wav'], ['assets/samples', '.json']];
const presets = new Map(getCatalog().instruments.map(preset => [preset.id, preset]));
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');

// JSON with object keys sorted at every level, for hashing parsed JSON.
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(item => item === undefined || typeof item === 'function' ? 'null' : canonicalJson(item)).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(key => value[key] !== undefined && typeof value[key] !== 'function').sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

export function engineManifest() {
  const files = [...ENGINE_FILES];
  for (const [folder, extension] of ENGINE_FOLDERS) for (const name of fs.readdirSync(path.join(ROOT, folder), { recursive: true })) if (name.endsWith(extension)) files.push(`${folder}/${name.split(path.sep).join('/')}`);
  return files.sort().map(file => {
    let bytes = fs.readFileSync(path.join(ROOT, file));
    // A Windows checkout's line endings do not change the engine.
    if (/\.(js|json)$/.test(file)) bytes = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
    return { path: file, sha256: sha256(bytes), size: bytes.length };
  });
}
let hash;
export function engineHash() {
  hash ??= sha256('soundroo-engine/1\n' + engineManifest().map(file => `${file.path} ${file.sha256}\n`).join(''));
  return hash;
}

function localAsset(projectDir, asset) {
  if (!projectDir) throw new Error('A projectDir is required to identify scores that use local assets/ WAVs.');
  const root = fs.realpathSync(path.resolve(projectDir, 'assets')), file = fs.realpathSync(path.resolve(projectDir, asset));
  if (!file.startsWith(root + path.sep)) throw new Error('Sample asset must stay within the project assets directory.');
  return file;
}
export function sourceIdentity(score, { mix = {}, sampleRate = 44100, projectDir } = {}) {
  const digest = crypto.createHash('sha256').update(canonicalJson({ engine: engineHash(), mix, sampleRate, score }));
  const assets = new Set((Array.isArray(score?.parts) ? score.parts : []).map(part => part?.sample?.asset).filter(asset => typeof asset === 'string' && !asset.startsWith('builtin:')));
  for (const asset of [...assets].sort()) digest.update(`\n${asset}\n`).update(fs.readFileSync(localAsset(projectDir, asset)));
  return digest.digest('hex').slice(0, 24);
}

const round = value => typeof value === 'number' ? Math.round(value * 1e6) / 1e6 : Array.isArray(value) ? value.map(round) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, round(item)])) : value;
const byValues = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] === null ? -1 : b[i] === null ? 1 : a[i] - b[i];
  return 0;
};
export function musicFingerprint(score) {
  const expanded = compileScore(score);
  const parts = expanded.parts.filter(part => part.volume > 0 && part.notes.length).map(part => canonicalJson({
    instrument: part.instrument,
    tone: round(Object.fromEntries(Object.entries(presets.get(part.instrument).controls).map(([name, spec]) => [name, part.tone[name] ?? spec.default]))),
    sample: part.sample ? round(audibleSample(part.sample)) : null,
    notes: part.notes.map(note => round(Object.values(audibleNote(part.instrument, note)))).sort(byValues),
  })).sort();
  return 'fp1:' + sha256(`{"bpm":${round(expanded.bpm)},"parts":[${parts.join(',')}]}`);
}
