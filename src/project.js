import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as engine from './headless.js';

export { VERSION } from './version.js';
export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
export function requireId(id) { if (!ID.test(id ?? '')) throw new Error('Use a lowercase name with letters, digits and hyphens.'); return id; }
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temp, file);
}
export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return fallback; throw new Error(`Cannot read ${path.basename(file)}: ${error.message}`); }
}
export function libraryPath(directory) { return path.resolve(directory ?? path.join(process.cwd(), 'library')); }
export function trackPath(directory, id, ...segments) {
  requireId(id);
  const root = libraryPath(directory);
  const target = path.join(root, 'tracks', id, ...segments);
  if (segments.some(s => s.includes('..') || path.isAbsolute(s) || s.includes('\\'))) throw new Error('Invalid project path.');
  let existing = target;
  while (!fs.existsSync(existing) && existing !== root) existing = path.dirname(existing);
  if (fs.existsSync(existing) && fs.existsSync(root)) {
    const realRoot = fs.realpathSync(root), real = fs.realpathSync(existing);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new Error('Project files must stay inside the music library.');
  }
  return target;
}

async function scoreModule() { return import('./score.js'); }
export async function initLibrary(directory, { examples = false, exampleSet = 'variety', seed = exampleSet === 'variety' ? 21 : 1, title = 'Your music', description = '' } = {}) {
  const root = libraryPath(directory), file = path.join(root, 'collection.json');
  if (fs.existsSync(file)) return readJson(file);
  fs.mkdirSync(root, { recursive: true });
  let collection = { version: 1, id: 'your-music', title, description, source: 'personal', createdAt: new Date().toISOString(), tracks: [] };
  if (examples) {
    if (!['variety', 'open-window'].includes(exampleSet)) throw new Error('Choose --collection variety or --collection open-window.');
    const build = exampleSet === 'variety' ? (await import('../examples/variety.js')).buildVarietyCollection : (await import('../examples/collection.js')).buildExampleCollection;
    const built = build({ seed });
    collection = { ...collection, ...built.collection, version: 1, source: 'examples', tracks: built.tracks.map(t => t.id) };
    for (const score of built.tracks) {
      requireId(score.id);
      const { validateScore } = await scoreModule();
      const validation = validateScore(score);
      if (!validation.valid) throw new Error(`Example ${score.id} is invalid: ${JSON.stringify(validation.issues)}`);
      writeJson(trackPath(root, score.id, 'score.json'), { ...score, origin: 'example' });
    }
  }
  writeJson(file, collection);
  fs.mkdirSync(path.join(root, 'requests'), { recursive: true });
  return collection;
}

export function readScore(directory, id) { return readJson(trackPath(directory, id, 'score.json')); }
export function readMix(directory, id) { return readJson(trackPath(directory, id, 'mix.json'), {}); }
export function readCurrent(directory, id) { return readJson(trackPath(directory, id, 'renders', 'current.json'), null); }
export function readVersions(directory, id) { return readJson(trackPath(directory, id, 'renders', 'index.json'), []); }

export function resolveSample(directory, asset) {
  if (asset.startsWith('builtin:')) {
    const id = requireId(asset.slice(8));
    const full = path.join(ROOT, 'assets', 'voices', id + '.wav');
    if (!fs.existsSync(full)) throw new Error(`Unknown built-in voice phrase: ${id}`);
    return full;
  }
  const root = libraryPath(directory), full = path.resolve(root, asset);
  if (!full.startsWith(path.join(root, 'assets') + path.sep) || path.extname(full).toLowerCase() !== '.wav') throw new Error('Voice samples must be WAV files under the library assets folder.');
  const real = fs.realpathSync(full), assets = fs.realpathSync(path.join(root, 'assets'));
  if (!real.startsWith(assets + path.sep)) throw new Error('Voice samples must stay inside the library assets folder.');
  return full;
}
// The same revision a server computes for this score and mix (headless.js).
export function sourceIdentity(directory, score, mix, sampleRate = 44100) {
  return engine.revision(score, { mix, sampleRate, projectDir: libraryPath(directory) });
}

export async function addTrack(directory, input, { replace = false } = {}) {
  const score = typeof input === 'string' ? readJson(path.resolve(input)) : input;
  requireId(score.id);
  const { validateScore } = await scoreModule(); const validation = validateScore(score);
  if (!validation.valid) throw new Error('Invalid score: ' + JSON.stringify(validation.issues));
  await initLibrary(directory);
  const target = trackPath(directory, score.id, 'score.json');
  if (fs.existsSync(target) && !replace) throw new Error(`Track ${score.id} already exists. Use --replace to revise it and keep its render history.`);
  writeJson(target, { ...score, origin: score.origin === 'example' ? 'example' : 'personal' });
  const root = libraryPath(directory), collection = readJson(path.join(root, 'collection.json'));
  if (!collection.tracks.includes(score.id)) collection.tracks.push(score.id);
  if (score.origin !== 'example') collection.source = 'personal';
  writeJson(path.join(root, 'collection.json'), collection);
  return score.id;
}

export function saveState(directory, id, update) {
  readScore(directory, id);
  if (typeof update.favorite !== 'boolean') throw new Error('Favorite must be true or false.');
  const state = { ...readJson(trackPath(directory, id, 'state.json'), {}), favorite: update.favorite };
  writeJson(trackPath(directory, id, 'state.json'), state); return state;
}
export function saveMix(directory, id, mix) {
  const score = readScore(directory, id), ids = new Set((score.parts ?? []).map(p => p.id));
  if (!mix || typeof mix !== 'object' || Array.isArray(mix)) throw new Error('Mix must be an object.');
  const result = { parts: {}, master: {} };
  for (const [part, values] of Object.entries(mix.parts ?? {})) {
    if (!ids.has(part)) throw new Error(`Unknown part: ${part}`);
    if (!values || typeof values !== 'object') throw new Error('Part mix must contain levels and switches.');
    const valid = {};
    for (const [key, value] of Object.entries(values)) {
      if (key === 'mute' || key === 'solo') { if (typeof value !== 'boolean') throw new Error(`${key} must be true or false.`); valid[key] = value; }
      else if (key === 'volume' || key === 'pan') {
        if (!Number.isFinite(value) || value < (key === 'pan' ? -1 : 0) || value > (key === 'pan' ? 1 : 2)) throw new Error(`Invalid ${key} for ${part}.`);
        valid[key] = value;
      } else throw new Error(`Unsupported mix control: ${key}`);
    }
    result.parts[part] = valid;
  }
  if (mix.master?.volume != null) {
    const v = mix.master.volume; if (!Number.isFinite(v) || v < 0 || v > 2) throw new Error('Master volume must be between 0 and 2.'); result.master.volume = v;
  }
  const previous = readMix(directory, id);
  for (const [part, values] of Object.entries(result.parts)) result.parts[part] = { ...(previous.parts?.[part] ?? {}), ...values };
  result.parts = { ...(previous.parts ?? {}), ...result.parts }; result.master = { ...(previous.master ?? {}), ...result.master };
  writeJson(trackPath(directory, id, 'mix.json'), result); return result;
}
export function saveFeedback(directory, id, { text, time = 0 }) {
  const score = readScore(directory, id);
  if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw new Error('Write a note between 1 and 4,000 characters.');
  const duration = readCurrent(directory, id)?.duration ?? score.beats * 60 / score.bpm + 10;
  if (!Number.isFinite(time) || time < 0 || time > duration + 1) throw new Error('Choose a time inside the track.');
  const entry = { id: crypto.randomBytes(8).toString('hex'), text: text.trim(), time, date: new Date().toISOString() };
  const entries = readJson(trackPath(directory, id, 'feedback.json'), []); entries.push(entry);
  writeJson(trackPath(directory, id, 'feedback.json'), entries); return entry;
}
export function deleteFeedback(directory, id, feedbackId) {
  readScore(directory, id);
  const entries = readJson(trackPath(directory, id, 'feedback.json'), []);
  const next = entries.filter(e => e.id !== feedbackId);
  if (next.length === entries.length) throw new Error('That listening note no longer exists.');
  writeJson(trackPath(directory, id, 'feedback.json'), next); return { deleted: true };
}

export function saveRequest(directory, { brief, count = 10 }) {
  if (typeof brief !== 'string' || !brief.trim() || brief.length > 8000) throw new Error('Describe the music in 1 to 8,000 characters.');
  if (!Number.isInteger(count) || count < 1 || count > 30) throw new Error('Choose between 1 and 30 tracks.');
  const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex');
  const request = { id, brief: brief.trim(), count, date: new Date().toISOString(), status: 'pending', path: `requests/${id}.json` };
  writeJson(path.join(libraryPath(directory), request.path), request);
  return { ...request, path: path.join(libraryPath(directory), request.path) };
}
export function readRequests(directory) {
  const dir = path.join(libraryPath(directory), 'requests');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(n => n.endsWith('.json')).sort().reverse().map(n => ({ ...readJson(path.join(dir, n)), path: path.join(dir, n) }));
}

export function trackInfo(directory, id, { detail = false } = {}) {
  const score = readScore(directory, id), mix = readMix(directory, id), current = readCurrent(directory, id);
  const state = readJson(trackPath(directory, id, 'state.json'), {});
  const versions = readVersions(directory, id).map(v => ({ ...v, audioUrl: `/api/tracks/${id}/versions/${v.id}/audio` }));
  const report = current ? readJson(trackPath(directory, id, 'renders', current.id + '.report.json'), {}) : {};
  const seconds = 60 / score.bpm;
  const info = {
    id, title: score.title, description: score.description ?? '', genre: score.genre ?? '', mood: score.mood ?? '', bpm: score.bpm, key: score.key ?? '',
    duration: current?.duration ?? score.beats * seconds, rendered: Boolean(current && fs.existsSync(trackPath(directory, id, 'renders', current.id + '.wav'))),
    favorite: Boolean(state.favorite), origin: score.origin ?? 'personal', audioUrl: `/api/tracks/${id}/audio`, artworkUrl: `/api/tracks/${id}/artwork`,
    waveform: report.waveform ?? [], revision: current?.id ?? null, versions,
    sections: (score.sections ?? []).map(s => ({ id: s.id, name: s.name, start: s.beat * seconds, end: (s.beat + s.beats) * seconds })),
    parts: (score.parts ?? []).map((p, i) => ({ id: p.id, name: p.name ?? p.id, instrument: p.instrument, volume: mix.parts?.[p.id]?.volume ?? p.volume ?? 1, pan: mix.parts?.[p.id]?.pan ?? p.pan ?? 0, mute: mix.parts?.[p.id]?.mute ?? false, solo: mix.parts?.[p.id]?.solo ?? false, color: p.color ?? ['#ef946b', '#a9bce8', '#b9d0ac', '#b69ccf', '#e2ce87'][i % 5] })),
  };
  if (detail) {
    Object.assign(info, { score, mix: { ...mix, master: { volume: score.master?.volume ?? 0.8, ...mix.master } }, report, feedback: readJson(trackPath(directory, id, 'feedback.json'), []) });
    // The studio draws version 2 pattern strings from their compiled notes.
    if (score.version === 2) {
      try { const expanded = engine.compile(score); info.arrangement = { bpm: expanded.bpm, parts: expanded.parts.map(({ id: part, name, notes }) => ({ id: part, name, notes })) }; } catch { /* invalid scores show parts without notes */ }
    }
  }
  return info;
}
export function getLibrary(directory, jobs = []) {
  const collection = readJson(path.join(libraryPath(directory), 'collection.json'));
  const tracks = collection.tracks.map(id => {
    try { return trackInfo(directory, id); }
    catch (error) { return { id, title: id, description: '', genre: '', mood: '', duration: 0, rendered: false, error: error.message, parts: [], versions: [], waveform: [], sections: [], artworkUrl: `/api/tracks/${id}/artwork` }; }
  });
  return { collection, tracks, jobs, directory: libraryPath(directory) };
}

export async function renderTrack(directory, id, { sampleRate = 44100, stems = false, progress, log } = {}) {
  const score = readScore(directory, id), mix = readMix(directory, id), revision = sourceIdentity(directory, score, mix, sampleRate);
  const dir = trackPath(directory, id, 'renders'); fs.mkdirSync(dir, { recursive: true });
  const wavFile = trackPath(directory, id, 'renders', revision + '.wav');
  const reportFile = trackPath(directory, id, 'renders', revision + '.report.json');
  const stemsDir = trackPath(directory, id, 'stems', revision);
  const cached = fs.existsSync(wavFile) && fs.existsSync(reportFile) && (!stems || fs.existsSync(stemsDir));
  let report;
  if (!cached) {
    const result = await engine.render(score, { sampleRate, mix, projectDir: libraryPath(directory), stems, progress, speech: { log } });
    report = result.report;
    const temporary = wavFile + '.tmp'; fs.writeFileSync(temporary, result.wav, { mode: 0o600 }); fs.renameSync(temporary, wavFile);
    writeJson(reportFile, report);
    if (stems && result.stems) {
      fs.mkdirSync(stemsDir, { recursive: true });
      for (const [partId, bytes] of Object.entries(result.stems)) {
        requireId(partId); fs.writeFileSync(path.join(stemsDir, partId + '.wav'), bytes, { mode: 0o600 });
      }
      writeJson(path.join(stemsDir, 'notes.json'), { note: 'Dry instrument stems include part volume, pan, mute and solo. Shared master reverb, compression and gain are in the master WAV only.', revision });
    }
  } else report = readJson(reportFile);
  const versions = readVersions(directory, id);
  let entry = versions.find(v => v.id === revision);
  if (!entry) { entry = { id: revision, label: 'Version ' + (versions.length + 1), date: new Date().toISOString(), duration: report.duration, sampleRate }; versions.push(entry); writeJson(path.join(dir, 'index.json'), versions); }
  // A mix changed during rendering must not replace the newer requested state.
  if (sourceIdentity(directory, readScore(directory, id), readMix(directory, id), sampleRate) === revision) writeJson(path.join(dir, 'current.json'), entry);
  progress?.(1);
  return { id, revision, duration: report.duration, file: wavFile, report, cached, stemsDir: stems ? stemsDir : null };
}

export async function midiForTrack(directory, id) {
  return engine.midi(readScore(directory, id));
}
