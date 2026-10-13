import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { addTrack, saveMix, writeJson, trackPath, readJson } from '../src/project.js';
import * as engine from '../src/headless.js';
import { prepareRelease, inspectTrack, jsonProblems, canonicalBytes, surveyLibrary } from '../src/cloud/payload.js';
import { readSharing, ensureLibraryUid, idempotencyFor, updateService, sharingPath } from '../src/cloud/state.js';
import { shareLibrary } from '../src/cloud/share.js';
import { parseOrigin, resolveService } from '../src/cloud/origin.js';
import { makeLibrary, markRendered, score, tempDir, snapshot } from './fixtures/sharing.js';

const origin = 'https://soundroo.com';

test('a release carries exactly the scores, current mixes and collection settings', async () => {
  const directory = await makeLibrary();
  saveMix(directory, 'city-lights', { parts: { bass: { volume: 0.5 } } });
  markRendered(directory, 'city-lights');
  const prepared = prepareRelease(directory, { origin, rightsAccepted: true });
  const { payload } = prepared;
  assert.deepEqual(Object.keys(payload).sort(), ['client', 'collection', 'engine', 'libraryUid', 'rightsAccepted', 'tracks']);
  assert.deepEqual(payload.collection, { title: 'Night Trains', description: 'Ten minutes after midnight.', visibility: 'unlisted' });
  assert.deepEqual(payload.engine, { version: engine.engineInfo().version, hash: engine.engineHash() });
  assert.equal(payload.rightsAccepted, true);
  assert.deepEqual(payload.tracks.map(t => [t.localId, t.position, t.access, t.visibility]), [['night-train', 0, 'open', 'unlisted'], ['city-lights', 1, 'open', 'unlisted']]);
  const city = payload.tracks[1];
  assert.deepEqual(Object.keys(city).sort(), ['access', 'clientRevision', 'localId', 'mix', 'position', 'score', 'visibility']);
  assert.deepEqual(city.mix, { parts: { bass: { volume: 0.5 } }, master: {} });
  // The service computes the revision of the score and mix at 44.1 kHz.
  assert.equal(city.clientRevision, engine.revision(city.score, { mix: city.mix }));
  // Canonical bytes: sorted keys, {} stays {}, numeric map keys stay keys.
  const text = prepared.bytes.toString('utf8');
  assert.match(text, /"tone":\{\}/);
  assert.match(text, /"patterns":\{"0":\{"beats":4/);
  assert.match(text, /"master":\{\}/);
  assert.equal(prepared.sha256, (await import('node:crypto')).createHash('sha256').update(prepared.bytes).digest('hex'));
  // Nothing else from the library goes along.
  for (const word of ['feedback', 'favorite', 'requests', '.wav', 'renders']) assert.ok(!text.includes(word), word);
  assert.equal(prepared.libraryUid.isNew, true);
  assert.ok(!fs.existsSync(sharingPath(directory)), 'preparing must not create sharing.json');
});

test('canonical bytes are stable for equal JSON and keep empty objects and arrays apart', () => {
  const a = canonicalBytes({ b: { '10': 1, '9': [], x: {} }, a: [] });
  const b = canonicalBytes(JSON.parse('{"a":[],"b":{"x":{},"9":[],"10":1}}'));
  assert.deepEqual(a, b);
  assert.equal(a.toString(), '{"a":[],"b":{"10":1,"9":[],"x":{}}}');
  assert.deepEqual(jsonProblems(JSON.parse('{"parts":[{"__proto__":{"x":1}}]}')), [{ path: 'parts[0].__proto__', message: 'Uses the reserved name __proto__ as a key.' }]);
  assert.equal(jsonProblems({ title: 'broken \ud800 text' }).length, 1);
  assert.equal(jsonProblems({ title: 'emoji 🎸 fine', patterns: { constructor: { beats: 4 } } }).length, 0);
});

test('only music you heard and own is shared, with actionable reasons', async () => {
  const directory = await makeLibrary();
  // A changed score without a new render must not be shared.
  await addTrack(directory, score('night-train', { line: 'E2/.5 E2 B2/.5 A2 -/1' }), { replace: true });
  assert.throws(() => prepareRelease(directory, { origin }), error => error.code === 'render_required' && error.exitCode === 1 && /render --all/.test(error.hint) && error.issues[0].path === 'tracks.night-train');
  markRendered(directory, 'night-train');
  // A local WAV cannot be uploaded; builtin phrases and text recipes can.
  await addTrack(directory, score('voice-wav', { extra: { parts: [...score('x').parts, { id: 'voice', instrument: 'sample', sample: { asset: 'assets/phrase.wav' }, notes: [{ pitch: 60, beat: 0, duration: 1 }] }] } }));
  fs.mkdirSync(path.join(directory, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'assets', 'phrase.wav'), 'RIFF');
  const local = inspectTrack(directory, 'voice-wav');
  assert.equal(local.problems[0].code, 'local_audio');
  assert.match(local.problems[0].message, /"speech": \{"text": "…", "voice": "af_heart"\}/);
  assert.match(local.problems[0].message, /assets\/phrase\.wav/);
  assert.throws(() => prepareRelease(directory, { origin }), error => error.code === 'not_shareable' && error.issues.some(i => i.code === 'local_audio'));
  await addTrack(directory, score('voice-builtin', { extra: { parts: [...score('x').parts, { id: 'voice', instrument: 'sample', sample: { asset: 'builtin:made-of-light', effect: 'vocoder' }, notes: [{ pitch: 60, beat: 0, duration: 1 }] }] } }));
  await addTrack(directory, score('voice-recipe', { extra: { parts: [...score('x').parts, { id: 'voice', instrument: 'sample', sample: { speech: { text: 'Turn it up', voice: 'am_michael' }, effect: 'chop' }, notes: [{ pitch: 60, beat: 0, duration: 1 }] }] } }));
  markRendered(directory, 'voice-builtin');
  markRendered(directory, 'voice-recipe');
  const prepared = prepareRelease(directory, { origin, tracks: ['voice-builtin', 'voice-recipe'] });
  assert.deepEqual(prepared.tracks.map(t => t.localId), ['voice-builtin', 'voice-recipe']);
  assert.deepEqual(prepared.tracks[0].builtinVoices, ['made-of-light']);
  assert.deepEqual(prepared.tracks[1].speech, [{ text: 'Turn it up', voice: 'am_michael' }]);
  // Built-in examples are skipped unless chosen, and refused when chosen.
  await addTrack(directory, { ...score('example-groove'), origin: 'example' });
  markRendered(directory, 'example-groove');
  assert.equal(inspectTrack(directory, 'example-groove').skip.code, 'example');
  assert.throws(() => prepareRelease(directory, { origin, tracks: ['example-groove'] }), error => error.issues[0].code === 'example');
  assert.throws(() => prepareRelease(directory, { origin, tracks: ['missing'] }), error => error.code === 'unknown_track');
  // Too short for the service.
  await addTrack(directory, { ...score('short-one'), beats: 16, sections: [], parts: score('x').parts.map(part => ({ ...part, clips: [{ ...part.clips[0], repeat: 4 }] })) });
  markRendered(directory, 'short-one');
  assert.equal(inspectTrack(directory, 'short-one').problems[0].code, 'too_short');
  const survey = surveyLibrary(directory);
  assert.deepEqual(Object.fromEntries(survey.tracks.map(t => [t.localId, t.status])), { 'night-train': 'ready', 'city-lights': 'ready', 'voice-wav': 'blocked', 'voice-builtin': 'ready', 'voice-recipe': 'ready', 'example-groove': 'example', 'short-one': 'blocked' });
});

test('the built-in example library is refused as a whole', async () => {
  const directory = tempDir();
  writeJson(path.join(directory, 'collection.json'), { version: 1, id: 'x', title: 'Turn It Up', source: 'examples', tracks: [] });
  await addTrack(directory, { ...score('riff'), origin: 'example' });
  const collection = readJson(path.join(directory, 'collection.json'));
  writeJson(path.join(directory, 'collection.json'), { ...collection, source: 'examples' });
  markRendered(directory, 'riff');
  assert.throws(() => prepareRelease(directory, { origin }), error => error.code === 'example_library');
});

test('the library id is created once, and retries reuse their idempotency key', async () => {
  const directory = await makeLibrary();
  const uid = ensureLibraryUid(directory);
  assert.match(uid, /^sr-[a-f0-9]{32}$/);
  assert.equal(ensureLibraryUid(directory), uid);
  const state = readSharing(directory);
  const first = idempotencyFor(state, origin, 'a'.repeat(64));
  assert.equal(first.reused, false);
  updateService(directory, origin, s => ({ ...s, pending: { payloadSha256: 'a'.repeat(64), idempotencyKey: first.key } }));
  const retry = idempotencyFor(readSharing(directory), origin, 'a'.repeat(64));
  assert.deepEqual(retry, { key: first.key, reused: true });
  const changed = idempotencyFor(readSharing(directory), origin, 'b'.repeat(64));
  assert.equal(changed.reused, false);
  assert.notEqual(changed.key, first.key);
  assert.match(changed.key, /^sr1-b{24}-[a-f0-9]{12}$/);
  // Another service keeps its own record.
  assert.equal(idempotencyFor(readSharing(directory), 'http://127.0.0.1:8350', 'a'.repeat(64)).reused, false);
  const text = fs.readFileSync(sharingPath(directory), 'utf8');
  assert.ok(!/token|claim|Bearer/i.test(text), 'sharing.json must not hold secrets');
});

test('updates keep visibility and access chosen on the service unless asked to change them', async () => {
  const directory = await makeLibrary();
  const known = { collection: { visibility: 'public' }, tracks: { 'night-train': { visibility: 'private', access: 'listen-only' } } };
  updateService(directory, origin, s => ({ ...s, collection: { id: '01JCOLLECTION0000000000001', visibility: 'unlisted' } }));
  const prepared = prepareRelease(directory, { origin, known });
  assert.equal(prepared.payload.collection.visibility, 'public');
  assert.deepEqual(prepared.payload.tracks.map(t => [t.localId, t.visibility, t.access]), [['night-train', 'private', 'listen-only'], ['city-lights', 'public', 'open']]);
  const chosen = prepareRelease(directory, { origin, known, visibility: 'unlisted', access: 'open' });
  assert.deepEqual(chosen.payload.tracks.map(t => [t.visibility, t.access]), [['unlisted', 'open'], ['unlisted', 'open']]);
  assert.throws(() => prepareRelease(directory, { origin, visibility: 'everyone' }), error => error.code === 'invalid_option');
});

test('a dry run reads the library and nothing else', async () => {
  const directory = await makeLibrary();
  const home = tempDir();
  const env = { HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'), SOUNDROO_CACHE: path.join(home, 'cache'), PATH: process.env.PATH };
  const before = snapshot(directory);
  const fetchCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (...args) => { fetchCalls.push(args); throw new Error('network used'); };
  try {
    const result = await shareLibrary(directory, { dryRun: true, env, rightsAccepted: false });
    assert.equal(result.dryRun, true);
    assert.equal(result.changes, 'none');
    assert.equal(result.rightsAccepted, false);
    assert.equal(result.request.path, '/api/v1/releases');
    assert.equal(result.tool.status, 'downloaded on the first real share');
    assert.deepEqual(result.tracks.map(t => t.localId), ['night-train', 'city-lights']);
    // Real sharing refuses without the rights confirmation, before any network.
    await assert.rejects(shareLibrary(directory, { env }), error => error.code === 'rights_not_accepted' && error.exitCode === 1);
  } finally { globalThis.fetch = originalFetch; }
  assert.equal(fetchCalls.length, 0);
  assert.deepEqual(snapshot(directory), before, 'the library changed');
  assert.deepEqual(fs.readdirSync(home), [], 'configuration or cache was written');
});

test('service origins need https except on this computer', () => {
  assert.equal(parseOrigin('HTTPS://SoundRoo.com:443/'), 'https://soundroo.com');
  assert.equal(parseOrigin('http://127.0.0.1:8350'), 'http://127.0.0.1:8350');
  assert.equal(parseOrigin('http://[::1]:8350/'), 'http://[::1]:8350');
  for (const bad of ['http://soundroo.com', 'https://soundroo.com/api', 'https://a:b@soundroo.com', 'https://soundroo.com?x', 'ftp://soundroo.com', 'soundroo.com']) assert.throws(() => parseOrigin(bad), TypeError, bad);
  assert.equal(resolveService(undefined, {}), 'https://soundroo.com');
  assert.equal(resolveService(undefined, { SOUNDROO_URL: 'http://localhost:8350' }), 'http://localhost:8350');
  assert.equal(resolveService('https://staging.example', { SOUNDROO_URL: 'http://localhost:8350' }), 'https://staging.example');
});
