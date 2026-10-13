// Prepares exactly what a share uploads: each selected track's score and
// current mix, the collection's title and description, the engine identity
// and the sharing choices. No audio, notes, favorites, requests or files.
// Everything here is local; nothing touches the network.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { libraryPath, readJson, readScore, readMix, readCurrent, trackPath, sourceIdentity, VERSION } from '../project.js';
import * as engine from '../headless.js';
import { canonicalJson } from '../identity.js';
import { readSharing, serviceState, LIBRARY_UID } from './state.js';
import { ShareError } from './errors.js';

export const SHARE_LIMITS = Object.freeze({ tracks: 30, scoreBytes: 1_000_000, minSeconds: 20, maxSeconds: 600 });
export const VISIBILITIES = ['unlisted', 'public', 'private'];
export const ACCESSES = ['open', 'listen-only'];
export const UPLOADS = 'Scores, mix settings and sleeve settings of the selected tracks, with the collection title and description. The service renders the audio from them.';
export const STAYS_LOCAL = 'Rendered audio, listening notes, favorites, requests, voice files and other library files stay on this computer.';

// JSON that survives every hop unchanged: no prototype keys, no unpaired
// surrogates (PHP rejects them), nothing JSON cannot represent.
export function jsonProblems(value, at = '') {
  const problems = [];
  const walk = (item, where) => {
    if (problems.length >= 8) return;
    if (typeof item === 'string') {
      if (/(?:[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff])/.test(item)) problems.push({ path: where || '$', message: 'Contains a broken Unicode character.' });
    } else if (typeof item === 'number') {
      if (!Number.isFinite(item)) problems.push({ path: where || '$', message: 'Contains a number JSON cannot represent.' });
    } else if (Array.isArray(item)) item.forEach((entry, i) => walk(entry, `${where}[${i}]`));
    else if (item && typeof item === 'object') {
      for (const key of Object.keys(item)) {
        if (key === '__proto__') problems.push({ path: `${where}.${key}`.replace(/^\./, ''), message: 'Uses the reserved name __proto__ as a key.' });
        walk(item[key], `${where}.${key}`.replace(/^\./, ''));
      }
    } else if (item !== null && item !== undefined && typeof item !== 'boolean') problems.push({ path: where || '$', message: 'Contains a value JSON cannot represent.' });
  };
  walk(value, at);
  return problems;
}

// Canonical JSON: sorted keys, {} stays {}, [] stays [], numeric map keys stay
// keys. The same bytes give the same SHA-256, which keys idempotent retries.
export function canonicalBytes(value) {
  return Buffer.from(canonicalJson(value), 'utf8');
}
export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function attribution(directory, id) {
  const file = trackPath(directory, id, 'source.json');
  if (!fs.existsSync(file)) return null;
  try { return readJson(file); } catch { return null; }
}

// One track's readiness. problems block a share; skip marks a track left out
// unless chosen explicitly (built-in examples).
export function inspectTrack(directory, id) {
  const out = { localId: id, title: id, problems: [], skip: null };
  const problem = (code, message, extra = {}) => out.problems.push({ code, message, ...extra });
  let score;
  try { score = readScore(directory, id); } catch (error) { problem('unreadable', `The score can’t be read: ${error.message}`); return out; }
  out.title = typeof score.title === 'string' && score.title.trim() ? score.title : id;
  if (score.origin === 'example') out.skip = { code: 'example', message: 'A built-in example, not your own music.' };
  const mix = readMix(directory, id);
  const unsafe = [...jsonProblems(score, 'score'), ...jsonProblems(mix, 'mix')];
  if (unsafe.length) { problem('unsafe_json', 'The score or mix contains values the service cannot store.', { issues: unsafe }); return out; }
  const check = engine.validate(score);
  if (!check.valid) { problem('invalid_score', 'The score has problems. Fix them and render again.', { issues: check.issues.slice(0, 12) }); return out; }
  const compiled = engine.compile(score);
  out.duration = compiled.beats * 60 / compiled.bpm;
  const local = (Array.isArray(score.parts) ? score.parts : []).filter(part => typeof part?.sample?.asset === 'string' && !part.sample.asset.startsWith('builtin:'));
  for (const part of local) {
    problem('local_audio', `Part “${part.name ?? part.id}” plays the local recording ${part.sample.asset}. The service renders only built-in voice phrases and spoken text recipes. Replace the asset with "speech": {"text": "…", "voice": "af_heart"} or remove the part, render again, then share.`, { part: part.id, asset: part.sample.asset });
  }
  if (local.length) return out;
  if (out.duration < SHARE_LIMITS.minSeconds || out.duration > SHARE_LIMITS.maxSeconds) problem(out.duration < SHARE_LIMITS.minSeconds ? 'too_short' : 'too_long', `Shared tracks last 20 seconds to 10 minutes; this one lasts ${Math.round(out.duration)} seconds.`);
  const bytes = canonicalBytes(score).length;
  if (bytes > SHARE_LIMITS.scoreBytes) problem('too_large', `The score is ${Math.ceil(bytes / 1000)} kB; the limit is 1 MB. Describe repeated music with patterns and clips.`);
  // Share what you heard: the current render must match the current score and mix.
  const current = readCurrent(directory, id);
  const heard = current && fs.existsSync(trackPath(directory, id, 'renders', current.id + '.wav')) && current.id === sourceIdentity(directory, score, mix, current.sampleRate ?? 44100);
  if (!heard) problem('render_required', 'Render this track so you share what you heard: its score or mix changed since the last render, or it was never rendered.');
  const source = attribution(directory, id);
  if (source?.remixOf) {
    out.remixOf = source.remixOf;
    if (source.fingerprint && source.fingerprint === engine.fingerprint(score)) problem('unchanged_remix', `This is still the music of “${source.title ?? 'the original'}” by ${source.artist?.name ?? 'its artist'}. Change the music before sharing it as a remix.`);
  }
  out.score = score;
  out.mix = mix;
  out.scoreBytes = bytes;
  out.revision = current?.id ?? null;
  // The service renders at 44.1 kHz; this is the revision it will compute.
  out.clientRevision = engine.revision(score, { mix });
  out.speech = engine.speechRecipes(score).map(({ text, voice }) => ({ text, voice }));
  out.builtinVoices = [...new Set(score.parts.filter(p => p?.sample?.asset?.startsWith?.('builtin:')).map(p => p.sample.asset.slice(8)))];
  return out;
}

const choice = (value, allowed, flag) => {
  if (value == null || value === '') return undefined;
  if (!allowed.includes(value)) throw new ShareError(`Use ${flag} ${allowed.join(', ')}.`, { code: 'invalid_option' });
  return value;
};

// Builds the release. options: origin, tracks (ids), visibility, access, brief,
// rightsAccepted, known ({collection: {visibility}, tracks: {localId: {visibility,
// access}}} from a fresh read of the shared collection).
export function prepareRelease(directory, { origin, tracks: wanted, visibility, access, brief, rightsAccepted = false, known } = {}) {
  directory = libraryPath(directory);
  const collectionFile = path.join(directory, 'collection.json');
  if (!fs.existsSync(collectionFile)) throw new ShareError(`There is no Soundroo library at ${directory}.`, { code: 'no_library' });
  const collection = readJson(collectionFile);
  visibility = choice(visibility, VISIBILITIES, '--visibility');
  access = choice(access, ACCESSES, '--access');
  if (brief != null && (typeof brief !== 'string' || brief.length > 4000)) throw new ShareError('Keep the brief under 4,000 characters.', { code: 'invalid_option' });
  const unsafe = jsonProblems({ title: collection.title, description: collection.description, brief }, 'collection');
  if (unsafe.length) throw new ShareError('The collection title, description or brief contains characters the service cannot store.', { code: 'unsafe_json', issues: unsafe });
  const order = Array.isArray(collection.tracks) ? collection.tracks : [];
  const explicit = Array.isArray(wanted) && wanted.length > 0;
  const unknown = explicit ? wanted.filter(id => !order.includes(id)) : [];
  if (unknown.length) throw new ShareError(`These tracks are not in the library: ${unknown.join(', ')}.`, { code: 'unknown_track' });
  const state = readSharing(directory);
  const service = serviceState(state, origin);
  // Choices already on the service (a fresh read, else the last share) carry
  // over, so sharing again never flips a visibility or access edited there.
  const remembered = { ...(service.tracks ?? {}), ...(known?.tracks ?? {}) };
  const collectionVisibility = visibility ?? known?.collection?.visibility ?? service.collection?.visibility ?? 'unlisted';
  const tracks = [], skipped = [], problems = [];
  for (const id of order) {
    if (explicit && !wanted.includes(id)) continue;
    const info = inspectTrack(directory, id);
    if (info.skip && !explicit) { skipped.push({ localId: id, title: info.title, ...info.skip }); continue; }
    if (info.skip) info.problems.unshift({ code: info.skip.code, message: 'Built-in examples are not your music and are not shared.' });
    if (info.problems.length) { problems.push({ localId: id, title: info.title, problems: info.problems }); continue; }
    info.position = order.indexOf(id);
    tracks.push(info);
  }
  if (collection.source === 'examples' && !tracks.length && !problems.length) throw new ShareError('This is the built-in example collection. Share a library with your own music.', { code: 'example_library' });
  if (problems.length) {
    const renderOnly = problems.every(p => p.problems.every(q => q.code === 'render_required'));
    throw new ShareError(problems.length === 1 ? `“${problems[0].title}” can’t be shared yet.` : `${problems.length} tracks can’t be shared yet.`, {
      code: renderOnly ? 'render_required' : 'not_shareable',
      issues: problems.flatMap(p => p.problems.map(q => ({ path: `tracks.${p.localId}`, code: q.code, message: q.message, ...(q.issues ? { issues: q.issues } : {}) }))),
      hint: renderOnly ? `Render first: node bin/soundroo.js render --all --library ${directory}` : undefined,
      details: { tracks: problems },
    });
  }
  if (!tracks.length) throw new ShareError('There are no tracks of your own to share in this library yet.', { code: 'nothing_to_share' });
  if (tracks.length > SHARE_LIMITS.tracks) throw new ShareError(`Share at most ${SHARE_LIMITS.tracks} tracks at a time; choose some with --tracks.`, { code: 'too_many_tracks' });

  const firstShare = !service.collection?.id;
  const uid = LIBRARY_UID.test(state.libraryUid ?? '') ? state.libraryUid : null;
  // Cut by characters, never inside a surrogate pair.
  const clip = (text, length) => Array.from(text).slice(0, length).join('');
  const title = String(collection.title ?? '').trim() || 'Untitled collection';
  const payload = {
    libraryUid: uid ?? 'sr-00000000000000000000000000000000',
    collection: {
      title: clip(title, 180),
      description: typeof collection.description === 'string' ? clip(collection.description, 4000) : '',
      ...(brief ? { brief } : {}),
      visibility: collectionVisibility,
    },
    tracks: tracks.map(t => {
      const previous = remembered[t.localId] ?? {};
      return {
        localId: t.localId,
        position: t.position,
        score: t.score,
        mix: t.mix,
        clientRevision: t.clientRevision,
        access: access ?? previous.access ?? 'open',
        visibility: visibility ?? previous.visibility ?? collectionVisibility,
        ...(t.remixOf ? { remixOf: t.remixOf } : {}),
      };
    }),
    engine: { version: engine.engineInfo().version, hash: engine.engineHash() },
    rightsAccepted: rightsAccepted === true,
    client: { name: 'soundroo', version: VERSION },
  };
  const bytes = canonicalBytes(payload);
  return {
    payload,
    bytes,
    sha256: sha256(bytes),
    libraryUid: { value: uid, isNew: !uid },
    firstShare,
    collection: { title: payload.collection.title, description: payload.collection.description, visibility: payload.collection.visibility },
    tracks: tracks.map((t, i) => ({ localId: t.localId, title: t.title, duration: Math.round(t.duration * 10) / 10, revision: t.revision, clientRevision: t.clientRevision, scoreBytes: t.scoreBytes, access: payload.tracks[i].access, visibility: payload.tracks[i].visibility, speech: t.speech, builtinVoices: t.builtinVoices, remixOf: t.remixOf ?? null })),
    skipped,
  };
}

// The same release with a real library id once one exists.
export function withLibraryUid(prepared, uid) {
  const payload = { ...prepared.payload, libraryUid: uid };
  const bytes = canonicalBytes(payload);
  return { ...prepared, payload, bytes, sha256: sha256(bytes), libraryUid: { value: uid, isNew: false } };
}

const summary = collection => ({ title: String(collection.title ?? ''), description: String(collection.description ?? ''), source: collection.source ?? 'personal' });

// The collection's title, description and source, without checking any track.
export function collectionSummary(directory) {
  return summary(readJson(path.join(libraryPath(directory), 'collection.json')));
}

// Every track's readiness for the studio's Share dialog. Local only.
export function surveyLibrary(directory) {
  directory = libraryPath(directory);
  const collection = readJson(path.join(directory, 'collection.json'));
  const tracks = (Array.isArray(collection.tracks) ? collection.tracks : []).map(id => {
    const info = inspectTrack(directory, id);
    const first = info.problems[0];
    const status = info.skip ? info.skip.code : !first ? 'ready' : first.code === 'render_required' ? 'render' : 'blocked';
    return { localId: id, title: info.title, duration: info.duration ? Math.round(info.duration * 10) / 10 : null, status, message: info.skip?.message ?? first?.message ?? null, problems: info.problems.map(({ code, message }) => ({ code, message })), speech: info.speech?.length ?? 0, remixOf: info.remixOf ?? null };
  });
  return { collection: summary(collection), tracks };
}
