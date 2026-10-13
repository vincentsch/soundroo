import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVarietyCollection } from '../examples/variety.js';
import { compileScore, validateScore } from '../src/score.js';
import { renderScore } from '../src/render.js';

test('the broader default contains ten different songs, early guitar riffs and varied forms', () => {
  const { tracks } = buildVarietyCollection({ seed: 21 });
  assert.equal(tracks.length, 10);
  assert.equal(new Set(tracks.map(t => t.id)).size, 10);
  assert.ok(new Set(tracks.map(t => t.bpm)).size >= 6);
  let earlyGuitars = 0;
  for (const t of tracks) {
    assert.equal(validateScore(t).valid, true, t.id);
    const expanded = compileScore(t);
    assert.ok(t.beats * 60 / t.bpm >= 100 && t.beats * 60 / t.bpm <= 165, t.id);
    if (expanded.parts.some(p => p.instrument.startsWith('guitar-') && p.notes.some(n => n.beat < 8))) earlyGuitars++;
    assert.ok(t.sections.length >= 5, t.id);
    assert.ok(t.parts.every(p => p.volume <= 1.25), 'leave room on each mixer fader');
    assert.ok(t.master.volume <= 2, 'master compensation must fit the mixer');
  }
  assert.ok(earlyGuitars >= 3);
  assert.deepEqual(buildVarietyCollection({ seed: 21 }), buildVarietyCollection({ seed: 21 }));
});

test('every new song renders an audible, finite chorus or groove excerpt', async () => {
  for (const score of buildVarietyCollection({ seed: 21 }).tracks) {
    const section = score.sections.find(s => /chorus|drop|groove/i.test(s.id + s.name)) ?? score.sections[2];
    const start = section.beat * 60 / score.bpm;
    const { report } = await renderScore(score, { sampleRate: 16000, from: start, to: start + 3 });
    assert.equal(report.nonFinite, 0, score.id); assert.equal(report.clipped, 0, score.id);
    assert.ok(report.rms > 0.008, score.id);
  }
});
