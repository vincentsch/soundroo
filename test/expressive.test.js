import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTimeline } from '../src/timeline.js';
import { validateScore, compileScore } from '../src/score.js';
import { renderScore } from '../src/render.js';
import { musicFingerprint } from '../src/identity.js';
import { midi } from '../src/headless.js';
import { midiToScore, parseMidi } from '../src/audio/midi-import.js';
import { convolveHall, fft } from '../src/audio/convolution.js';

const piano = (notes, extra = {}) => ({ version: 3, id: 'expressive', title: 'Expressive', bpm: 60, beats: 12, master: { volume: 0.8, reverb: 0 }, parts: [{ id: 'piano', instrument: 'piano', notes, ...extra }] });
const energy = (channel, from, to) => { let sum = 0; for (let i = from; i < to; i++) sum += channel[i] * channel[i]; return sum / Math.max(1, to - from); };

test('tempo changes and ramps convert beats to seconds both ways', () => {
  const steady = makeTimeline({ bpm: 120, beats: 8 });
  assert.equal(steady.duration, 4);
  assert.equal(steady.constant, true);
  const timeline = makeTimeline({ bpm: 120, beats: 16, tempo: [{ beat: 4, bpm: 60 }, { beat: 12, bpm: 120, ramp: true }] });
  assert.equal(timeline.seconds(4), 2);
  // The ramp glides from the change before it (beat 4) and reaches 120 BPM at beat 12.
  assert.ok(Math.abs(timeline.seconds(6) - (2 + 8 * Math.log(1.25))) < 1e-9);
  // 60 → 120 BPM over 8 beats: 60 / slope · ln(120 / 60) seconds.
  assert.ok(Math.abs(timeline.seconds(12) - (2 + 8 * Math.log(2))) < 1e-9);
  assert.equal(timeline.tempoAt(8), 90);
  for (const beat of [0, 3, 5.5, 9.25, 14]) assert.ok(Math.abs(timeline.beatAt(timeline.seconds(beat)) - beat) < 1e-9, beat);
});

test('version 3 checks tempo changes and pedal spans and keeps them through clips', () => {
  const ok = piano([{ pitch: 60, beat: 0, duration: 1 }], { pedal: [{ beat: 0, beats: 2 }, { beat: 1, beats: 2 }, { beat: 3, beats: 1 }], patterns: { arp: { beats: 2, notes: [{ pitch: 64, beat: 0, duration: 1 }], pedal: [{ beat: 0, beats: 1.5 }] } }, clips: [{ pattern: 'arp', beat: 6, repeat: 2 }] });
  ok.tempo = [{ beat: 4, bpm: 90, ramp: true }];
  const compiled = compileScore(ok);
  assert.equal(compiled.version, 3);
  // Overlapping spans join; touching spans stay apart (a pedal change).
  assert.deepEqual(compiled.parts[0].pedal, [{ beat: 0, beats: 3 }, { beat: 3, beats: 1 }, { beat: 6, beats: 1.5 }, { beat: 8, beats: 1.5 }]);
  assert.deepEqual(compileScore(compiled).tempo, compiled.tempo);
  const paths = score => validateScore(score).issues.map(i => i.path);
  assert.deepEqual(paths({ ...ok, version: 2 }), ['tempo', 'parts[0].pedal', 'parts[0].patterns.arp.pedal']);
  assert.deepEqual(paths({ ...ok, tempo: [{ beat: 4, bpm: 90 }, { beat: 4, bpm: 100 }, { beat: 0, bpm: 80 }, { beat: 5, bpm: 500, slide: true }] }), ['tempo[1].beat', 'tempo[2].beat', 'tempo[2].beat', 'tempo[3].slide', 'tempo[3].bpm']);
  assert.deepEqual(paths(piano([{ pitch: 60, beat: 0, duration: 1 }], { pedal: [{ beat: 11, beats: 2 }] })), ['parts[0].pedal[0]']);
  // Ten minutes is the limit in time, so a slower tempo change can push a score over it.
  assert.deepEqual(paths({ ...piano([{ pitch: 60, beat: 0, duration: 1 }]), bpm: 120, beats: 1100, tempo: [{ beat: 100, bpm: 60 }] }), ['beats']);
  // Empty lists are allowed in any version, as compiled scores carry them.
  assert.equal(validateScore({ ...piano([{ pitch: 60, beat: 0, duration: 1 }]), version: 1, tempo: [], parts: [{ id: 'p', instrument: 'piano', notes: [{ pitch: 60, beat: 0, duration: 1 }], pedal: [] }] }).valid, true);
});

test('fingerprints keep their value without tempo and pedal and change with them', () => {
  const plain = piano([{ pitch: 60, beat: 0, duration: 1 }]);
  const v1 = { ...plain, version: 1 };
  assert.equal(musicFingerprint(plain), musicFingerprint(v1));
  assert.notEqual(musicFingerprint({ ...plain, tempo: [{ beat: 2, bpm: 90 }] }), musicFingerprint(plain));
  assert.notEqual(musicFingerprint(piano([{ pitch: 60, beat: 0, duration: 1 }], { pedal: [{ beat: 0, beats: 4 }] })), musicFingerprint(plain));
});

test('the sustain pedal keeps released notes ringing and the dampers fall when it comes up', async () => {
  const notes = [{ pitch: 60, beat: 0, duration: 0.5, velocity: 0.7 }];
  const dry = await renderScore(piano(notes), { sampleRate: 22050 });
  const held = await renderScore(piano(notes, { pedal: [{ beat: 0, beats: 4 }] }), { sampleRate: 22050 });
  const window = [Math.round(2 * 22050), Math.round(3.5 * 22050)];
  assert.ok(energy(held.audio.getChannelData(0), ...window) > 30 * energy(dry.audio.getChannelData(0), ...window), 'pedal sustains');
  const late = [Math.round(6 * 22050), Math.round(7 * 22050)];
  assert.ok(energy(held.audio.getChannelData(0), ...late) < energy(held.audio.getChannelData(0), ...window) / 100, 'dampers fall after the pedal');
  // The highest notes have no dampers: released early, they ring as long as when held.
  const after = [Math.round(1.5 * 22050), Math.round(2.5 * 22050)];
  const ring = async (pitch, duration) => energy((await renderScore(piano([{ pitch, beat: 0, duration, velocity: 0.7 }]), { sampleRate: 22050 })).audio.getChannelData(0), ...after);
  assert.ok(await ring(96, 0.25) > 0.8 * await ring(96, 3), 'undamped treble');
  assert.ok(await ring(72, 0.25) < 0.01 * await ring(72, 3), 'damped middle');
  assert.ok(Math.abs(held.audio.getChannelData(0)[0]) < 1e-3);
  assert.equal(held.report.nonFinite, 0);
});

test('recorded notes are stereo, pitched without loss, and repeated notes vary takes', async () => {
  const result = await renderScore(piano([{ pitch: 60, beat: 0, duration: 2, velocity: 0.8 }]), { sampleRate: 48000 });
  const [left, right] = [result.audio.getChannelData(0), result.audio.getChannelData(1)];
  let same = 0;
  for (let i = 0; i < 48000; i++) if (Math.abs(left[i] - right[i]) < 1e-6) same++;
  assert.ok(same < 4800, 'the piano keeps its two microphones apart');
  // Drums choose among recorded takes: two identical hits differ.
  const kit = { version: 1, id: 'kit', title: 'Kit', bpm: 120, beats: 4, master: { volume: 0.8, reverb: 0 }, parts: [{ id: 'snare', instrument: 'rock-snare', notes: [{ pitch: 38, beat: 0, duration: 0.5, velocity: 0.8 }, { pitch: 38, beat: 2, duration: 0.5, velocity: 0.8 }] }] };
  const hits = await renderScore(kit, { sampleRate: 44100 });
  const channel = hits.audio.getChannelData(0), a = channel.subarray(0, 4410), b = channel.subarray(44100, 44100 + 4410);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
  assert.ok(diff > 1, 'two hits use different takes');
});

test('a cymbal sounds at most five voices: a new hit fades the oldest', async () => {
  const ride = n => ({ version: 1, id: 'ride', title: 'Ride', bpm: 240, beats: 24, master: { volume: 0.8, reverb: 0 }, parts: [{ id: 'ride', instrument: 'ride', notes: Array.from({ length: n }, (_, i) => ({ pitch: 51, beat: i, duration: 0.5, velocity: 0.6 })) }] });
  const { Synth } = await import('../src/audio/synth.js');
  const add = Synth.prototype.add;
  let voices = [];
  Synth.prototype.add = function (lane, voice) { voices.push(voice); return add.call(this, lane, voice); };
  try { await renderScore(ride(12), { sampleRate: 22050 }); } finally { Synth.prototype.add = add; }
  const at = 11.5 * 0.25;
  assert.ok(voices.filter(v => v.t0 <= at && v.t1 > at).length <= 5);
});

test('the hall convolution matches direct convolution', async () => {
  const sampleRate = 8000, n = 30000;
  const send = new Float32Array(n);
  for (let i = 0; i < n; i += 997) send[i] = (i % 3) - 1;
  const fast = [new Float32Array(n), new Float32Array(n)];
  convolveHall(send, fast, sampleRate, 1);
  const fs = await import('node:fs');
  const { parseWav, resample } = await import('../src/audio/pcm.js');
  const bytes = fs.readFileSync(new URL('../assets/reverb/hall.wav', import.meta.url));
  const wav = parseWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const ir = resample(wav.channels[0], wav.sampleRate, sampleRate);
  for (const frame of [5000, 12345, 29999]) {
    let direct = 0;
    for (let k = 0; k < ir.length && k <= frame; k++) direct += send[frame - k] * ir[k];
    assert.ok(Math.abs(direct - fast[0][frame]) < 1e-4, `${frame}: ${direct} vs ${fast[0][frame]}`);
  }
  const re = Float64Array.from([1, 2, 3, 4]), im = new Float64Array(4);
  fft(re, im); fft(re, im, true);
  assert.deepEqual([...re].map(v => Math.round(v / 4)), [1, 2, 3, 4]);
});

test('MIDI carries tempo changes and the pedal, and imports back as a version 3 score', () => {
  const score = piano([{ pitch: 60, beat: 0, duration: 1, velocity: 0.5 }, { pitch: 64, beat: 2, duration: 1, velocity: 1 }], { pedal: [{ beat: 0, beats: 2 }, { beat: 2, beats: 2 }] });
  score.tempo = [{ beat: 4, bpm: 90 }, { beat: 8, bpm: 60, ramp: true }];
  const bytes = midi(score);
  const parsed = parseMidi(bytes);
  const tempos = parsed.tracks[0].filter(e => e.type === 'tempo');
  assert.equal(tempos[0].bpm, 60);
  assert.ok(tempos.length > 3, 'a ramp becomes several tempo changes');
  const pedal = parsed.tracks[1].filter(e => e.type === 'control' && e.control === 64);
  assert.deepEqual(pedal.map(e => [e.tick, e.value]), [[0, 127], [960, 0], [960, 127], [1920, 0]]);
  const { score: back } = midiToScore(bytes, { title: 'Back' });
  assert.equal(validateScore(back).valid, true);
  assert.equal(back.version, 3);
  assert.deepEqual(back.parts[0].pedal, [{ beat: 0, beats: 2 }, { beat: 2, beats: 2 }]);
  assert.deepEqual(back.parts[0].notes.map(n => [n.pitch, n.beat, n.duration]), [[60, 0, 1], [64, 2, 1]]);
  assert.equal(back.parts[0].instrument, 'piano');
  assert.equal(back.tempo[0].beat, 4);
  assert.throws(() => midiToScore(Buffer.from('not midi')), /standard MIDI/);
});

test('MIDI drums split into the kit and General MIDI programs pick instruments', () => {
  // Format 0: program 33 (fingered bass) on channel 1, a kick and a hat on channel 10.
  const events = [
    0x00, 0xc0, 33,
    0x00, 0x90, 40, 100, 0x00, 0x99, 36, 110, 0x00, 0x99, 42, 80, 0x00, 0x99, 99, 80,
    0x83, 0x60, 0x80, 40, 0, 0x00, 0x89, 36, 0, 0x00, 0x89, 42, 0, 0x00, 0x89, 99, 0,
    0x00, 0xff, 0x2f, 0x00,
  ];
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0];
  const track = [0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, events.length, ...events];
  const { score, skipped } = midiToScore(Uint8Array.from([...header, ...track]));
  assert.deepEqual(score.parts.map(p => p.instrument).sort(), ['closed-hat', 'electric-bass', 'rock-kick']);
  assert.equal(skipped, 1);
  assert.equal(validateScore(score).valid, true);
});

test('a recording played faster than the output rate is filtered, not folded back', async () => {
  const { Synth, Voice, Env, WAVES } = await import('../src/audio/synth.js');
  const { SampleStream } = await import('../src/audio/library.js');
  const frames = 48000, tone = Float32Array.from({ length: frames }, (_, i) => Math.sin(2 * Math.PI * 6000 * i / 48000));
  const recording = { frames, channels: 1, rate: 48000, key: 'test/tone', read: (start, count, out, at) => { out[0].set(tone.subarray(start, start + count), at); return out; } };
  const output = (rate, wanted) => {
    const synth = new Synth(rate, rate);
    const lane = synth.lane({ stereo: true });
    const voice = new Voice(0, 0.9);
    voice.stereo = true;
    voice.layer({ wave: WAVES.stream, source: new SampleStream(recording), step: 48000 / rate, start: 0, amp: new Env(0).set(1, 0) });
    synth.add(lane, voice);
    const left = new Float32Array(rate), right = new Float32Array(rate);
    for (let i = 0; i < rate; i += 256) synth.renderBlock(i, Math.min(256, rate - i), left.subarray(i), right.subarray(i));
    // Amplitude of `wanted` Hz between 0.1 and 0.8 s.
    let re = 0, im = 0;
    for (let i = Math.round(0.1 * rate); i < Math.round(0.8 * rate); i++) { re += left[i] * Math.cos(2 * Math.PI * wanted * i / rate); im += left[i] * Math.sin(2 * Math.PI * wanted * i / rate); }
    return 2 * Math.hypot(re, im) / Math.round(0.7 * rate);
  };
  // At 8 kHz a 6 kHz tone is above Nyquist: it must vanish instead of returning at 2 kHz.
  assert.ok(output(8000, 2000) < 0.01, 'no alias');
  // At 44.1 kHz the same tone plays at full level.
  assert.ok(output(44100, 6000) > 0.9, 'passes in band');
});

test('synthesized notes follow the sustain pedal too', async () => {
  const notes = [{ pitch: 60, beat: 0, duration: 0.5, velocity: 0.7 }];
  const window = [2 * 22050, 3 * 22050];
  const dry = await renderScore(piano(notes), { sampleRate: 22050, sound: 'synthesized' });
  const held = await renderScore(piano(notes, { pedal: [{ beat: 0, beats: 4 }] }), { sampleRate: 22050, sound: 'synthesized' });
  assert.ok(energy(held.audio.getChannelData(0), ...window) > 1000 * energy(dry.audio.getChannelData(0), ...window));
});

test('fingerprints of unchanged scores stay the same across the 0.8.0 brightness defaults', () => {
  // These fingerprints come from engine 0.7.0 for the same scores.
  const line = instrument => ({ version: 2, id: 'x', title: 'X', bpm: 100, beats: 8, parts: [{ id: 'p', instrument, tone: {}, patterns: { a: { beats: 2, line: 'C4/1 E4/1' } }, clips: [{ pattern: 'a', beat: 0, repeat: 4 }] }] });
  const explicit = instrument => { const s = line(instrument); s.parts[0].tone = { brightness: { piano: 12000, strings: 9000, brass: 9000, 'guitar-clean': 9000, 'electric-bass': 5000 }[instrument] }; return s; };
  for (const instrument of ['piano', 'strings', 'brass', 'guitar-clean', 'electric-bass']) assert.equal(musicFingerprint(line(instrument)), musicFingerprint(explicit(instrument)), instrument);
});

test('MIDI import shares a channel\'s pedal between tracks and starts at 120 BPM', () => {
  const vlq = n => { const b = [n & 127]; while ((n >>= 7)) b.unshift((n & 127) | 128); return b; };
  const track = events => { const body = []; for (const [delta, bytes] of events) body.push(...vlq(delta), ...bytes); body.push(0, 0xff, 0x2f, 0); return [0x4d, 0x54, 0x72, 0x6b, 0, 0, (body.length >> 8) & 255, body.length & 255, ...body]; };
  const t = 60000000 / 90;
  const conductor = track([[1920, [0xff, 0x51, 3, (t >> 16) & 255, (t >> 8) & 255, t & 255]]]);
  const right = track([[0, [0xb0, 64, 127]], [0, [0x90, 72, 90]], [480, [0x80, 72, 0]], [1440, [0xb0, 64, 0]]]);
  const left = track([[0, [0x90, 48, 80]], [480, [0x80, 48, 0]]]);
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 3, 0x01, 0xe0];
  const { score } = midiToScore(Uint8Array.from([...header, ...conductor, ...right, ...left]));
  assert.equal(score.bpm, 120);
  assert.deepEqual(score.tempo, [{ beat: 4, bpm: 90 }]);
  assert.deepEqual(score.parts.map(p => p.pedal), [[{ beat: 0, beats: 4 }], [{ beat: 0, beats: 4 }]]);
});

test('recordings are read when their voice starts and let go when it ends', async () => {
  const { SampleStream } = await import('../src/audio/library.js');
  let reads = 0;
  const recording = (frames, loop) => ({ frames, channels: 2, rate: 44100, key: `test/lazy-${frames}`, loop, read: (start, count, out) => { reads++; return out; } });
  const looped = new SampleStream(recording(400000, [100000, 200000]));
  const long = new SampleStream(recording(400000));
  assert.equal(reads, 0, 'scheduling a note reads nothing');
  looped.ensure(0, 256);
  // A looped note never plays past its loop, so only that much is read.
  assert.equal(looped.data[0].length, 200000 + 64 + 2 * 64);
  long.ensure(0, 256);
  assert.equal(reads, 2);
  looped.release(); long.release();
  assert.equal(looped.data, null);
  assert.equal(long.data, null);
});
