import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readScore, readMix, readJson, trackPath, addTrack, getLibrary } from '../src/project.js';
import * as engine from '../src/headless.js';
import { importTrack, normalizeImported, trackReference } from '../src/cloud/importer.js';
import { prepareRelease } from '../src/cloud/payload.js';
import { makeLibrary, markRendered, score, installStub, tempDir, posix } from './fixtures/sharing.js';

const skip = !posix && 'the soundroo-cloud stand-in needs a POSIX shebang';

function shared(original, mix = { parts: { bass: { volume: 0.7 } }, master: {} }) {
  return {
    service: 'https://soundroo.com', trackId: '01JORIGINAL000000000000001',
    score: original, mix, engine: { version: engine.engineInfo().version, hash: engine.engineHash() },
    revision: engine.revision(original, { mix }), remixOf: '01JORIGINAL000000000000001',
    artist: { handle: 'mara', name: 'Mara', url: 'https://soundroo.com/@mara' }, license: 'CC-BY-4.0',
  };
}

test('lists made from JSON objects are turned back into objects', () => {
  const { score: s, mix } = normalizeImported({ master: [], parts: [{ tone: [], patterns: [{ beats: 4 }, { beats: 2 }], sample: { speech: [], pattern: [0, 1] } }] }, []);
  assert.deepEqual(s.master, {});
  assert.deepEqual(s.parts[0].tone, {});
  assert.deepEqual(s.parts[0].patterns, { '0': { beats: 4 }, '1': { beats: 2 } });
  assert.deepEqual(s.parts[0].sample.pattern, [0, 1], 'chop steps are a real list');
  assert.deepEqual(mix, {});
  assert.deepEqual(normalizeImported({ parts: [] }, { parts: [{ volume: 1 }], master: [] }).mix, { parts: { '0': { volume: 1 } }, master: {} });
  assert.equal(trackReference('01JORIGINAL000000000000001', 'https://soundroo.com'), '01JORIGINAL000000000000001');
  assert.equal(trackReference('https://soundroo.com/t/01JORIGINAL000000000000001', 'https://soundroo.com'), '01JORIGINAL000000000000001');
  assert.throws(() => trackReference('https://other.example/t/01JORIGINAL000000000000001', 'https://soundroo.com'), error => error.code === 'other_service');
  assert.equal(trackReference('https://soundroo.com/@mara/night-train?ref=x', 'https://soundroo.com'), 'https://soundroo.com/@mara/night-train');
  assert.throws(() => trackReference('https://soundroo.com/@mara', 'https://soundroo.com'), error => error.code === 'invalid_reference');
});

test('an open track arrives exactly, credited, with a safe id and remix lineage', { skip }, async () => {
  const directory = await makeLibrary({ tracks: ['night-train'] });
  const original = score('night-train', { title: 'Night Train' });
  const stub = installStub({ score: shared(original) });
  const result = await importTrack(directory, 'https://soundroo.com/t/01JORIGINAL000000000000001', { env: stub.env });
  assert.equal(result.verified, true);
  assert.equal(result.track.id, 'night-train-remix', 'an existing track keeps its id');
  assert.equal(result.remixOf, '01JORIGINAL000000000000001');
  assert.match(result.credit, /“Night Train” by Mara \(https:\/\/soundroo\.com\/@mara\), https:\/\/soundroo\.com\/t\/01JORIGINAL000000000000001, licensed CC-BY-4.0/);
  assert.deepEqual(stub.calls().find(c => c.command === 'score').argv.slice(-2), ['score', '01JORIGINAL000000000000001']);
  const imported = readScore(directory, 'night-train-remix');
  assert.equal(imported.id, 'night-train-remix');
  assert.equal(engine.fingerprint(imported), engine.fingerprint(original), 'the music is unchanged');
  assert.deepEqual(readMix(directory, 'night-train-remix').parts, { bass: { volume: 0.7 } });
  const source = readJson(trackPath(directory, 'night-train-remix', 'source.json'));
  assert.equal(source.license, 'CC-BY-4.0');
  assert.equal(source.fingerprint, engine.fingerprint(original));
  assert.equal(source.artist.handle, 'mara');
  assert.ok(getLibrary(directory).collection.tracks.includes('night-train-remix'));
  // An unchanged copy is not shared as a remix; a changed one carries its lineage.
  markRendered(directory, 'night-train-remix');
  assert.throws(() => prepareRelease(directory, { origin: 'https://soundroo.com', tracks: ['night-train-remix'] }), error => error.issues[0].code === 'unchanged_remix');
  await addTrack(directory, { ...imported, bpm: 132 }, { replace: true });
  markRendered(directory, 'night-train-remix');
  const release = prepareRelease(directory, { origin: 'https://soundroo.com', tracks: ['night-train-remix'] });
  assert.equal(release.payload.tracks[0].remixOf, '01JORIGINAL000000000000001');
});

test('imports stop on altered, closed or missing scores', { skip }, async () => {
  const directory = tempDir();
  const original = score('night-train', { title: 'Night Train' });
  const altered = { ...shared(original), revision: 'f'.repeat(24) };
  for (const [name, answer, code, exit] of [
    ['altered', altered, 'revision_mismatch', 2],
    ['closed license', { ...shared(original), license: 'All rights reserved' }, 'not_open', 4],
    ['listen-only', { fail: { exit: 5, code: 'not_found', error: 'That track’s score is not available: it does not exist, is listen-only, or is not shared with you.' } }, 'not_found', 5],
    ['invalid', { ...shared(original), score: { ...original, bpm: 9000 }, revision: null, engine: { version: '9.9.9', hash: 'x' } }, 'invalid_score', 1],
  ]) {
    const stub = installStub({ score: answer });
    await assert.rejects(importTrack(directory, '01JORIGINAL000000000000001', { env: stub.env }), error => error.code === code && error.exitCode === exit, name);
  }
  assert.ok(!fs.existsSync(path.join(directory, 'collection.json')) || getLibrary(directory).tracks.length === 0, 'a refused import added music');
});
