import test from 'node:test';
import assert from 'node:assert/strict';
import { renderScore } from '../src/render.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addTrack, midiForTrack } from '../src/project.js';

const score = (instrument, tone = {}, pitch = 57) => ({ version: 1, id: 'strings', title: 'Strings', seed: 19, bpm: 120, beats: 6, master: { volume: 0.9, reverb: 0 }, parts: [{ id: 'guitar', instrument, tone, notes: [{ pitch, beat: 0, duration: 3, velocity: 0.85 }] }] });

test('plucked strings retain pitch and deterministic state across excerpts', async () => {
  const source = score('guitar-clean'), full = await renderScore(source, { sampleRate: 16000 });
  const x = full.audio.getChannelData(0);
  let correlation = -Infinity, lag = 0;
  for (let l = 60; l < 90; l++) { let value = 0; for (let i = 2000; i < 5000; i++) value += x[i] * x[i + l]; if (value > correlation) { correlation = value; lag = l; } }
  assert.ok(Math.abs(16000 / lag - 220) < 3, 'A3 string must be tuned close to 220 Hz');
  const again = await renderScore(source, { sampleRate: 16000 });
  assert.deepEqual(again.audio.getChannelData(0), x);
  const excerpt = await renderScore(source, { sampleRate: 16000, from: 0.3, to: 1.4 });
  assert.deepEqual(excerpt.audio.getChannelData(0), x.slice(4800, 22400));
});

test('palm mute shortens string sustain and guitar overdrive precedes the mixer fader', async () => {
  const open = await renderScore(score('guitar-clean', { palmMute: 0 }), { sampleRate: 12000 });
  const muted = await renderScore(score('guitar-clean', { palmMute: 1 }), { sampleRate: 12000 });
  const energy = r => r.audio.getChannelData(0).slice(6000, 10000).reduce((n, x) => n + x * x, 0);
  assert.ok(energy(muted) < energy(open) * 0.5);
  // The master matches every render's loudness, so the fader shows on the part's dry stem.
  const source = score('guitar-crunch'), full = await renderScore(source, { sampleRate: 12000, stems: true });
  const reduced = await renderScore(source, { sampleRate: 12000, stems: true, mix: { parts: { guitar: { volume: 0.5 } } } });
  const stemRms = r => { const data = r.stems.guitar.getChannelData(0); return Math.sqrt(data.reduce((n, x) => n + x * x, 0) / data.length); };
  assert.ok(Math.abs(stemRms(reduced) / stemRms(full) - 0.5) < 0.005);
  assert.equal(full.report.nonFinite, 0); assert.equal(full.report.clipped, 0);
});

test('rock drum bodies, cymbals and open hats produce different finite signals', async () => {
  const signatures = new Set();
  for (const id of ['rock-kick', 'rock-snare', 'tom', 'crash', 'ride', 'open-hat']) {
    const r = await renderScore(score(id, {}, 45), { sampleRate: 12000 });
    assert.equal(r.report.nonFinite, 0, id); assert.equal(r.report.clipped, 0, id);
    assert.ok(r.report.rms > 0.0001, id);
    signatures.add(r.audio.getChannelData(0).slice(0, 100).join(','));
  }
  assert.equal(signatures.size, 6);
});

test('MIDI preserves new guitar program and different pitches in a tom fill', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soundroo-rock-midi-'));
  try {
    const s = score('guitar-crunch');
    s.parts.push({ id: 'fill', instrument: 'tom', notes: [41, 45, 50, 52, 55, 57].map((pitch, i) => ({ pitch, beat: i, duration: 0.2, velocity: 0.7 })) });
    await addTrack(dir, s);
    const midi = await midiForTrack(dir, s.id);
    assert.ok(midi.includes(Buffer.from([0xc0, 29])));
    for (const pitch of [41, 45, 50]) assert.ok(midi.includes(Buffer.from([0x99, pitch])), `tom ${pitch}`);
    for (const pitch of [52, 55, 57]) assert.ok(!midi.includes(Buffer.from([0x99, pitch])), `tom must not select cymbal ${pitch}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
