import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeMidi } from '../src/audio/midi.js';

test('MIDI exports conductor timing, channel notes and standard drum channel', () => {
  const file = encodeMidi({ title: 'Test', bpm: 120, tracks: [
    { name: 'Piano', program: 4, notes: [{ pitch: 60, beat: 0, duration: 1, velocity: 0.8 }] },
    { name: 'Kick', drums: true, notes: [{ pitch: 36, beat: 1, duration: 0.1, velocity: 0.9 }] },
  ] });
  assert.equal(file.toString('ascii', 0, 4), 'MThd');
  assert.equal(file.readUInt16BE(10), 3);
  assert.equal(file.readUInt16BE(12), 480);
  assert.ok(file.includes(Buffer.from([255, 81, 3, 7, 161, 32])));
  assert.ok(file.includes(Buffer.from([144, 60, 102])));
  assert.ok(file.includes(Buffer.from([128, 60, 0])));
  assert.ok(file.includes(Buffer.from([153, 36, 114])));
  let offset = 14;
  for (let i = 0; i < 3; i++) {
    assert.equal(file.toString('ascii', offset, offset + 4), 'MTrk');
    offset += 8 + file.readUInt32BE(offset + 4);
  }
  assert.equal(offset, file.length);
});

test('MIDI rejects malformed notes instead of writing corrupted interchange files', () => {
  assert.throws(() => encodeMidi({ tracks: [{ notes: [{ pitch: 200, beat: 0, duration: 1 }] }] }), /valid pitch/);
  assert.throws(() => encodeMidi({ bpm: 0 }), /tempo/);
});
