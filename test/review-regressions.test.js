import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initLibrary, addTrack, trackInfo, saveMix } from '../src/project.js';
import { compileScore } from '../src/score.js';
import { renderScore } from '../src/render.js';
import { coverSvg } from '../src/artwork.js';
import { buildPrompt, composeBrief } from '../web/js/logic.js';

test('opening and saving the mixer preserves omitted score defaults', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soundroo-mix-defaults-'));
  try {
    await initLibrary(dir);
    const score = { version: 1, id: 'defaults', title: 'Defaults', bpm: 120, beats: 4, parts: [{ id: 'keys', instrument: 'electric-piano', notes: [{ pitch: 60, beat: 0, duration: 1, velocity: 0.5 }] }] };
    await addTrack(dir, score);
    const expanded = compileScore(score), detail = trackInfo(dir, score.id, { detail: true });
    assert.equal(detail.parts[0].volume, expanded.parts[0].volume);
    assert.equal(detail.mix.master.volume, expanded.master.volume);
    saveMix(dir, score.id, { parts: { keys: { volume: detail.parts[0].volume, pan: 0.1, mute: false, solo: false } }, master: detail.mix.master });
    const saved = trackInfo(dir, score.id, { detail: true });
    assert.equal(saved.parts[0].volume, expanded.parts[0].volume);
    assert.equal(saved.mix.master.volume, expanded.master.volume);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('overloaded mixes come out at the target loudness, below full scale and unsquashed', async () => {
  const score = { version: 1, id: 'overload', title: 'Overload', bpm: 120, beats: 4, master: { volume: 2, reverb: 0 }, parts: [{ id: 'pad', instrument: 'pad', volume: 2, notes: Array.from({ length: 40 }, (_, i) => ({ pitch: 48 + i % 12, beat: 0, duration: 3, velocity: 1 })) }] };
  const { report } = await renderScore(score, { sampleRate: 12000 });
  assert.equal(report.clipped, 0);
  assert.ok(report.peakDb <= -0.99, report.peakDb);
  assert.ok(Math.abs(report.loudness - -14) < 1.5, String(report.loudness));
  assert.ok(report.limitedFraction <= 0.005);
  assert.deepEqual(report.warnings, []);
});

test('a lower master volume turns the render down from the target, a higher one cannot push past it', async () => {
  const score = { version: 1, id: 'levels', title: 'Levels', bpm: 120, beats: 8, master: { volume: 0.8, reverb: 0 }, parts: [{ id: 'keys', instrument: 'electric-piano', notes: Array.from({ length: 8 }, (_, i) => ({ pitch: 60 + i % 5, beat: i, duration: 1, velocity: 0.8 })) }] };
  const at = level => renderScore({ ...score, master: { ...score.master, volume: level } }, { sampleRate: 12000 }).then(r => r.report.loudness);
  const [target, quieter, louder] = [await at(0.8), await at(0.4), await at(2)];
  assert.ok(Math.abs(target - -14) < 0.5, String(target));
  assert.ok(Math.abs(target - quieter - 6) < 0.5, `${target} ${quieter}`);
  assert.ok(Math.abs(louder - target) < 0.2, `${target} ${louder}`);
});

test('personal sleeves use track position and briefs preserve creative voice choices and library context', () => {
  const sleeves = Array.from({ length: 10 }, (_, index) => coverSvg({ id: 'same', title: 'Same' }, { index }));
  assert.equal(new Set(sleeves).size, 10);
  assert.equal(composeBrief({ brief: 'Spoken poetry and warm rhythms' }), 'Spoken poetry and warm rhythms');
  const prompt = buildPrompt({ brief: 'A warm record', library: '/music/After Hours' });
  assert.ok(prompt.includes('/music/After Hours'));
  assert.ok(prompt.includes('Keep it intact'));
});
