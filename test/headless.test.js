import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as soundroo from '../src/headless.js';
import { addTrack, renderTrack, midiForTrack, sourceIdentity, trackInfo, writeJson, trackPath, VERSION } from '../src/project.js';
import { coverSvg } from '../src/artwork.js';
import { encodeWav } from '../src/audio/wav.js';
import { getCatalog } from '../src/catalog.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const score = () => ({
  version: 1, id: 'night-signal', title: 'Night Signal', description: 'A test phrase.', genre: 'Synth pop', bpm: 116, beats: 8, seed: 12,
  master: { volume: 0.85, reverb: 0.25 }, sections: [{ id: 'a', name: 'A', beat: 0, beats: 4 }, { id: 'b', name: 'B', beat: 4, beats: 4 }],
  artwork: { style: 'ripple', colors: ['#102e35', '#b6e0c5', '#f1f0d7'] },
  parts: [
    { id: 'lead', name: 'Lead', instrument: 'analog-lead', volume: 0.7, pan: -0.2, tone: { brightness: 3600 }, notes: [{ pitch: 'E4', beat: 0, duration: 1, velocity: 0.7 }, { pitch: 'G4', beat: 1.5, duration: 0.5, velocity: 0.6 }] },
    { id: 'kick', name: 'Kick', instrument: 'kick', notes: [{ pitch: 36, beat: 0, duration: 0.25, velocity: 0.9 }, { pitch: 36, beat: 2, duration: 0.25, velocity: 0.9 }] },
    { id: 'mallet', name: 'Mallet', instrument: 'marimba', pan: 0.3, patterns: { cell: { beats: 2, notes: [{ pitch: 'C5', beat: 0, duration: 0.5, velocity: 0.5 }, { pitch: 'D5', beat: 1, duration: 0.5, velocity: 0.5 }] } }, clips: [{ pattern: 'cell', beat: 4, repeat: 2 }] },
  ],
});

test('headless render, MIDI and revision match what the CLI and studio write', async () => {
  const directory = temp('soundroo-headless-cli-');
  try {
    const source = score();
    await addTrack(directory, source);
    const mix = { parts: { lead: { volume: 0.5, pan: 0.1 }, kick: { mute: false } }, master: { volume: 0.9 } };
    writeJson(trackPath(directory, source.id, 'mix.json'), mix);
    const stored = JSON.parse(fs.readFileSync(trackPath(directory, source.id, 'score.json'), 'utf8'));
    const local = await renderTrack(directory, source.id, { stems: true });
    const remote = await soundroo.render(stored, { mix, stems: true });
    assert.equal(remote.revision, local.revision);
    assert.equal(sourceIdentity(directory, stored, mix), soundroo.revision(stored, { mix }));
    assert.ok(remote.wav.equals(fs.readFileSync(local.file)));
    assert.deepEqual(remote.report, JSON.parse(fs.readFileSync(trackPath(directory, source.id, 'renders', local.revision + '.report.json'), 'utf8')));
    assert.deepEqual(Object.keys(remote.stems), ['lead', 'kick', 'mallet']);
    for (const [id, bytes] of Object.entries(remote.stems)) assert.ok(bytes.equals(fs.readFileSync(path.join(local.stemsDir, id + '.wav'))), id);
    assert.equal(remote.report.source, 'editable-score');
    assert.equal(remote.duration, Math.round(8 * 60 / 116 * 44100) / 44100);
    assert.ok((await midiForTrack(directory, source.id)).equals(soundroo.midi(stored)));
    assert.equal(soundroo.sleeve(stored, { index: 2 }), coverSvg(stored, { index: 2 }));
    assert.match(soundroo.sleeve(stored, { artwork: { style: 'sun' } }), /<svg/);
    assert.notEqual(soundroo.sleeve(stored, { artwork: { style: 'sun' } }), soundroo.sleeve(stored));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('the engine hash covers rendering, validation and identity source, independent of line endings', async () => {
  const manifest = soundroo.engineManifest().map(f => f.path);
  for (const file of ['src/score.js', 'src/notation.js', 'src/render.js', 'src/catalog.js', 'src/speech.js', 'src/headless.js', 'src/identity.js', 'src/audio/synth.js', 'src/audio/midi.js', 'src/audio/sampler.js', 'assets/voices/made-of-light.wav', 'assets/samples/samples.json', 'assets/samples/piano/60-2-1.wav']) assert.ok(manifest.includes(file), file);
  for (const file of ['src/server.js', 'src/project.js', 'src/version.js', 'src/voice.js', 'src/artwork.js', 'src/compose.js', 'bin/soundroo.js', 'web/index.html', 'package.json']) assert.ok(!manifest.includes(file), file);
  assert.match(soundroo.engineHash(), /^[0-9a-f]{64}$/);
  const copy = temp('soundroo-engine-copy-');
  try {
    for (const folder of ['src', 'assets']) fs.cpSync(path.join(ROOT, folder), path.join(copy, folder), { recursive: true });
    const identity = await import(pathToFileURL(path.join(copy, 'src/identity.js')).href);
    const hash = () => JSON.stringify(identity.engineManifest());
    const original = hash();
    assert.equal(original, JSON.stringify(soundroo.engineManifest()));
    for (const file of ['src/server.js', 'src/project.js', 'src/version.js']) fs.appendFileSync(path.join(copy, file), '\n// network and studio changes\n');
    const render = path.join(copy, 'src/render.js');
    fs.writeFileSync(render, fs.readFileSync(render, 'utf8').replace(/\r?\n/g, '\r\n'));
    const samples = path.join(copy, 'assets/samples/samples.json');
    fs.writeFileSync(samples, fs.readFileSync(samples, 'utf8').replace(/\r?\n/g, '\r\n'));
    assert.equal(hash(), original);
    fs.appendFileSync(render, '// engine change\r\n');
    assert.notEqual(hash(), original);
    fs.writeFileSync(render, fs.readFileSync(path.join(ROOT, 'src/render.js')));
    fs.appendFileSync(path.join(copy, 'src/identity.js'), '\n// identity contract change\n');
    assert.notEqual(hash(), original);
  } finally { fs.rmSync(copy, { recursive: true, force: true }); }
});

test('revisions follow score, mix, sample rate and local WAV bytes, not JSON key order', () => {
  const source = score(), mix = { master: { volume: 1 }, parts: { lead: { pan: 0.4 } } };
  const revision = soundroo.revision(source, { mix });
  assert.match(revision, /^[0-9a-f]{24}$/);
  const reordered = Object.fromEntries(Object.entries(structuredClone(source)).reverse());
  reordered.parts = reordered.parts.map(part => Object.fromEntries(Object.entries(part).reverse()));
  assert.equal(soundroo.revision(reordered, { mix: { parts: { lead: { pan: 0.4 } }, master: { volume: 1 } } }), revision);
  assert.equal(soundroo.revision(JSON.parse(JSON.stringify(source)), { mix: JSON.parse(JSON.stringify(mix)) }), revision);
  assert.notEqual(soundroo.revision(source), revision);
  assert.notEqual(soundroo.revision(source, { mix, sampleRate: 48000 }), revision);
  assert.notEqual(soundroo.revision({ ...source, title: 'Renamed' }, { mix }), revision);
  const directory = temp('soundroo-revision-assets-');
  try {
    fs.mkdirSync(path.join(directory, 'assets'));
    const tone = Float32Array.from({ length: 8000 }, (_, i) => 0.2 * Math.sin(i / 9));
    const write = scale => fs.writeFileSync(path.join(directory, 'assets', 'tone.wav'), Buffer.from(encodeWav({ length: tone.length, sampleRate: 8000, numberOfChannels: 1, getChannelData: () => tone.map(v => v * scale) })));
    const sampled = score(); sampled.parts.push({ id: 'words', instrument: 'sample', sample: { asset: 'assets/tone.wav' }, notes: [{ pitch: 60, beat: 0, duration: 1, velocity: 0.5 }] });
    write(1);
    assert.throws(() => soundroo.revision(sampled), /projectDir/);
    const first = soundroo.revision(sampled, { projectDir: directory });
    write(0.5);
    assert.notEqual(soundroo.revision(sampled, { projectDir: directory }), first);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  const spoken = score(); spoken.parts.push({ id: 'words', instrument: 'sample', sample: { speech: { text: 'Hold on' } }, notes: [{ pitch: 60, beat: 0, duration: 1, velocity: 0.5 }] });
  assert.match(soundroo.revision(spoken), /^[0-9a-f]{24}$/);
});

test('fingerprints identify the music and ignore metadata, ids, order, mix, artwork and unread values', () => {
  const base = soundroo.fingerprint(score());
  assert.match(base, /^fp1:[0-9a-f]{64}$/);
  const same = score();
  Object.assign(same, { id: 'copy', title: 'Copy', description: '', genre: 'Other', mood: 'Any', key: 'C', seed: 99, beats: 12, origin: 'personal', artwork: { style: 'sun' }, master: { volume: 1.5, reverb: 0 }, sections: [] });
  same.parts.reverse();
  for (const [i, part] of same.parts.entries()) Object.assign(part, { id: `part-${i}`, name: 'Renamed', color: '#ffffff', volume: 1.9, pan: 0.9 });
  same.parts.find(p => p.instrument === 'kick').notes = [{ pitch: 40, beat: 2, duration: 1, velocity: 0.9 }, { pitch: 'C1', beat: 0, duration: 0.1, velocity: 0.9 }];
  const mallet = same.parts.find(p => p.instrument === 'marimba');
  mallet.notes = [4, 5, 6, 7].map((beat, i) => ({ pitch: ['C5', 'D5'][i % 2], beat, duration: 0.25, velocity: 0.5 }));
  delete mallet.patterns; delete mallet.clips;
  same.parts.find(p => p.instrument === 'analog-lead').tone = { brightness: 3600, attack: 0.02, release: 0.4, detune: 8 };
  assert.equal(soundroo.fingerprint(same), base);
  const compact = { ...score(), version: 2 };
  compact.parts[2] = { id: 'mallet', instrument: 'marimba', patterns: { cell: { beats: 2, line: 'C5/.5@.5 -/.5 D5@.5' } }, clips: [{ pattern: 'cell', beat: 4, repeat: 2 }] };
  compact.parts[1] = { id: 'kick', instrument: 'kick', patterns: { beat: { beats: 4, line: '36/2@.9 36@.9' } }, clips: [{ pattern: 'beat', beat: 0 }] };
  assert.equal(soundroo.fingerprint(compact), base);
  assert.equal(soundroo.fingerprint(soundroo.compile(compact)), base);
  const silent = score(); silent.parts.push({ id: 'ghost', instrument: 'pad', volume: 0, notes: [{ pitch: 60, beat: 0, duration: 4, velocity: 0.5 }] });
  assert.equal(soundroo.fingerprint(silent), base);
  const changes = [
    s => { s.parts[0].notes[0].pitch = 'F4'; }, s => { s.parts[0].notes[0].beat = 0.25; }, s => { s.parts[0].notes[0].velocity = 0.71; },
    s => { s.parts[0].notes[0].duration = 2; }, s => { s.parts[0].instrument = 'fm-lead'; delete s.parts[0].tone; }, s => { s.parts[0].tone.brightness = 3000; },
    s => { s.bpm = 117; }, s => { s.parts[1].notes[1].beat = 3; }, s => { s.parts[2].clips[0].transpose = 2; },
    s => { s.parts.push({ id: 'pad', instrument: 'pad', notes: [{ pitch: 60, beat: 0, duration: 4, velocity: 0.4 }] }); },
  ];
  const seen = new Set([base]);
  for (const change of changes) { const changed = score(); change(changed); seen.add(soundroo.fingerprint(changed)); }
  assert.equal(seen.size, changes.length + 1);
  assert.throws(() => soundroo.fingerprint({ version: 1 }), { name: 'ScoreValidationError' });
});

test('speech recipes validate, fingerprint by words and render from the phrase cache', async () => {
  const spoken = (sample, extra = {}) => ({ ...score(), parts: [{ id: 'voice', instrument: 'sample', sample, notes: [{ pitch: 60, beat: 0, duration: 3, velocity: 0.8 }], ...extra }] });
  const recipe = spoken({ speech: { text: '  Carry the   lantern home ', voice: 'am_michael' }, effect: 'vocoder', pitch: 62, stretch: 2 });
  assert.deepEqual(soundroo.validate(recipe), { valid: true, issues: [] });
  assert.deepEqual(soundroo.compile(recipe).parts[0].sample, { speech: { text: 'Carry the lantern home', voice: 'am_michael' }, effect: 'vocoder', pitch: 62, semitones: 0, stretch: 2 });
  assert.equal(soundroo.compile(spoken({ speech: { text: 'Hi' } })).parts[0].sample.speech.voice, 'af_heart');
  assert.deepEqual(getCatalog().speechVoices, soundroo.engineInfo().speech.voices);
  const invalid = sample => soundroo.validate(spoken(sample)).issues.map(i => i.path);
  assert.deepEqual(invalid({ speech: { text: 'x'.repeat(201) } }), ['parts[0].sample.speech.text']);
  assert.deepEqual(invalid({ speech: { text: 'Hi', voice: 'xx_none', speed: 2 } }), ['parts[0].sample.speech.speed', 'parts[0].sample.speech.voice']);
  assert.deepEqual(invalid({ speech: { text: 'Hi' }, asset: 'builtin:made-of-light' }), ['parts[0].sample']);
  assert.deepEqual(invalid({ speech: 'Hi' }), ['parts[0].sample.speech']);
  const many = { ...score(), parts: Array.from({ length: 17 }, (_, i) => ({ id: `v${i}`, instrument: 'sample', sample: { speech: { text: `Phrase ${i}` } }, notes: [{ pitch: 60, beat: 0, duration: 1, velocity: 0.5 }] })) };
  assert.deepEqual(soundroo.validate(many).issues.map(i => i.path), ['parts[16].sample.speech']);
  assert.equal(soundroo.fingerprint(recipe), soundroo.fingerprint(spoken({ speech: { text: 'Carry the lantern home', voice: 'am_michael' }, effect: 'vocoder', pitch: 62 })));
  assert.notEqual(soundroo.fingerprint(recipe), soundroo.fingerprint(spoken({ speech: { text: 'Carry the lantern home', voice: 'af_heart' }, effect: 'vocoder', pitch: 62 })));
  assert.notEqual(soundroo.fingerprint(recipe), soundroo.fingerprint(spoken({ speech: { text: 'Carry the lantern', voice: 'am_michael' }, effect: 'vocoder', pitch: 62 })));
  const cacheDir = temp('soundroo-speech-cache-');
  try {
    const [entry] = soundroo.speechRecipes(recipe, { cacheDir });
    assert.deepEqual({ text: entry.text, voice: entry.voice, cached: entry.cached }, { text: 'Carry the lantern home', voice: 'am_michael', cached: false });
    assert.equal(path.dirname(entry.file), cacheDir);
    const options = { sampleRate: 16000, speech: { cacheDir, synthesize: false } };
    await assert.rejects(soundroo.render(recipe, options), /not in the speech cache/);
    const phrase = Float32Array.from({ length: 24000 }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 180 * i / 24000) * Math.sin(Math.PI * i / 24000));
    fs.writeFileSync(entry.file, Buffer.from(encodeWav({ length: phrase.length, sampleRate: 24000, numberOfChannels: 1, getChannelData: () => phrase })));
    assert.equal(soundroo.speechRecipes(recipe, { cacheDir })[0].cached, true);
    assert.deepEqual((await soundroo.prepareSpeech(recipe, { cacheDir })).map(r => r.synthesized), [false]);
    const a = await soundroo.render(recipe, options), b = await soundroo.render(recipe, options);
    assert.ok(a.wav.equals(b.wav));
    assert.ok(a.report.rms > 0.005);
    assert.equal(soundroo.midi(recipe).readUInt16BE(10), 1, 'speech stays out of MIDI; only the conductor track remains');
  } finally { fs.rmSync(cacheDir, { recursive: true, force: true }); }
  const missingCache = await soundroo.render(score(), { sampleRate: 8000, speech: { cacheDir: path.join(os.tmpdir(), 'soundroo-no-such-cache'), synthesize: false } });
  assert.ok(missingCache.report.rms > 0.001, 'instrumental scores never touch the speech cache');
});

test('engine facts, limits, artwork checks and validation errors are useful to a server', () => {
  const info = soundroo.engineInfo();
  assert.equal(info.version, JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version);
  assert.equal(info.version, VERSION);
  assert.equal(info.hash, soundroo.engineHash());
  assert.deepEqual(info.scoreVersions, [1, 2]);
  assert.equal(info.fingerprint, 'fp1');
  for (const key of ['maxSeconds', 'maxParts', 'maxEvents', 'maxPatterns', 'maxClips', 'maxNotationCharacters', 'maxSpeechRecipes', 'maxSpeechCharacters', 'minSampleRate', 'maxSampleRate', 'maxSampleSeconds', 'maxSampleBytes']) assert.ok(Number.isFinite(soundroo.LIMITS[key]), key);
  assert.match(info.speech.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(soundroo.validateArtwork({ style: 'orbit', colors: ['#000000', '#ffffff'], seed: 3 }), { valid: true, issues: [] });
  assert.deepEqual(soundroo.validateArtwork({ style: 'photo', colors: ['red'], seed: -1, image: 'x.png' }).issues.map(i => i.path), ['artwork.image', 'artwork.style', 'artwork.colors', 'artwork.seed']);
  const result = soundroo.validate({ version: 2, id: 'Bad Id', title: '', bpm: 500, beats: 4, parts: [{ id: 'x', instrument: 'theremin', notes: [{ pitch: 'C4', beat: 0, duration: 1 }] }] });
  assert.equal(result.valid, false);
  assert.deepEqual(result.issues.map(i => i.path), ['bpm', 'id', 'title', 'parts[0].instrument']);
  assert.throws(() => soundroo.compile({}), error => error.name === 'ScoreValidationError' && error.issues.length > 0);
});

test('studio detail draws version 2 pattern strings from compiled notes', async () => {
  const directory = temp('soundroo-v2-detail-');
  try {
    const compact = { version: 2, id: 'steps', title: 'Steps', bpm: 120, beats: 8, parts: [{ id: 'hat', instrument: 'hi-hat', patterns: { tick: { beats: 2, steps: 'x.x.X.x.' } }, clips: [{ pattern: 'tick', beat: 0, repeat: 4 }] }] };
    await addTrack(directory, compact);
    const detail = trackInfo(directory, 'steps', { detail: true });
    assert.equal(detail.score.parts[0].patterns.tick.steps, 'x.x.X.x.');
    assert.equal(detail.arrangement.bpm, 120);
    assert.equal(detail.arrangement.parts[0].notes.length, 16);
    await addTrack(directory, score());
    assert.equal(trackInfo(directory, 'night-signal', { detail: true }).arrangement, undefined);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('the CLI reports the toolkit version and engine hash', () => {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'bin/soundroo.js'), 'version'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), { version: VERSION, engineHash: soundroo.engineHash(), scoreVersions: [1, 2] });
});
