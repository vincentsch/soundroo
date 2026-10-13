import { biquadCoefs, makeFilter } from './synth.js';
import { clamp, fadeEdges, mtof } from './dsp.js';

function interpolate(samples, position) {
  const i = Math.floor(position);
  if (i < 0 || i >= samples.length) return 0;
  return samples[i] * (1 - position + i) + (samples[i + 1] ?? 0) * (position - i);
}

// Tape-style pitch changes also change speed, like playing a record faster.
export function tapePitch(samples, semitones = 0) {
  const ratio = Math.pow(2, semitones / 12);
  const out = new Float32Array(Math.max(1, Math.round(samples.length / ratio)));
  for (let i = 0; i < out.length; i++) out[i] = interpolate(samples, i * ratio);
  return out;
}

// Overlapping Hann grains change pitch while keeping the requested length.
// This is intentionally a textured sound-design effect, not natural singing.
export function granularVoice(samples, sampleRate, { semitones = 0, stretch = 1, grainSeconds = 0.065 } = {}) {
  const size = Math.max(32, Math.round(grainSeconds * sampleRate));
  const hop = Math.max(1, Math.floor(size / 4));
  const ratio = Math.pow(2, semitones / 12);
  const out = new Float32Array(Math.max(1, Math.round(samples.length * stretch)));
  const weights = new Float32Array(out.length);
  for (let start = -size; start < out.length; start += hop) {
    const sourceCenter = (start + size / 2) / stretch;
    for (let k = 0; k < size; k++) {
      const target = start + k;
      if (target < 0 || target >= out.length) continue;
      const weight = 0.5 - 0.5 * Math.cos(2 * Math.PI * k / (size - 1));
      const source = sourceCenter + (k - size / 2) * ratio;
      out[target] += interpolate(samples, source) * weight;
      weights[target] += weight;
    }
  }
  for (let i = 0; i < out.length; i++) if (weights[i] > 0.00001) out[i] /= weights[i];
  fadeEdges([out], sampleRate);
  return out;
}

function filterSample(filter, input) {
  const value = filter.b0 * input + filter.z1;
  filter.z1 = filter.b1 * input - filter.a1 * value + filter.z2;
  filter.z2 = filter.b2 * input - filter.a2 * value;
  return value;
}

// Speech-band envelopes shape a harmonic carrier: a real filter-bank vocoder.
export function vocodeVoice(samples, sampleRate, { pitch = 57, bands = 12, dry = 0.12 } = {}) {
  const count = Math.max(4, Math.min(24, Math.round(bands)));
  const frequencies = Array.from({ length: count }, (_, i) => 180 * Math.pow(Math.min(7500, sampleRate * 0.35) / 180, i / (count - 1)));
  const analysis = frequencies.map(f => {
    const filter = makeFilter('bandpass', f, 2.5); biquadCoefs('bandpass', f, 2.5, sampleRate, filter); return filter;
  });
  const synthesis = frequencies.map(f => {
    const filter = makeFilter('bandpass', f, 2.5); biquadCoefs('bandpass', f, 2.5, sampleRate, filter); return filter;
  });
  const envelopes = new Float32Array(count);
  const output = new Float32Array(samples.length);
  const fundamental = mtof(pitch);
  const harmonics = Math.min(48, Math.floor(sampleRate * 0.4 / fundamental));
  const attack = Math.exp(-1 / (sampleRate * 0.003));
  const release = Math.exp(-1 / (sampleRate * 0.025));
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const phase = 2 * Math.PI * fundamental * i / sampleRate;
    let carrier = 0;
    for (let h = 1; h <= harmonics; h++) carrier += Math.sin(phase * h) / h;
    let value = 0;
    for (let b = 0; b < count; b++) {
      const level = Math.abs(filterSample(analysis[b], samples[i]));
      const coefficient = level > envelopes[b] ? attack : release;
      envelopes[b] = level + (envelopes[b] - level) * coefficient;
      value += filterSample(synthesis[b], carrier) * envelopes[b];
    }
    output[i] = value;
    peak = Math.max(peak, Math.abs(value));
  }
  let sourcePeak = 0;
  for (const sample of samples) sourcePeak = Math.max(sourcePeak, Math.abs(sample));
  const gain = peak > 0 ? sourcePeak / peak : 0;
  const blend = clamp(dry, 0, 1);
  for (let i = 0; i < output.length; i++) output[i] = output[i] * gain * (1 - blend) + samples[i] * blend;
  fadeEdges([output], sampleRate);
  return output;
}

export const CHOP_PATTERN = Object.freeze([0, 1, 0, 2, 1, 3, 2, 0]);
export function chopVoice(samples, sampleRate, { bpm = 120, divisions = 2, pattern = CHOP_PATTERN, semitones = 0 } = {}) {
  const sliceCount = 4;
  const stepFrames = Math.round(sampleRate * 60 / bpm / divisions);
  const output = new Float32Array(stepFrames * pattern.length);
  const ratio = Math.pow(2, semitones / 12);
  const sliceFrames = Math.floor(samples.length / sliceCount);
  const fade = Math.min(Math.round(sampleRate * 0.008), Math.floor(stepFrames / 4));
  for (let step = 0; step < pattern.length; step++) {
    const index = pattern[step];
    if (index == null || index < 0) continue;
    const start = (Math.round(index) % sliceCount) * sliceFrames;
    const length = Math.min(stepFrames, Math.floor(sliceFrames / ratio));
    for (let i = 0; i < length; i++) {
      const envelope = Math.min(1, i / Math.max(1, fade), (length - 1 - i) / Math.max(1, fade));
      output[step * stepFrames + i] = interpolate(samples, start + i * ratio) * envelope;
    }
  }
  return output;
}
