// Recorded instruments, played from the full recordings in sample packs
// (library.js, assets/samples/SOURCES.md): the grand piano with its own
// player, and every other recorded instrument mapped as SFZ-like regions.
import { Voice, Env, WAVES } from './synth.js';
import { SampleStream } from './library.js';

const dbGain = db => Math.pow(10, db / 20);
const midiVelocity = velocity => Math.max(1, Math.min(127, Math.round(velocity * 127)));
// SFZ amp_veltrack: velocity scales the level along a square curve, by this share.
const velocityGain = (track, vel) => 1 - track + track * (vel / 127) ** 2;
// The time constant of an exponential fade that is 60 dB down after `seconds`.
const fadeTau = seconds => Math.max(0.002, seconds / 6.9);

function regionFor(regions, key, vel) {
  const matches = regions.filter(r => vel >= r.lovel && vel <= r.hivel);
  return matches.find(r => key >= r.lokey && key <= r.hikey)
    ?? matches.reduce((best, r) => (best && Math.abs(best.key - key) <= Math.abs(r.key - key) ? best : r), null);
}

// A voice stops once the rest of its recording, at the voice's gain, stays
// below this level: far under the noise floor of any render.
const SILENT_DB = -100;

// The frames of a recording that can still be heard at `gain`.
function audibleFrames(recording, gain) {
  const below = 20 * Math.log10(Math.max(gain, 1e-12)) + recording.peak - SILENT_DB;
  if (!recording.tails || below > 120) return recording.frames;
  return recording.tails[Math.max(0, Math.ceil(below / 10) - 2)];
}

/** One recording as a stereo voice from time t until `end` (seconds), at
 * `ratio` times its own speed, shaped by `amp`, whose loudest value is
 * `gain`. Returns the voice. */
function playRecording(syn, lane, recording, t, ratio, amp, end, gain, { filter = null, loop = null } = {}) {
  const voice = new Voice(t, Math.min(end, loop ? Infinity : t + audibleFrames(recording, gain) / (ratio * syn.sr)));
  voice.stereo = true;
  voice.layer({ wave: WAVES.stream, source: new SampleStream({ ...recording, loop }), step: ratio, start: 0, loop, amp });
  voice.filter = filter;
  syn.add(lane, voice);
  return voice;
}

// Fades a sounding voice to silence over `seconds` from time t.
function fadeOut(syn, voice, envelope, t, seconds) {
  envelope.events = envelope.events.filter(event => event[1] < t);
  envelope.target(0, t, fadeTau(seconds));
  voice.t1 = Math.min(voice.t1, t + seconds);
  voice.end = Math.min(voice.end, Math.round(voice.t1 * syn.sr));
}

/** The grand piano (Salamander Grand Piano V3, mapped as its SFZ program):
 * sixteen recorded loudness layers per note, dampers that fall when both the
 * key and the sustain pedal are up, no dampers on the highest notes, the
 * hammer and string sounds of a released key, and pedal noises. Notes must
 * arrive in time order; finish() adds the sounds still waiting. */
export class PianoPlayer {
  constructor(syn, lane, library, { level = 1, rng }) {
    this.syn = syn;
    this.lane = lane;
    this.library = library;
    this.spec = library.instrument('piano');
    this.level = level;
    this.rng = rng;
    this.sounding = new Map();
  }

  recording(name) {
    return this.library.recording(this.spec.pack, name);
  }

  /** A key struck at t (seconds) with velocity 0–1; its damper falls at damperAt. */
  note(t, key, velocity, damperAt) {
    const { syn, spec } = this;
    const vel = midiVelocity(velocity);
    const region = regionFor(spec.regions, key, vel);
    const recording = this.recording(region.sample);
    const ratio = Math.pow(2, (key - region.key) / 12 + region.tune / 1200) * recording.rate / syn.sr;
    const gain = this.level * velocityGain(spec.veltrack, vel);
    const previous = this.sounding.get(key);
    if (previous && previous.voice.t1 > t) {
      // Striking the key again takes over the string: the earlier sound fades, and its damper never fell.
      fadeOut(syn, previous.voice, previous.envelope, t, spec.restrike);
      previous.releases = [];
    } else if (previous) this.releaseSounds(previous);
    // The strings from F#6 up have no dampers (the SFZ gives them a long release): they ring out naturally.
    const undamped = region.release >= 3;
    const envelope = new Env(0).set(gain, t);
    if (!undamped) envelope.target(0, damperAt, fadeTau(region.release));
    const voice = playRecording(syn, this.lane, recording, t, ratio, envelope, undamped ? Infinity : damperAt + region.release, gain);
    const held = Math.max(0, damperAt - t);
    const releases = spec.releaseRegions.filter(r => key >= r.lokey && key <= r.hikey && vel >= r.lovel && vel <= r.hivel)
      .map(r => ({ region: r, at: damperAt, gain: this.level * dbGain(r.gain - r.rtDecay * held) * velocityGain(r.veltrack, vel) }));
    this.sounding.set(key, { voice, envelope, releases, key });
  }

  // The hammer and string sounds of a key whose damper has fallen.
  releaseSounds(entry) {
    for (const { region, at, gain } of entry.releases) {
      if (gain < 1e-5) continue;
      const recording = this.recording(region.sample);
      const ratio = Math.pow(2, (entry.key - region.key) / 12) * recording.rate / this.syn.sr;
      playRecording(this.syn, this.lane, recording, at, ratio, new Env(0).set(gain, at), Infinity, gain);
    }
    entry.releases = [];
  }

  /** The pedal going down (or up) at t. */
  pedal(t, down) {
    const names = down ? this.spec.pedal.down : this.spec.pedal.up;
    const name = names[Math.floor(this.rng.next() * names.length) % names.length];
    const gain = this.level * dbGain(down ? this.spec.pedal.downGain : this.spec.pedal.upGain);
    const recording = this.recording(name);
    playRecording(this.syn, this.lane, recording, t, recording.rate / this.syn.sr, new Env(0).set(gain, t), Infinity, gain);
  }

  finish() {
    for (const entry of this.sounding.values()) this.releaseSounds(entry);
  }
}

/** Instruments mapped as SFZ-like regions (assets/samples/samples.json,
 * model "regions"): drums, bass, guitars, strings and brass. A note plays the
 * region for its key and velocity, choosing among alternative takes at
 * random without repeating the last one; release regions sound when it ends.
 * Notes must arrive in time order. */
export class RegionPlayer {
  constructor(syn, lane, library, instrument, { level = 1, rng }) {
    this.syn = syn;
    this.lane = lane;
    this.library = library;
    this.spec = library.instrument(instrument);
    this.level = level;
    this.rng = rng;
    this.last = new Map();
    // Sounding voices per key (all keys share one list for unpitched drums): [{voice, envelope}].
    this.voices = new Map();
  }

  // At most spec.polyphony voices sound per key: a new note fades the oldest over 50 ms.
  limit(key, t) {
    const max = this.spec.polyphony;
    if (!max) return;
    const list = (this.voices.get(key) ?? []).filter(entry => entry.voice.t1 > t);
    while (list.length >= max) {
      const oldest = list.shift();
      fadeOut(this.syn, oldest.voice, oldest.envelope, t, 0.05);
    }
    this.voices.set(key, list);
  }

  pick(regions, key, vel, avoid) {
    const usable = regions.filter(r => vel >= r.lovel && vel <= r.hivel);
    let matches = usable.filter(r => key >= r.lokey && key <= r.hikey);
    if (!matches.length && usable.length) {
      const nearest = usable.reduce((best, r) => Math.abs(r.key - key) < Math.abs(best.key - key) ? r : best);
      matches = usable.filter(r => r.key === nearest.key);
    }
    const fresh = matches.length > 1 ? matches.filter(r => r.sample !== avoid) : matches;
    return fresh[Math.floor(this.rng.next() * fresh.length) % fresh.length] ?? null;
  }

  gainFor(region, vel) {
    // SFZ amp_velcurve_<top>=1: the level rises in a straight line to full at the layer's top velocity.
    const top = region.velTop ?? (this.spec.layerVelocity === 'linear' ? region.hivel : null);
    const curve = top ? Math.min(1, vel / top) : velocityGain(this.spec.veltrack ?? 1, vel);
    return this.level * dbGain(region.gain ?? 0) * curve;
  }

  /** A note from t to offAt (seconds). Options: attack, release (seconds after
   * offAt), decay (a held note fades toward silence with this time constant),
   * doubled (cents between two takes for a section sound), filter, tiltDb. */
  note(t, key, velocity, offAt, { attack = 0, release = this.spec.release ?? 0.3, decay = 0, doubled = 0, filter = null, tiltDb = 0 } = {}) {
    const { syn, spec } = this;
    const vel = midiVelocity(velocity);
    const region = this.pick(spec.regions, key, vel, this.last.get(key));
    if (!region) return;
    this.last.set(key, region.sample);
    const voiceKey = spec.unpitched ? 0 : key;
    this.limit(voiceKey, t);
    const gain = this.gainFor(region, vel) * dbGain(tiltDb) * (doubled ? Math.SQRT1_2 : 1);
    const takes = [[region, 0, 0]];
    if (doubled) {
      // A section: a second take, a few cents apart, starting a little later so the two don't sound like one.
      const other = this.pick(spec.regions, key, vel, region.sample) ?? region;
      takes[0][1] = -doubled / 2;
      takes.push([other, doubled / 2, other === region ? 0.015 : 0.008]);
    }
    for (const [take, cents, delay] of takes) {
      const recording = this.library.recording(spec.pack, take.sample);
      // Each take is retuned from its own recorded pitch (alternative takes share the region's key).
      const takeShift = spec.unpitched ? 0 : Math.max(-(spec.maxShift ?? 127), Math.min(spec.maxShift ?? 127, key - take.key));
      const ratio = Math.pow(2, takeShift / 12 + (take.tune ?? 0) / 1200 + cents / 1200) * recording.rate / syn.sr;
      const start = t + delay;
      const envelope = new Env(0).set(0, start);
      if (attack > 0) envelope.lin(gain, start + attack); else envelope.set(gain, start);
      if (decay > 0) envelope.target(gain * 0.025, start + attack, decay);
      let end = Infinity;
      if (!spec.oneShot) {
        // The release control keeps its meaning from earlier engines: a fade with a third of it as time constant.
        const stop = Math.max(start + attack, offAt), time = Math.max(0.005, release);
        envelope.target(0, stop, time / 3);
        end = stop + time * 2.4;
      }
      const loop = take.loop ?? null;
      const voice = playRecording(syn, this.lane, recording, start, ratio, envelope, end, gain, { filter: filter ? { ...filter } : null, loop });
      if (spec.polyphony) this.voices.get(voiceKey).push({ voice, envelope });
    }
    if (!spec.oneShot && spec.releaseRegions?.length) {
      const rel = this.pick(spec.releaseRegions, key, vel, null);
      if (rel) {
        const held = Math.max(0, offAt - t), level = this.gainFor(rel, vel) * dbGain(-(rel.rtDecay ?? 0) * held) * dbGain(tiltDb);
        const recording = this.library.recording(spec.pack, rel.sample);
        const ratio = Math.pow(2, (key - rel.key) / 12) * recording.rate / syn.sr;
        if (level > 1e-5) playRecording(syn, this.lane, recording, offAt, ratio, new Env(0).set(level, offAt), Infinity, level);
      }
    }
  }
}
