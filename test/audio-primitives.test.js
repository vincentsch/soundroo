import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAudio, technicalWarnings } from '../src/audio/analysis.js';
import { encodeWav } from '../src/audio/wav.js';
import { parseWav } from '../src/audio/pcm.js';
import { tapePitch, granularVoice, vocodeVoice, chopVoice } from '../src/audio/voice-effects.js';

test('WAV encoding preserves stereo timing and samples within PCM16 rounding', () => {
  const left = new Float32Array([0, 0.25, -0.5, 0.7]);
  const right = new Float32Array([0.1, -0.2, 0.3, -0.4]);
  const bytes = encodeWav({ length: 4, sampleRate: 24000, numberOfChannels: 2, getChannelData: i => i ? right : left });
  const read = parseWav(bytes);
  assert.equal(read.sampleRate, 24000);
  assert.equal(read.channels.length, 2);
  for (let c = 0; c < 2; c++) for (let i = 0; i < 4; i++) assert.ok(Math.abs(read.channels[c][i] - (c ? right[i] : left[i])) < 0.00005);
});

test('signal diagnostics distinguish silence, invalid samples and clipping', () => {
  const report = analyzeAudio([new Float32Array([0, NaN, 1.1, -0.2])], 4);
  assert.equal(report.duration, 1);
  assert.equal(report.nonFinite, 1);
  assert.equal(report.clipped, 1);
  assert.deepEqual(technicalWarnings(report).map(w => w.code), ['non_finite', 'clipping']);
  assert.ok(technicalWarnings(analyzeAudio([new Float32Array(20)], 100)).some(w => w.code === 'silent'));
});

test('voice processing produces finite audio and honors tape, grain and chop timing', () => {
  const sr = 12000;
  const input = Float32Array.from({ length: sr }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 220 * i / sr) * Math.sin(Math.PI * i / sr));
  const tape = tapePitch(input, 12);
  assert.equal(tape.length, sr / 2);
  const grain = granularVoice(input, sr, { semitones: 5, stretch: 1.5 });
  assert.equal(grain.length, sr * 1.5);
  const robot = vocodeVoice(input, sr, { pitch: 60 });
  assert.equal(robot.length, input.length);
  const chopped = chopVoice(input, sr, { bpm: 120, divisions: 2, pattern: [0, null, 2, 1] });
  assert.equal(chopped.length, sr);
  assert.equal(chopped.slice(sr / 4, sr / 2).some(value => value !== 0), false);
  for (const data of [tape, grain, robot, chopped]) {
    const report = analyzeAudio([data], sr);
    assert.equal(report.nonFinite, 0);
    assert.ok(report.rms > 0.001);
    assert.ok(report.peak < 1);
  }
});
