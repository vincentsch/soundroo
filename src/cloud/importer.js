// Imports an open track from a Soundroo service into a local library: the
// exact score and mix the artist shared, with its credit, license and remix
// lineage in tracks/<id>/source.json. Listen-only tracks have no score to
// import; this never reaches for audio or other files instead.
import fs from 'node:fs';
import path from 'node:path';
import { libraryPath, initLibrary, addTrack, saveMix, trackPath, writeJson, readJson, ID } from '../project.js';
import * as engine from '../headless.js';
import { sameOrigin } from './origin.js';
import { jsonProblems } from './payload.js';
import { serviceOrigin, connect, toolStatus } from './share.js';
import { ShareError } from './errors.js';

const PUBLIC_ID = /^[0-9A-Za-z]{26}$/;
export const OPEN_LICENSES = ['CC-BY-4.0'];

export function trackReference(reference, origin) {
  const value = String(reference ?? '').trim();
  if (PUBLIC_ID.test(value)) return value;
  let url;
  try { url = new URL(value); } catch { throw new ShareError('Name a track by its short link (…/t/ID) or its id.', { code: 'invalid_reference' }); }
  if (!sameOrigin(origin, url.href)) throw new ShareError(`That link is on ${url.origin}, not ${origin}.`, { code: 'other_service', hint: `Pass --service ${url.origin} to import from there.` });
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length === 2 && parts[0] === 't' && PUBLIC_ID.test(parts[1])) return parts[1];
  throw new ShareError('Use the track’s short link (…/t/ID) or its id; the track page shows both.', { code: 'invalid_reference' });
}

// A service that decoded JSON objects into lists turns {} into [] and maps
// with keys "0".."n" into arrays. Restore the objects the score format needs.
const asObject = value => (Array.isArray(value) ? Object.fromEntries(value.map((item, i) => [String(i), item])) : value);
export function normalizeImported(score, mix) {
  const s = structuredClone(score);
  for (const key of ['master', 'artwork']) if (Array.isArray(s[key])) s[key] = asObject(s[key]);
  for (const part of Array.isArray(s.parts) ? s.parts : []) {
    if (!part || typeof part !== 'object') continue;
    for (const key of ['tone', 'patterns', 'sample']) if (Array.isArray(part[key])) part[key] = asObject(part[key]);
    if (part.sample && Array.isArray(part.sample.speech)) part.sample.speech = asObject(part.sample.speech);
  }
  const m = mix == null ? {} : asObject(structuredClone(mix));
  if (m && typeof m === 'object') {
    for (const key of ['parts', 'master']) if (Array.isArray(m[key])) m[key] = asObject(m[key]);
    for (const [key, value] of Object.entries(m.parts ?? {})) if (Array.isArray(value)) m.parts[key] = asObject(value);
  }
  return { score: s, mix: m };
}

function uniqueId(directory, wanted, title) {
  const slug = text => String(text ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  let base = ID.test(wanted ?? '') ? wanted : slug(title) || 'imported-track';
  if (!ID.test(base)) base = 'imported-track';
  const collection = readJson(path.join(directory, 'collection.json'));
  const taken = id => collection.tracks.includes(id) || fs.existsSync(trackPath(directory, id));
  if (!taken(base)) return base;
  const stem = base.slice(0, 66);
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? `${stem}-remix` : `${stem}-remix-${n}`;
    if (!taken(candidate)) return candidate;
  }
  throw new ShareError('Could not find a free track id in this library.', { code: 'no_free_id' });
}

export async function importTrack(directory, reference, { service, env = process.env, fetchImpl, onProgress = () => {}, dryRun = false } = {}) {
  directory = libraryPath(directory);
  const origin = serviceOrigin(service, env);
  const id = trackReference(reference, origin);
  // A dry run checks the link and says what would happen: nothing is
  // downloaded, and the library is not created or changed.
  if (dryRun) {
    return {
      dryRun: true, service: origin, library: directory, remixOf: id, url: `${origin}/t/${id}`,
      request: { method: 'GET', path: `/api/v1/tracks/${id}/score` },
      libraryExists: fs.existsSync(path.join(directory, 'collection.json')),
      tool: toolStatus(origin, env, 'import'),
      changes: 'none',
    };
  }
  const { cloud } = await connect(origin, { env, fetchImpl, onProgress });
  onProgress({ stage: 'downloading-score' });
  const shared = await cloud(['score', id]);
  if (!OPEN_LICENSES.includes(shared.license)) throw new ShareError('The service did not offer this track under an open license, so it is not imported.', { code: 'not_open', exitCode: 4 });
  if (!shared.score || typeof shared.score !== 'object' || Array.isArray(shared.score)) throw new ShareError('The service sent no score for this track.', { code: 'bad_response', exitCode: 2 });
  const { score, mix } = normalizeImported(shared.score, shared.mix);
  const unsafe = [...jsonProblems(score, 'score'), ...jsonProblems(mix, 'mix')];
  if (unsafe.length) throw new ShareError('The shared score contains values this toolkit will not store.', { code: 'unsafe_json', issues: unsafe });
  const check = engine.validate(score);
  if (!check.valid) throw new ShareError('The shared score does not validate with this toolkit’s engine. Update Soundroo and try again.', { code: 'invalid_score', issues: check.issues.slice(0, 12) });
  const sameEngine = shared.engine?.hash === engine.engineHash();
  // Same engine: the revision proves this is exactly the music that was shared.
  const verified = sameEngine ? engine.revision(score, { mix }) === shared.revision : null;
  if (verified === false) throw new ShareError('The downloaded score differs from what the artist shared; nothing was imported.', { code: 'revision_mismatch', exitCode: 2 });
  const fingerprint = engine.fingerprint(score);
  await initLibrary(directory);
  const localId = uniqueId(directory, score.id, score.title);
  await addTrack(directory, { ...score, id: localId });
  if (mix && Object.keys(mix).length) saveMix(directory, localId, mix);
  const artist = shared.artist && typeof shared.artist === 'object' ? { name: shared.artist.name ?? null, handle: shared.artist.handle ?? null, url: shared.artist.url ?? null } : null;
  const url = `${origin}/t/${id}`;
  const credit = `“${score.title}” by ${artist?.name ?? 'its artist'}${artist?.url ? ` (${artist.url})` : ''}, ${url}, licensed ${shared.license}`;
  const source = { remixOf: shared.remixOf ?? id, title: score.title, artist, url, service: origin, license: shared.license, credit, engine: shared.engine ?? null, revision: shared.revision ?? null, fingerprint, importedAt: new Date().toISOString() };
  writeJson(trackPath(directory, localId, 'source.json'), source);
  const missingSpeech = engine.speechRecipes(score).filter(recipe => !recipe.cached).map(({ text, voice }) => ({ text, voice }));
  return {
    library: directory,
    track: { id: localId, title: score.title },
    remixOf: source.remixOf,
    credit,
    license: shared.license,
    verified,
    engine: { shared: shared.engine?.version ?? null, local: engine.engineInfo().version, same: sameEngine },
    speech: missingSpeech,
    next: `node bin/soundroo.js render ${localId} --library ${directory}`,
  };
}
