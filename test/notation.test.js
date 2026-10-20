import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLine, parseSteps, STEP_VELOCITY } from '../src/notation.js';
import { compileScore, validateScore } from '../src/score.js';
import { renderScore } from '../src/render.js';
import { getCatalog } from '../src/catalog.js';

const events = notes => notes.map(n => [n.pitch, +n.beat.toFixed(9), +n.duration.toFixed(9), n.velocity]);
const compact = () => ({
  version: 2, id: 'compact', title: 'Compact', bpm: 120, beats: 16, seed: 3,
  parts: [
    { id: 'drums', instrument: 'rock-kick', patterns: { beat: { beats: 4, steps: 'X...|x..o|x.x.|....' } }, clips: [{ pattern: 'beat', beat: 0, repeat: 4 }] },
    { id: 'lead', instrument: 'fm-lead', patterns: { hook: { beats: 8, line: 'G4/.5 Eb5 [C4 Eb4 G4]/2@.6 -/1 C5/1/3 D5 Eb5 F5/2' } }, clips: [{ pattern: 'hook', beat: 0, repeat: 2, transpose: 2 }] },
    { id: 'bass', instrument: 'electric-bass', patterns: { pedal: { beats: 2, steps: 'x.x.', pitch: 'C2' } }, clips: [{ pattern: 'pedal', beat: 8, repeat: 4 }] },
  ],
});

test('steps spread X/x/o hits evenly over the pattern and ignore bars and spaces', () => {
  assert.deepEqual(STEP_VELOCITY, { X: 0.95, x: 0.75, o: 0.4 });
  assert.deepEqual(events(parseSteps('X..x|.o..', 4, 36).notes), [[36, 0, 0.5, 0.95], [36, 1.5, 0.5, 0.75], [36, 2.5, 0.5, 0.4]]);
  assert.deepEqual(events(parseSteps('x x x', 2).notes), [[60, 0, 2 / 3, 0.75], [60, 2 / 3, 2 / 3, 0.75], [60, 4 / 3, 2 / 3, 0.75]].map(([p, b, d, v]) => [p, +b.toFixed(9), +d.toFixed(9), v]));
  assert.match(parseSteps('x..y', 4).issues[0], /Character 4 “y”/);
  assert.deepEqual(parseSteps(' | ', 4).issues, ['Write at least one step.']);
});

test('lines keep durations until changed and support chords, rests, fractions and accents', () => {
  const { notes, issues } = parseLine('G4/.5 Eb5 [C4 Eb4 G4]/2@.6 -/1 C5/1/3 D5 Eb5 | 60/2@1', 8);
  assert.deepEqual(issues, []);
  assert.deepEqual(events(notes), [
    [67, 0, 0.5, 0.7], [75, 0.5, 0.5, 0.7], [60, 1, 2, 0.6], [63, 1, 2, 0.6], [67, 1, 2, 0.6],
    [72, 4, +(1 / 3).toFixed(9), 0.7], [74, +(4 + 1 / 3).toFixed(9), +(1 / 3).toFixed(9), 0.7], [75, +(4 + 2 / 3).toFixed(9), +(1 / 3).toFixed(9), 0.7], [60, 5, 2, 1],
  ]);
  assert.deepEqual(events(parseLine('C4 D4/2 E4', 8).notes).map(n => [n[1], n[2]]), [[0, 1], [1, 2], [3, 2]]);
  assert.deepEqual(parseLine('| - - |', 4), { notes: [], issues: [] });
});

test('line errors name each bad token and the overflow', () => {
  const { issues } = parseLine('G4/.5 H4 Q/1@2 -@.5 G4/0 C4/1/0 [ ]/1 [C4 E4]x 128 [C4 E4', 8);
  assert.match(issues[0], /^Token 2 “H4”: Expected a MIDI integer/);
  assert.match(issues[1], /^Token 3 “Q\/1@2”: velocity/);
  assert.match(issues[2], /^Token 4 “-@\.5”: a rest has no velocity/);
  assert.match(issues[3], /^Token 5 “G4\/0”: the duration/);
  assert.match(issues[4], /^Token 6 “C4\/1\/0”: the duration/);
  assert.match(issues[5], /^Token 7 “\[ \]\/1”: the chord is empty/);
  assert.match(issues[6], /^Token 8 “\[C4 E4\]x”: write pitch/);
  assert.match(issues[7], /^Token 9 “128”/);
  assert.match(parseLine('C4 [E4 G4', 8).issues[0], /Character 4: the chord “\[” is never closed/);
  assert.deepEqual(parseLine('C4/4 D4/4 E4/1', 8).issues, ['The line lasts 9 beats, longer than the pattern’s 8.']);
  assert.equal(parseLine('C4/4 D4/4 E4/1', 8).notes.length, 2);
  assert.deepEqual(parseLine('', 4).issues, ['Write at least one note or rest.']);
});

test('version 2 scores compile to ordinary version 1 notes identical to hand-written notes', async () => {
  const score = compact(), original = structuredClone(score);
  assert.deepEqual(validateScore(score), { valid: true, issues: [] });
  const compiled = compileScore(score);
  assert.deepEqual(score, original);
  assert.equal(compiled.version, 1);
  assert.deepEqual(compileScore(compiled), compiled);
  assert.equal(compiled.parts[0].notes.length, 20);
  assert.deepEqual(events(compiled.parts[2].notes.slice(0, 3)), [[36, 8, 0.5, 0.75], [36, 9, 0.5, 0.75], [36, 10, 0.5, 0.75]]);
  // The same music spelled out as version 1 notes.
  const manual = { ...structuredClone(score), version: 1, parts: compiled.parts.map(({ id, instrument, notes }) => ({ id, instrument, notes: notes.map(n => ({ ...n })) })) };
  assert.deepEqual(compileScore(manual).parts.map(p => p.notes), compiled.parts.map(p => p.notes));
  const options = { sampleRate: 12000, to: 3 };
  const [a, b] = await Promise.all([renderScore(score, options), renderScore(manual, options)]);
  assert.deepEqual(a.audio.getChannelData(0), b.audio.getChannelData(0));
  assert.ok(a.report.rms > 0.001);
});

test('pattern strings are refused where they would be ignored or lose notes', () => {
  const issues = score => validateScore(score).issues;
  const v1 = compact(); v1.version = 1;
  assert.deepEqual(issues(v1).map(i => [i.path, i.message]), [['parts[0].patterns.beat.steps', 'Pattern strings need score version 2.'], ['parts[1].patterns.hook.line', 'Pattern strings need score version 2.'], ['parts[2].patterns.pedal.steps', 'Pattern strings need score version 2.']]);
  assert.match(issues({ ...compact(), version: 3 })[0].message, /version 1, or version 2/);
  const misplaced = compact(); misplaced.parts[1].line = 'C4/1';
  assert.deepEqual(issues(misplaced).map(i => i.path), ['parts[1].line']);
  const loosePitch = compact(); loosePitch.parts[1].patterns.hook.pitch = 'C4';
  assert.deepEqual(issues(loosePitch).map(i => i.path), ['parts[1].patterns.hook.pitch']);
  const badPitch = compact(); badPitch.parts[2].patterns.pedal.pitch = 'Z9';
  assert.deepEqual(issues(badPitch).map(i => i.path), ['parts[2].patterns.pedal.pitch']);
  const notText = compact(); notText.parts[0].patterns.beat.steps = ['x'];
  assert.match(issues(notText)[0].message, /Expected a string/);
  const long = compact(); long.parts[0].patterns.beat.steps = 'x'.repeat(getCatalog().limits.maxNotationCharacters + 1);
  assert.equal(issues(long)[0].path, 'parts[0].patterns.beat.steps');
  const loud = compact(); loud.parts[0].clips[0].velocity = 1.1;
  assert.ok(issues(loud).some(i => i.message.includes('velocity exceeds 1')));
  const flood = compact(); flood.beats = 1000; flood.parts[0].patterns.beat = { beats: 1000, steps: 'x'.repeat(16384) };
  for (let i = 0; i < 7; i++) flood.parts[0].patterns['beat-' + i] = flood.parts[0].patterns.beat;
  assert.ok(issues(flood).some(i => i.message.includes('100000 note events')));
});

test('the compact example stays small, labeled and audible in its sections', async () => {
  const score = JSON.parse(fs.readFileSync(new URL('../examples/paper-satellites.json', import.meta.url), 'utf8'));
  assert.equal(score.origin, 'example');
  assert.ok(JSON.stringify(score).length < 6000);
  assert.deepEqual(validateScore(score), { valid: true, issues: [] });
  const compiled = compileScore(score);
  assert.ok(compiled.parts.reduce((count, part) => count + part.notes.length, 0) > 1000);
  assert.ok(compiled.parts.find(p => p.id === 'pluck').notes[0].beat < 32, 'the hook motif arrives in the opening bars');
  assert.equal(score.sections.at(-1).beat + score.sections.at(-1).beats, score.beats);
  for (const section of [score.sections[1], score.sections[3], score.sections[4]]) {
    const from = section.beat * 60 / score.bpm;
    const { report } = await renderScore(score, { sampleRate: 12000, from, to: from + 2 });
    assert.ok(report.rms > 0.004, section.id);
    assert.ok(report.limitedFraction < 0.01, section.id);
  }
});

test('the worked example in the composing guide is a lively, complete track', () => {
  const score = JSON.parse(fs.readFileSync(new URL('../examples/streetlight-funk.json', import.meta.url), 'utf8'));
  assert.equal(score.origin, 'example');
  assert.deepEqual(validateScore(score), { valid: true, issues: [] });
  assert.ok(score.bpm >= 100, 'the default sound has a lively tempo');
  assert.equal(score.sections.at(-1).beat + score.sections.at(-1).beats, score.beats);
  const compiled = compileScore(score);
  const first = id => Math.min(...compiled.parts.find(p => p.id === id).notes.map(n => n.beat));
  assert.equal(first('kick'), 0, 'drums play from the first bar');
  assert.ok(first('hook') <= 16, 'the hook arrives within the first bars');
});
