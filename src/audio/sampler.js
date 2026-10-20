// Recorded instruments. assets/samples/samples.json lists, for each
// instrument, the recorded pitches (roots), the upper velocity of each
// dynamic layer and how many alternate takes (round robins) each has. A note
// plays the nearest recorded pitch at the matching layer, resampled to its
// own pitch. Strings and brass loop a steady stretch while the note is held.
import { readFileSync } from 'node:fs';
import { parseWav, toMono } from './pcm.js';
import { Voice, Env, WAVES } from './synth.js';

const FOLDER = new URL('../../assets/samples/', import.meta.url);
let manifest;
const loaded = new Map();

function instrument(id) {
  manifest ??= JSON.parse(readFileSync(new URL('samples.json', FOLDER), 'utf8')).instruments;
  const spec = manifest[id];
  if (!spec) throw new Error(`No recorded samples for ${id}.`);
  return spec;
}

function recording(id, name) {
  const key = `${id}/${name}`;
  if (!loaded.has(key)) {
    const bytes = readFileSync(new URL(`${id}/${name}.wav`, FOLDER));
    const wav = parseWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    loaded.set(key, { data: toMono(wav.channels), rate: wav.sampleRate });
  }
  return loaded.get(key);
}

/** Adds one recorded note to a lane. A null pitch plays the first recording
 * unchanged (drums); maxShift limits how far a recording is retuned (toms).
 * Untimed notes ring out whatever the note length; timed ones fade with
 * `release` seconds after the note ends. `doubled` adds a second take detuned
 * by that many cents for a section sound. */
export function sampledNote(syn, lane, t, id, pitch, velocity, duration, rng, { level = 1, release = 0.3, attack = 0, timed = true, doubled = 0, filter = null, maxShift = Infinity } = {}) {
  const spec = instrument(id);
  const wanted = pitch ?? spec.roots[0];
  const root = spec.roots.reduce((best, candidate) => Math.abs(candidate - wanted) < Math.abs(best - wanted) ? candidate : best);
  const layer = Math.max(0, spec.layers.findIndex(top => velocity <= top));
  const take = spec.rr > 1 ? 1 + Math.floor(rng.next() * spec.rr) : 1;
  const name = `${root}-${layer + 1}-${take}`;
  const { data, rate } = recording(id, name);
  const loop = spec.loops?.[name] ?? null;
  const ratio = Math.pow(2, Math.max(-maxShift, Math.min(maxShift, wanted - root)) / 12);
  const gain = level * Math.pow(velocity / spec.layers[layer], 0.6) * (doubled ? Math.SQRT1_2 : 1);
  const length = data.length / (rate * ratio);
  const amp = () => {
    const envelope = new Env(0).set(0, t);
    if (attack > 0) envelope.lin(gain, t + attack); else envelope.set(gain, t);
    return timed ? envelope.target(0, t + Math.max(attack, duration), release / 3) : envelope;
  };
  const end = timed ? t + Math.max(attack, duration) + release * 2.4 : t + length;
  const voice = new Voice(t, loop ? end : Math.min(end, t + length));
  // The second take of a doubled note starts 15 ms into the recording so the two don't sound like one.
  const takes = doubled ? [[-doubled / 2, 0], [doubled / 2, Math.round(rate * 0.015)]] : [[0, 0]];
  for (const [detune, start] of takes) voice.layer({ wave: WAVES.sample, data, step: (rate / syn.sr) * ratio, start, loop, detune, amp: amp() });
  voice.filter = filter;
  syn.add(lane, voice);
}
