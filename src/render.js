import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { compileScore } from './score.js';
import { getCatalog } from './catalog.js';
import { Synth, Voice, Env, WAVES, Reverb, Compressor, BLOCK } from './audio/synth.js';
import * as instruments from './audio/instruments.js';
import { sampledNote } from './audio/sampler.js';
import { mtof } from './audio/dsp.js';
import { makeRng, hashSeed } from './audio/rng.js';
import { parseWav, toMono, resample } from './audio/pcm.js';
import { tapePitch, granularVoice, vocodeVoice, chopVoice, CHOP_PATTERN } from './audio/voice-effects.js';
import { analyzeAudio, technicalWarnings } from './audio/analysis.js';
import { masterInPlace } from './audio/master.js';
import { arrangementSuggestions } from './arrangement.js';
import { speechAudio } from './speech.js';

export const RENDER_LIMITS = Object.freeze({ minSampleRate: 8000, maxSampleRate: 96000, maxSampleSeconds: 60, maxSampleBytes: 32 * 1024 * 1024 });
const presets = new Map(getCatalog().instruments.map(p => [p.id, p]));
// Every render is matched to the same loudness; a master volume below the default turns it down from there.
const DEFAULT_MASTER_VOLUME = 0.8;
const audioBuffer = (channels, sampleRate) => ({ length: channels[0].length, sampleRate, numberOfChannels: channels.length, getChannelData(index) { if (!Number.isInteger(index) || !channels[index]) throw new RangeError('Invalid audio channel.'); return channels[index]; } });
function bounded(value, min, max, label) {
  if (!Number.isFinite(value) || value < min || value > max) throw new TypeError(`${label} must be a finite number from ${min} to ${max}.`);
  return value;
}
function mixControls(score, mix) {
  if (!mix || typeof mix !== 'object' || Array.isArray(mix)) throw new TypeError('Mix must be an object.');
  if (mix.parts !== undefined && (!mix.parts || typeof mix.parts !== 'object' || Array.isArray(mix.parts))) throw new TypeError('mix.parts must be a part controls object.');
  if (mix.master !== undefined && (!mix.master || typeof mix.master !== 'object' || Array.isArray(mix.master))) throw new TypeError('mix.master must be an object.');
  for (const id of Object.keys(mix.parts ?? {})) if (!score.parts.some(p => p.id === id)) throw new TypeError(`Unknown mix part: ${id}.`);
  const parts = score.parts.map(part => {
    const m = mix.parts?.[part.id] ?? {};
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw new TypeError(`Mix controls for ${part.id} must be an object.`);
    for (const key of ['mute', 'solo']) if (m[key] !== undefined && typeof m[key] !== 'boolean') throw new TypeError(`${part.id}.${key} must be boolean.`);
    return { ...part, volume: bounded(m.volume ?? part.volume, 0, 2, `${part.id}.volume`), pan: bounded(m.pan ?? part.pan, -1, 1, `${part.id}.pan`), mute: m.mute ?? false, solo: m.solo ?? false };
  });
  const solo = parts.some(p => p.solo);
  return { parts: parts.map(p => ({ ...p, audible: !p.mute && (!solo || p.solo) && p.volume > 0 })), volume: bounded(mix.master?.volume ?? score.master.volume, 0, 2, 'master.volume') };
}

function sustained(synth, lane, t, pitch, velocity, duration, id, tone, rng) {
  const f = mtof(pitch), attack = tone.attack ?? 0.02, release = tone.release ?? 0.4;
  const v = new Voice(t, t + Math.max(attack, duration) + release * 7);
  const envelope = level => new Env(0).set(0, t).lin(level * velocity, t + attack).target(0, t + Math.max(attack, duration), release);
  if (id === 'fm-lead') v.layer({ wave: WAVES.sine, freq: f, amp: envelope(0.14), fm: { ratio: 2, depth: new Env(f * 2).set(f * 2, t).target(f * 0.18, t, 0.16) } });
  else if (id === 'organ') {
    for (const [ratio, level] of [[1, 0.09], [2, 0.045], [3, 0.025], [4, 0.014]]) if (f * ratio < synth.sr * 0.45) v.layer({ wave: WAVES.sine, freq: f * ratio, amp: envelope(level) });
  } else if (id === 'noise') v.layer({ wave: WAVES.pink, seed: Math.floor(rng.next() * 0xffffffff), amp: envelope(0.055), freq: 0 });
  else if (id === 'chip-lead') v.layer({ wave: WAVES.square, duty: tone.duty, freq: f, amp: envelope(0.085) });
  else if (id === 'chip-bass') v.layer({ wave: WAVES.tri, freq: f, amp: envelope(0.2) });
  else for (const detune of [-(tone.detune ?? 8), tone.detune ?? 8]) v.layer({ wave: WAVES.saw, freq: f, detune, amp: envelope(0.045) });
  synth.add(lane, v);
}

// Instruments played from recordings in assets/samples, with their level next
// to the synthesized ones. Drums ring out; the others follow the note length.
const RECORDED = {
  piano: { level: 0.35 }, strings: { level: 0.12 }, brass: { level: 0.27 },
  'electric-bass': { level: 0.76 }, 'guitar-clean': { level: 0.3 }, 'guitar-crunch': { level: 0.83 },
  'rock-kick': { level: 1.23, drum: true }, 'rock-snare': { level: 0.7, drum: true }, 'closed-hat': { level: 0.084, drum: true }, 'open-hat': { level: 0.14, drum: true },
  tom: { level: 0.57, drum: true }, crash: { level: 0.59, drum: true }, ride: { level: 0.42, drum: true },
};

function recordedNote(synth, lane, part, t, pitch, velocity, duration, tone, rng) {
  const { level, drum } = RECORDED[part.instrument];
  if (drum) return sampledNote(synth, lane, t, part.instrument, part.instrument === 'tom' ? pitch : null, velocity, duration, rng, { level, timed: false, maxShift: 3 });
  // Palm muting shortens the note and darkens it, as a hand on the strings does.
  const mute = tone.palmMute ?? 0;
  const filter = mute > 0.05 ? { type: 'lowpass', freq: 700 + 9000 * (1 - mute) ** 2, q: 0.707 } : null;
  if (part.instrument === 'guitar-crunch') {
    // Overdrive keeps a fading string loud, so a distorted note fades while it is held (release sets how fast;
    // palm muting shortens it) and is damped right after it ends; otherwise the tails of fast riffs pile up
    // into a noisy wash. High notes are turned down, as mixes written for the earlier plucked-string guitar
    // expect: the recordings are even across the neck.
    const decay = Math.max(0.06, tone.release * (1 - mute * 0.88)), tilt = Math.pow(10, -0.35 * (pitch - 57) / 20);
    return sampledNote(synth, lane, t, part.instrument, pitch, velocity, duration, rng, { level: level * tilt, decay, release: Math.min(0.25, decay * 0.18), filter });
  }
  sampledNote(synth, lane, t, part.instrument, pitch, velocity, mute ? Math.min(duration, 0.06 + duration * (1 - mute)) : duration, rng, { level, release: (tone.release ?? 0.3) * (1 - mute * 0.8), attack: tone.attack ?? 0, doubled: tone.detune ?? 0, filter });
}

function schedule(synth, lane, note, part, beatSeconds, rng) {
  const t = note.beat * beatSeconds, duration = note.duration * beatSeconds, velocity = note.velocity;
  const tone = Object.fromEntries(Object.entries(presets.get(part.instrument).controls).map(([name, spec]) => [name, part.tone[name] ?? spec.default]));
  if (RECORDED[part.instrument]) return recordedNote(synth, lane, part, t, note.pitch, velocity, duration, tone, rng);
  const start = synth.pending.length;
  switch (part.instrument) {
    case 'electric-piano': instruments.epiano(synth, lane, t, note.pitch, velocity, duration); break;
    case 'pad': instruments.padVoice(synth, lane, t, note.pitch, velocity, duration, tone); break;
    case 'pluck': instruments.pluck(synth, lane, t, note.pitch, velocity, { bright: tone.brightness, decay: tone.release }); break;
    case 'acid-bass': instruments.pluck(synth, lane, t, note.pitch, velocity, { bright: tone.brightness, decay: tone.release, q: 5, level: 0.18 }); break;
    case 'bass': instruments.bass(synth, lane, t, note.pitch, velocity, duration); break;
    case 'bell': instruments.bell(synth, lane, t, note.pitch, velocity, { decay: tone.release }); break;
    case 'marimba': instruments.marimba(synth, lane, t, note.pitch, velocity); break;
    case 'kick': instruments.kick(synth, lane, t, velocity); break;
    case 'clap': instruments.clap(synth, lane, t, velocity, rng); break;
    case 'snare':
      instruments.clap(synth, lane, t, velocity, rng, { level: 0.14 });
      instruments.bass(synth, lane, t, 50, velocity, 0.035, { level: 0.075, staccato: true });
      break;
    case 'hi-hat': instruments.hat(synth, lane, t, velocity, rng); break;
    case 'shaker': instruments.shaker(synth, lane, t, velocity, rng); break;
    default: sustained(synth, lane, t, note.pitch, velocity, duration, part.instrument, tone, rng);
  }
  // The primitives' acoustic partials assume 44.1 kHz; omit inaudible partials
  // at preview sample rates rather than feeding an oscillator past Nyquist.
  for (const voice of synth.pending.slice(start)) voice.layers = voice.layers.filter(layer => layer.freqEnv || layer.wave === WAVES.noise || layer.wave === WAVES.pink || layer.freq * Math.pow(2, Math.abs(layer.detune ?? 0) / 1200) < synth.sr * 0.45);
}

// The note values each instrument's synthesis above reads; a fingerprint
// ignores the rest. Drums and samples ignore pitch, toms clamp it, and
// struck or plucked sounds decay without reading duration.
const UNPITCHED = new Set(['kick', 'snare', 'clap', 'hi-hat', 'shaker', 'rock-kick', 'rock-snare', 'closed-hat', 'crash', 'ride', 'open-hat', 'noise', 'sample']);
const UNTIMED = new Set(['pluck', 'acid-bass', 'bell', 'marimba', 'kick', 'snare', 'clap', 'hi-hat', 'shaker', 'rock-kick', 'rock-snare', 'closed-hat', 'tom', 'crash', 'ride', 'open-hat']);
export function audibleNote(instrument, { pitch, beat, duration, velocity }) {
  return { pitch: UNPITCHED.has(instrument) ? null : instrument === 'tom' ? Math.max(35, Math.min(60, pitch)) : pitch, beat, duration: UNTIMED.has(instrument) ? null : duration, velocity };
}
// The sample settings each treatment in loadSample reads.
export function audibleSample(sample) {
  const effect = sample.effect;
  return {
    ...(sample.speech ? { speech: { text: sample.speech.text, voice: sample.speech.voice } } : { asset: sample.asset }),
    effect,
    ...(['tape', 'granular', 'chop'].includes(effect) ? { semitones: sample.semitones } : {}),
    ...(effect === 'granular' ? { stretch: sample.stretch } : {}),
    ...(effect === 'vocoder' ? { pitch: sample.pitch } : {}),
    ...(effect === 'chop' ? { pattern: (sample.pattern ?? CHOP_PATTERN).map(v => v == null || v < 0 ? null : v) } : {}),
  };
}

async function readSample(sample, projectDir, speech) {
  if (sample.speech) return speechAudio(sample.speech, speech);
  let path;
  if (sample.asset.startsWith('builtin:')) path = new URL(`../assets/voices/${sample.asset.slice(8)}.wav`, import.meta.url);
  else {
    if (!projectDir) throw new Error('A projectDir is required to load project assets.');
    const root = await realpath(resolve(projectDir, 'assets'));
    path = await realpath(resolve(projectDir, sample.asset));
    const local = relative(root, path);
    if (local.startsWith(`..${sep}`) || local === '..' || local.startsWith(sep)) throw new Error('Sample asset must stay within the project assets directory.');
  }
  const info = await stat(path);
  if (info.size > RENDER_LIMITS.maxSampleBytes) throw new Error('Sample WAVs must be at most 32 MB.');
  const bytes = await readFile(path);
  return parseWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

async function loadSample(sample, sampleRate, bpm, projectDir, speech) {
  const wav = await readSample(sample, projectDir, speech);
  if (!Number.isFinite(wav.sampleRate) || wav.sampleRate < 8000 || wav.sampleRate > 192000 || !wav.channels.length || wav.channels.length > 8 || wav.channels[0].length > wav.sampleRate * RENDER_LIMITS.maxSampleSeconds) throw new Error('Sample WAVs need 1–8 channels, 8–192 kHz and at most 60 seconds.');
  let data = resample(toMono(wav.channels), wav.sampleRate, sampleRate);
  if (data.some(v => !Number.isFinite(v))) throw new Error('Sample WAV contains non-finite audio.');
  switch (sample.effect) {
    case 'tape': data = tapePitch(data, sample.semitones); break;
    case 'granular': data = granularVoice(data, sampleRate, sample); break;
    case 'vocoder': data = vocodeVoice(data, sampleRate, { pitch: sample.pitch }); break;
    case 'chop': data = chopVoice(data, sampleRate, { bpm, semitones: sample.semitones, pattern: sample.pattern }); break;
  }
  return data;
}

/** Render a deterministic stereo buffer. from/to are seconds on the score timeline.
 * Progress receives {phase,progress,fraction,seconds,duration}; return false or abort signal
 * to cancel. Stems are dry post-part-mix buses, before shared master processing.
 * speech {cacheDir, synthesize, modelDir, offline, log} configures speech recipes (speech.js).
 */
export async function renderScore(score, options = {}) {
  const { from = 0, to } = options;
  const compiled = compileScore(score), total = compiled.beats * 60 / compiled.bpm;
  if (from === 0 && (to === undefined || to === total)) return renderRange(score, options);
  // An excerpt plays at the level of the whole track: render it all, master it once, then cut the excerpt.
  bounded(from, 0, total, 'from');
  bounded(to ?? total, 0, total, 'to');
  if ((to ?? total) <= from) throw new RangeError('to must be after from.');
  const full = await renderRange(score, { ...options, from: 0, to: undefined });
  const sampleRate = full.audio.sampleRate, first = Math.round(from * sampleRate), last = Math.round((to ?? total) * sampleRate);
  if (last <= first) throw new RangeError('Render range must contain at least one sample.');
  const cut = audio => audioBuffer([0, 1].map(ch => audio.getChannelData(ch).slice(first, last)), sampleRate);
  const audio = cut(full.audio);
  const report = { ...analyzeAudio([audio.getChannelData(0), audio.getChannelData(1)], sampleRate), from, to: to ?? total, sections: full.report.sections, suggestions: full.report.suggestions, loudness: full.report.loudness, loudnessGainDb: full.report.loudnessGainDb, limitedFraction: full.report.limitedFraction, stemDescription: full.report.stemDescription };
  report.warnings = [...technicalWarnings(report), ...full.report.warnings.filter(w => w.code === 'squashed')];
  return { ...full, audio, report, ...(full.stems ? { stems: Object.fromEntries(Object.entries(full.stems).map(([id, stem]) => [id, cut(stem)])) } : {}) };
}

async function renderRange(score, { sampleRate = 44100, mix = {}, projectDir, stems = false, from = 0, to, progress, signal, speech } = {}) {
  const expandedScore = compileScore(score);
  bounded(sampleRate, RENDER_LIMITS.minSampleRate, RENDER_LIMITS.maxSampleRate, 'sampleRate');
  if (!Number.isInteger(sampleRate)) throw new TypeError('sampleRate must be an integer.');
  const beatSeconds = 60 / expandedScore.bpm, duration = expandedScore.beats * beatSeconds;
  bounded(from, 0, duration, 'from');
  bounded(to ?? duration, 0, duration, 'to');
  const end = to ?? duration;
  if (end <= from) throw new RangeError('to must be after from.');
  if (progress !== undefined && typeof progress !== 'function') throw new TypeError('progress must be a callback.');
  const check = (phase, seconds) => {
    if (signal?.aborted || progress?.({ phase, progress: seconds / end, fraction: seconds / end, seconds, duration: end }) === false) {
      const error = new Error('Render cancelled.'); error.name = 'AbortError'; throw error;
    }
  };
  check('preparing', 0);
  const controls = mixControls(expandedScore, mix);
  const firstFrame = Math.round(from * sampleRate), lastFrame = Math.round(end * sampleRate);
  if (lastFrame <= firstFrame) throw new RangeError('Render range must contain at least one sample.');
  const frames = lastFrame - firstFrame;
  const channels = [new Float32Array(frames), new Float32Array(frames)];
  const stemBuffers = stems ? Object.fromEntries(controls.parts.map(p => [p.id, [new Float32Array(frames), new Float32Array(frames)]])) : null;
  const buses = [];
  for (const part of controls.parts) {
    if (!part.audible || !part.notes.length) continue;
    const synth = new Synth(sampleRate, lastFrame);
    const tone = presets.get(part.instrument).controls;
    const cutoff = part.tone.brightness ?? tone.brightness?.default;
    const filter = ['hi-hat', 'shaker'].includes(part.instrument) ? { type: 'highpass', freq: 6500 } : part.instrument === 'clap' || part.instrument === 'snare' ? { type: 'bandpass', freq: 1800, q: 0.7 } : cutoff ? { type: 'lowpass', freq: cutoff } : null;
    const lane = synth.lane({ gain: part.volume, pan: part.pan, filter, overdrive: part.instrument === 'guitar-crunch' ? (part.tone.drive ?? 0.7) : null });
    const rng = makeRng(hashSeed(expandedScore.seed, part.id));
    let sample, events;
    if (part.instrument === 'sample') {
      sample = await loadSample(part.sample, sampleRate, expandedScore.bpm, projectDir, speech);
      events = part.notes.filter(n => n.beat * beatSeconds < end).map(n => ({ start: Math.round(n.beat * beatSeconds * sampleRate), length: Math.min(sample.length, Math.round(n.duration * beatSeconds * sampleRate)), velocity: n.velocity }));
    } else for (const note of part.notes) if (note.beat * beatSeconds < end) schedule(synth, lane, note, part, beatSeconds, rng);
    buses.push({ part, synth, sample, events, next: 0, active: [], left: new Float32Array(BLOCK), right: new Float32Array(BLOCK) });
    check('preparing', 0);
  }
  const reverb = expandedScore.master.reverb > 0 ? new Reverb(sampleRate, { room: 0.75 }) : null;
  const compressor = new Compressor(sampleRate, { threshold: -12, ratio: 2, knee: 6, makeupDb: 0 });
  const left = new Float32Array(BLOCK), right = new Float32Array(BLOCK), send = new Float32Array(BLOCK);
  for (let offset = 0; offset < lastFrame; offset += BLOCK) {
    const count = Math.min(BLOCK, lastFrame - offset);
    left.fill(0); right.fill(0); send.fill(0);
    for (const bus of buses) {
      bus.left.fill(0); bus.right.fill(0);
      bus.synth.renderBlock(offset, count, bus.left, bus.right);
      if (bus.sample) {
        while (bus.next < bus.events.length && bus.events[bus.next].start < offset + count) bus.active.push(bus.events[bus.next++]);
        const angle = (bus.part.pan + 1) * Math.PI / 4;
        const gl = Math.cos(angle) * Math.SQRT2 * bus.part.volume, gr = Math.sin(angle) * Math.SQRT2 * bus.part.volume;
        for (const event of bus.active) {
          const start = Math.max(offset, event.start), finish = Math.min(offset + count, event.start + event.length);
          const fade = Math.max(1, Math.min(Math.round(sampleRate * 0.008), event.length / 2));
          for (let frame = start; frame < finish; frame++) {
            const position = frame - event.start;
            const envelope = Math.min(1, position / fade, (event.length - 1 - position) / fade);
            const value = bus.sample[position] * event.velocity * envelope;
            bus.left[frame - offset] += value * gl; bus.right[frame - offset] += value * gr;
          }
        }
        bus.active = bus.active.filter(e => e.start + e.length > offset + count);
      }
      const wet = presets.get(bus.part.instrument).drums ? 0.12 : ['bass', 'acid-bass', 'electric-bass'].includes(bus.part.instrument) ? 0.08 : 0.5;
      for (let i = 0; i < count; i++) {
        left[i] += bus.left[i]; right[i] += bus.right[i];
        send[i] += (bus.left[i] + bus.right[i]) * 0.5 * wet;
        const frame = offset + i - firstFrame;
        if (stemBuffers && frame >= 0) {
          stemBuffers[bus.part.id][0][frame] = bus.left[i]; stemBuffers[bus.part.id][1][frame] = bus.right[i];
        }
      }
    }
    if (reverb) reverb.process(send, count, left, right, expandedScore.master.reverb);
    compressor.process(left, right, count);
    for (let i = 0; i < count; i++) {
      const frame = offset + i - firstFrame;
      if (frame < 0) continue;
      // File edges follow the complete musical timeline, not an excerpt boundary.
      const time = (offset + i) / sampleRate;
      const fade = Math.max(0, Math.min(1, time / 0.004, (duration - time - 1 / sampleRate) / 0.04));
      channels[0][frame] = left[i] * fade;
      channels[1][frame] = right[i] * fade;
    }
    if (offset % (BLOCK * 64) === 0) { check('rendering', Math.min(end, (offset + count) / sampleRate)); await yieldTurn(); }
  }
  const mastered = masterInPlace(channels, sampleRate, { volume: controls.volume / DEFAULT_MASTER_VOLUME });
  const report = analyzeAudio(channels, sampleRate);
  report.from = from;
  report.to = end;
  report.sections = expandedScore.sections.map(s => ({ ...s, time: s.beat * beatSeconds, duration: s.beats * beatSeconds }));
  report.suggestions = arrangementSuggestions(expandedScore);
  report.loudness = mastered.loudness;
  report.loudnessGainDb = mastered.gainDb;
  report.limitedFraction = mastered.limited;
  report.warnings = technicalWarnings(report);
  if (report.limitedFraction > 0.01) report.warnings.push({ code: 'squashed', message: 'The limiter turns more than 1% of the track down by over 3 dB, so loud moments sound squashed. Lower the loudest parts, usually drums or bass, and render again.' });
  report.stemDescription = 'Dry stereo buses after part volume, pan and mute/solo, before the shared master reverb, compression, loudness matching and limiter. They do not sum to the mastered render.';
  check('complete', end);
  return { audio: audioBuffer(channels, sampleRate), report, parts: expandedScore.parts.map(({ id, name, color }) => ({ id, name, color })), ...(stemBuffers ? { stems: Object.fromEntries(Object.entries(stemBuffers).map(([id, data]) => [id, audioBuffer(data, sampleRate)])) } : {}), expandedScore };
}
