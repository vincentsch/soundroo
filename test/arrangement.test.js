import test from 'node:test';
import assert from 'node:assert/strict';
import { arrangementSuggestions } from '../src/arrangement.js';
import { compileScore } from '../src/score.js';

const notes = (count, pitch, every = 1, from = 0) => Array.from({ length: count }, (_, i) => ({ pitch, beat: from + i * every, duration: 0.5, velocity: 0.8 }));
const codes = score => arrangementSuggestions(compileScore({ version: 1, id: 'arr', title: 'Arrangement', bpm: 120, ...score })).map(s => s.code);

test('late drums, endless loops, flat sections and long silent endings are suggested once each', () => {
  assert.deepEqual(codes({ beats: 64, parts: [{ id: 'pad', instrument: 'pad', notes: notes(8, 60, 4) }, { id: 'kick', instrument: 'kick', notes: notes(6, 36, 4, 40) }] }), ['late_start']);
  assert.deepEqual(codes({ beats: 128, parts: [{ id: 'kick', instrument: 'kick', notes: notes(128, 36) }] }), ['loop_fatigue']);
  const sections = [{ id: 'a', name: 'A', beat: 0, beats: 16 }, { id: 'b', name: 'B', beat: 16, beats: 16 }, { id: 'c', name: 'C', beat: 32, beats: 16 }];
  assert.deepEqual(codes({ beats: 48, sections, parts: [{ id: 'kick', instrument: 'kick', notes: notes(48, 36).map((n, i) => ({ ...n, velocity: 0.5 + (i % 7) / 20 })) }] }), ['flat_energy']);
  assert.deepEqual(codes({ beats: 64, parts: [{ id: 'kick', instrument: 'kick', notes: notes(32, 36).map((n, i) => ({ ...n, velocity: 0.5 + (i % 9) / 20 })) }] }), ['silent_end']);
});

test('a varied arrangement that starts with drums and builds gets no suggestions', () => {
  const sections = [{ id: 'intro', name: 'Intro', beat: 0, beats: 16 }, { id: 'verse', name: 'Verse', beat: 16, beats: 16 }, { id: 'chorus', name: 'Chorus', beat: 32, beats: 16 }];
  const kick = notes(48, 36).map((n, i) => ({ ...n, velocity: 0.6 + (i % 5) / 20 }));
  assert.deepEqual(codes({ beats: 48, sections, parts: [{ id: 'kick', instrument: 'kick', notes: kick }, { id: 'lead', instrument: 'pluck', notes: notes(16, 64, 1, 32).map((n, i) => ({ ...n, pitch: 64 + (i % 5) })) }] }), []);
});
