import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileScore, validateScore, parsePitch } from '../src/score.js';
import { getCatalog } from '../src/catalog.js';
import { renderScore } from '../src/render.js';
import { note, chordPitches, chordNotes, pattern, arrangePattern, transformPattern, arpeggiate } from '../src/compose.js';
import { buildExampleCollection } from '../examples/collection.js';
import { encodeWav } from '../src/audio/wav.js';
import { parseWav } from '../src/audio/pcm.js';

const fixture = () => ({ version: 1, id: 'test-song', title: 'A short original phrase', bpm: 120, beats: 8, seed: 29, master: { volume: 0.8, reverb: 0 }, sections: [{ id: 'phrase', name: 'Phrase', beat: 0, beats: 8 }], parts: [{ id: 'keys', name: 'Keys', instrument: 'electric-piano', volume: 0.8, pan: -0.25, notes: [note('C4', 0, 1.5), note('E4', 2, 1), note('G4', 4, 2)] }, { id: 'low', name: 'Bass', instrument: 'bass', volume: 0.7, pan: 0.3, notes: [note('C2', 0, 3), note('G2', 4, 2)] }] });
const samples = result => result.audio.getChannelData(0);
const changed = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true; return false; };
const options = { sampleRate: 12000, to: 2 };

test('malformed scores return actionable field paths and compile rejects them', () => {
  for (const score of [null, [], 'score', { version: 2, id: '../unsafe', title: '', bpm: NaN, beats: Infinity, parts: [] }]) {
    const result = validateScore(score);
    assert.equal(result.valid, false);
    assert.ok(result.issues.every(i => typeof i.path === 'string' && i.message));
    assert.throws(() => compileScore(score), error => error.name === 'ScoreValidationError' && error.issues.length > 0);
  }
  const score = fixture();
  score.parts[0].notes[0] = { pitch: 'H4', beat: -1, duration: 0, velocity: 2 };
  score.parts[0].pan = Infinity;
  score.parts[0].tone = { unknown: 1 };
  score.parts[1].id = 'keys';
  const paths = validateScore(score).issues.map(i => i.path);
  for (const path of ['parts[0].notes[0].pitch', 'parts[0].notes[0].beat', 'parts[0].notes[0].duration', 'parts[0].notes[0].velocity', 'parts[0].pan', 'parts[0].tone.unknown', 'parts[1].id']) assert.ok(paths.includes(path), path);
  const long = fixture(); long.beats = 1201;
  assert.equal(validateScore(long).valid, false);
  const over = fixture(); over.parts = Array.from({ length: 65 }, (_, i) => ({ ...over.parts[0], id: `part-${i}` }));
  assert.ok(validateScore(over).issues.some(i => i.path === 'parts'));
});

test('pitch, chord, arpeggio and clip expansion preserve exact musical timing', () => {
  assert.equal(parsePitch('C4'), 60); assert.equal(parsePitch('Bb3'), 58); assert.equal(parsePitch('C-1'), 0);
  assert.throws(() => parsePitch('C10'));
  assert.deepEqual(chordPitches('C4', 'min7', { inversion: 1 }), [63, 67, 70, 72]);
  assert.deepEqual(chordNotes(['C4', 'E4', 'G4'], 1, 0.5, 0.6, { strum: 0.1 }).map(n => n.beat), [1, 1.1, 1.2]);
  const arp = arpeggiate([60, 64, 67], { step: 0.5, beats: 2, gate: 0.5 });
  assert.deepEqual(arp.map(n => [n.pitch, n.beat, n.duration]), [[60, 0, 0.25], [64, 0.5, 0.25], [67, 1, 0.25], [60, 1.5, 0.25]]);
  const score = fixture(); score.parts = [{ ...score.parts[0], notes: [note('G4', 7, 0.5)] }];
  const source = pattern(2, [note('C4', 0, 0.5, 0.8), note('E4', 1, 0.5, 0.6)]);
  arrangePattern(score.parts[0], 'question', source, { beat: 1, repeat: 2, transpose: 7, velocity: 0.5 });
  const original = structuredClone(score);
  const compiled = compileScore(score);
  assert.deepEqual(compiled.parts[0].notes.map(n => [n.pitch, n.beat, n.duration, n.velocity]), [[67, 1, 0.5, 0.4], [71, 2, 0.5, 0.3], [67, 3, 0.5, 0.4], [71, 4, 0.5, 0.3], [67, 7, 0.5, 0.7]]);
  assert.deepEqual(score, original); assert.deepEqual(compileScore(compiled), compiled);
  assert.deepEqual(transformPattern(source, { reverse: true, transpose: 12 }).notes.map(n => [n.pitch, n.beat]), [[76, 0.5], [72, 1.5]]);
  score.parts[0].clips[0].repeat = 4;
  assert.ok(validateScore(score).issues.some(i => i.path === 'parts[0].clips[0]'));
  score.parts[0].clips[0].pattern = 'missing';
  assert.ok(validateScore(score).issues.some(i => i.message.includes('Unknown pattern')));
});

test('expansion is bounded before allocating repeated note events', () => {
  const score = fixture(); score.beats = 1000;
  score.parts[0].patterns = { dense: pattern(0.1, Array.from({ length: 100 }, () => note(60, 0, 0.01))) };
  score.parts[0].clips = [{ pattern: 'dense', beat: 0, repeat: 2000 }];
  const result = validateScore(score);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(i => i.message.includes('100000 events')));
});

test('ten complete examples have unique music, form, speech boundaries and editable sources', () => {
  const { collection, tracks } = buildExampleCollection();
  assert.equal(collection.source, 'examples'); assert.equal(tracks.length, 10);
  assert.deepEqual(collection.tracks, tracks.map(t => t.id));
  assert.equal(new Set(tracks.map(t => t.genre)).size, 10);
  const signatures = new Set();
  const assets = new Set();
  let speechTracks = 0;
  for (const score of tracks) {
    const compiled = compileScore(score);
    assert.ok(score.sections.length >= 3);
    const seconds = score.beats * 60 / score.bpm;
    assert.ok(seconds >= 60 && seconds <= 150);
    assert.ok(score.sections.at(-1).name);
    assert.equal(score.sections.at(-1).beat + score.sections.at(-1).beats, score.beats);
    assert.ok(compiled.parts.some(p => p.notes.length > 20));
    signatures.add(JSON.stringify(compiled.parts.find(p => p.notes.length > 20).notes.slice(0, 12).map(n => [n.pitch, n.beat])));
    if (score.parts.some(p => p.sample)) speechTracks++;
    for (const p of score.parts) if (p.sample) assets.add(p.sample.asset);
  }
  assert.equal(signatures.size, 10); assert.equal(speechTracks, 2); assert.equal(assets.size, 6);
  assert.deepEqual(buildExampleCollection({ seed: 44 }), buildExampleCollection({ seed: 44 }));
  for (const scale of [0.05, 0.25, 0.5, 1.1, 4]) for (const score of buildExampleCollection({ durationScale: scale }).tracks) assert.equal(validateScore(score).valid, true, `${scale} ${score.id}: ${JSON.stringify(validateScore(score).issues)}`);
});

test('all presets produce finite audible samples and supported tone controls change sound', async () => {
  const catalog = getCatalog();
  assert.equal(catalog.instruments.length, 32);
  for (const preset of catalog.instruments) {
    const score = fixture(); score.parts = [{ ...score.parts[0], instrument: preset.id, notes: [note(preset.drums ? 36 : 60, 0, 2)] }];
    if (preset.id === 'sample') score.parts[0].sample = { asset: 'builtin:made-of-light', effect: 'dry' };
    const result = await renderScore(score, options);
    assert.equal(result.audio.numberOfChannels, 2);
    assert.equal(result.report.nonFinite, 0, preset.id); assert.equal(result.report.clipped, 0, preset.id);
    assert.ok(result.report.rms > 0.0001, preset.id); assert.ok(result.report.peak <= 0.892, preset.id);
    for (const [name, spec] of Object.entries(preset.controls)) {
      score.parts[0].tone = { [name]: spec.min === spec.default ? spec.max : spec.min };
      const modified = await renderScore(score, options);
      assert.ok(changed(samples(result), samples(modified)), `${preset.id}.${name}`);
    }
  }
  catalog.instruments[0].id = 'mutated';
  assert.equal(getCatalog().instruments[0].id, 'electric-piano');
});

test('representative sections of every example render to audible stereo WAV-compatible buffers', async () => {
  for (const score of buildExampleCollection().tracks) {
    const start = score.sections[1].beat * 60 / score.bpm;
    const result = await renderScore(score, { sampleRate: 12000, from: start, to: start + 3 });
    assert.equal(result.audio.length, 36000);
    assert.equal(result.report.nonFinite, 0, score.id); assert.equal(result.report.clipped, 0, score.id);
    assert.ok(result.report.rms > 0.002, `${score.id}: ${result.report.rms}`);
    assert.ok(changed(result.audio.getChannelData(0), result.audio.getChannelData(1)), score.id);
    assert.equal(result.report.sections.length, score.sections.length);
    assert.deepEqual(result.report.warnings, []);
    const wav = parseWav(encodeWav(result.audio));
    assert.equal(wav.channels.length, 2); assert.equal(wav.channels[0].length, 36000);
  }
});

test('same input is deterministic and note or seed edits alter audible output', async () => {
  const score = fixture(); score.parts.push({ id: 'hat', instrument: 'hi-hat', notes: [note(42, 0, 0.1), note(42, 1, 0.1)] });
  const a = await renderScore(score, options), b = await renderScore(score, options);
  assert.deepEqual(samples(a), samples(b)); assert.deepEqual(a.report, b.report);
  score.parts[0].notes[0].pitch = 62;
  assert.ok(changed(samples(a), samples(await renderScore(score, options))));
  score.parts[0].notes[0].pitch = 60; score.seed++;
  assert.ok(changed(samples(a), samples(await renderScore(score, options))));
});

test('mute, solo, pan, part/master gain and dry stems materially affect the mix', async () => {
  const score = fixture();
  const full = await renderScore(score, { ...options, stems: true });
  const mute = await renderScore(score, { ...options, mix: { parts: { low: { mute: true } } } });
  const solo = await renderScore(score, { ...options, mix: { parts: { keys: { solo: true } } } });
  assert.ok(changed(samples(full), samples(mute))); assert.deepEqual(samples(mute), samples(solo));
  const silent = await renderScore(score, { ...options, stems: true, mix: { parts: { keys: { mute: true, solo: true }, low: { mute: true } } } });
  assert.equal(silent.report.peak, 0); assert.equal(silent.stems.keys.getChannelData(0).some(v => v !== 0), false);
  const reduced = await renderScore(score, { ...options, mix: { master: { volume: 0.4 } } });
  assert.ok(Math.abs(reduced.report.rms / full.report.rms - 0.5) < 0.001);
  // A quieter part changes the balance; the master then brings the whole render back to the same loudness.
  const quieterPart = await renderScore(score, { ...options, stems: true, mix: { parts: { keys: { volume: 0.1 } } } });
  const stemRms = r => { const data = r.stems.keys.getChannelData(0); return Math.sqrt(data.reduce((n, x) => n + x * x, 0) / data.length); };
  assert.ok(stemRms(quieterPart) < stemRms(full) * 0.2);
  assert.ok(changed(samples(full), samples(quieterPart)));
  const left = await renderScore(score, { ...options, mix: { parts: { keys: { solo: true, pan: -1 } } } });
  assert.ok(left.audio.getChannelData(0).some(v => v !== 0)); assert.ok(left.audio.getChannelData(1).every(v => Math.abs(v) < 1e-12));
  assert.deepEqual(Object.keys(full.stems), ['keys', 'low']);
  assert.match(full.report.stemDescription, /do not sum/);
  await assert.rejects(renderScore(score, { ...options, mix: { parts: { keys: { volume: NaN } } } }), /keys.volume/);
  await assert.rejects(renderScore(score, { ...options, mix: { parts: { missing: { mute: true } } } }), /Unknown mix part/);
});

test('excerpts preserve note and effect state at the requested seconds', async () => {
  const score = fixture(); score.master.reverb = 0.4;
  const full = await renderScore(score, { sampleRate: 12000 });
  const excerpt = await renderScore(score, { sampleRate: 12000, from: 1.125, to: 2.625 });
  for (let c = 0; c < 2; c++) assert.deepEqual(excerpt.audio.getChannelData(c), full.audio.getChannelData(c).slice(13500, 31500));
  assert.equal(excerpt.report.from, 1.125);
  await assert.rejects(renderScore(score, { from: 2, to: 1 }), /after from/);
  await assert.rejects(renderScore(score, { sampleRate: Infinity }), /sampleRate/);
});

test('speech effects and local project WAVs render, while missing or escaped assets fail clearly', async () => {
  const score = fixture(); score.parts = [{ id: 'speech', instrument: 'sample', notes: [note(57, 0, 4)], sample: { asset: 'builtin:in-the-rhythm', effect: 'dry' } }];
  const signatures = [];
  for (const effect of getCatalog().sampleEffects) {
    score.parts[0].sample.effect = effect;
    score.parts[0].sample.semitones = 3;
    const result = await renderScore(score, options);
    assert.equal(result.report.nonFinite, 0); assert.ok(result.report.rms > 0.001, effect);
    signatures.push(samples(result));
  }
  for (let i = 1; i < signatures.length; i++) assert.ok(changed(signatures[0], signatures[i]));
  const root = await mkdtemp(join(tmpdir(), 'soundroo-audio-'));
  try {
    await mkdir(join(root, 'assets'));
    const tone = Float32Array.from({ length: 12000 }, (_, i) => 0.25 * Math.sin(2 * Math.PI * 220 * i / 12000));
    const wav = encodeWav({ length: tone.length, sampleRate: 12000, numberOfChannels: 1, getChannelData: () => tone });
    await writeFile(join(root, 'assets', 'tone.wav'), new Uint8Array(wav));
    await writeFile(join(root, 'outside.wav'), new Uint8Array(wav));
    score.parts[0].sample = { asset: 'assets/tone.wav', effect: 'dry' };
    await assert.rejects(renderScore(score, options), /projectDir/);
    assert.ok((await renderScore(score, { ...options, projectDir: root })).report.rms > 0.01);
    score.parts[0].sample.asset = 'assets/missing.wav';
    await assert.rejects(renderScore(score, { ...options, projectDir: root }), /ENOENT/);
    await symlink(join(root, 'outside.wav'), join(root, 'assets', 'escaped.wav'));
    score.parts[0].sample.asset = 'assets/escaped.wav';
    await assert.rejects(renderScore(score, { ...options, projectDir: root }), /within the project assets/);
    score.parts[0].sample.asset = 'assets/../outside.wav';
    assert.equal(validateScore(score).valid, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('progress is monotonic, yields to the event loop and can cancel without partial results', async () => {
  const fractions = [], controller = new AbortController();
  let yielded = false;
  setImmediate(() => { yielded = true; });
  await renderScore(fixture(), { ...options, progress: p => { fractions.push(p.fraction); } });
  assert.equal(yielded, true); assert.equal(fractions.at(-1), 1);
  for (let i = 1; i < fractions.length; i++) assert.ok(fractions[i] >= fractions[i - 1]);
  await assert.rejects(renderScore(fixture(), { ...options, progress: p => p.phase !== 'rendering' }), { name: 'AbortError' });
  controller.abort();
  await assert.rejects(renderScore(fixture(), { ...options, signal: controller.signal }), { name: 'AbortError' });
  const during = new AbortController(); setImmediate(() => during.abort());
  await assert.rejects(renderScore(fixture(), { ...options, signal: during.signal }), { name: 'AbortError' });
});

test('chip instruments render pulse and triangle waves and the pulse width changes the sound', async () => {
  const score = duty => ({
    version: 2, id: 'chip', title: 'Chip', bpm: 150, beats: 8, seed: 1, master: { volume: 0.9, reverb: 0 },
    parts: [
      { id: 'lead', instrument: 'chip-lead', tone: { duty }, patterns: { a: { beats: 4, line: 'A4/.25 C#5 E5 A5 E5 C#5 A4 C#5 A4/2' } }, clips: [{ pattern: 'a', beat: 0, repeat: 2 }] },
      { id: 'bass', instrument: 'chip-bass', patterns: { b: { beats: 4, line: 'A2/.5 A3 A2 A3 E2 E3 E2 E3' } }, clips: [{ pattern: 'b', beat: 0, repeat: 2 }] },
    ],
  });
  const thin = await renderScore(score(0.125));
  const square = await renderScore(score(0.5));
  assert.ok(thin.report.rmsDb > -40 && thin.report.peakDb < 0, 'audible and not clipping');
  let difference = 0;
  const [a, b] = [thin.audio.getChannelData(0), square.audio.getChannelData(0)];
  for (let i = 0; i < a.length; i += 97) difference += Math.abs(a[i] - b[i]);
  assert.ok(difference > 1, 'the duty setting changes the waveform');
  assert.deepEqual(validateScore({ ...score(0.9) }).issues.map(i => i.path), ['parts[0].tone.duty']);
});

test('the synthesized sound plays recorded instruments by synthesis on the same timeline', async () => {
  const score = fixture();
  score.parts = ['piano', 'guitar-crunch', 'electric-bass', 'rock-kick', 'closed-hat', 'brass', 'strings'].map((instrument, i) => ({ ...score.parts[0], id: `p${i}`, instrument, tone: {}, notes: [note(instrument === 'rock-kick' || instrument === 'closed-hat' ? 36 : 55 + i, 0, 1), note(60, 1, 1)] }));
  const recorded = await renderScore(score, options);
  const synthesized = await renderScore(score, { ...options, sound: 'synthesized' });
  assert.equal(synthesized.report.sound, 'synthesized'); assert.equal(recorded.report.sound, 'recorded');
  assert.equal(synthesized.audio.length, recorded.audio.length);
  assert.equal(synthesized.report.nonFinite, 0); assert.ok(synthesized.report.rms > 0.0001);
  assert.ok(changed(samples(recorded), samples(synthesized)));
  assert.deepEqual(samples(await renderScore(score, { ...options, sound: 'synthesized' })), samples(synthesized));
  await assert.rejects(renderScore(score, { ...options, sound: 'orchestral' }), /sound must be one of/);
});
