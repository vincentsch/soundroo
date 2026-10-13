import { parsePitch } from './score.js';

/** Small score-building tools; all output is ordinary editable JSON. */
export function note(pitch, beat, duration = 0.5, velocity = 0.7) {
  return { pitch: parsePitch(pitch), beat, duration, velocity };
}
const qualities = { major: [0, 4, 7], minor: [0, 3, 7], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10], dominant7: [0, 4, 7, 10], sus2: [0, 2, 7], sus4: [0, 5, 7], add9: [0, 4, 7, 14], minor9: [0, 3, 7, 10, 14], diminished: [0, 3, 6] };
export function chordPitches(root, quality = 'major', { inversion = 0 } = {}) {
  const intervals = qualities[quality];
  if (!intervals) throw new TypeError(`Unknown chord quality: ${quality}.`);
  if (!Number.isInteger(inversion) || inversion < 0 || inversion >= intervals.length) throw new TypeError('Inversion must select a chord tone.');
  const pitches = intervals.map(interval => parsePitch(root) + interval);
  for (let i = 0; i < inversion; i++) pitches.push(pitches.shift() + 12);
  return pitches.map(parsePitch);
}
export function chordNotes(pitches, beat, duration, velocity = 0.6, { strum = 0 } = {}) {
  return pitches.map((pitch, i) => note(pitch, beat + i * strum, duration, velocity));
}
export function pattern(beats, notes) {
  return { beats, notes: notes.map(n => ({ ...n, pitch: parsePitch(n.pitch) })) };
}
export function transformPattern(source, { transpose = 0, velocity = 1, reverse = false, invertAround, timeScale = 1 } = {}) {
  if (!Number.isFinite(timeScale) || timeScale <= 0) throw new TypeError('Pattern timeScale must be positive.');
  return pattern(source.beats * timeScale, source.notes.map(n => ({ ...n, pitch: (invertAround === undefined ? parsePitch(n.pitch) : 2 * parsePitch(invertAround) - parsePitch(n.pitch)) + transpose, beat: (reverse ? source.beats - n.beat - n.duration : n.beat) * timeScale, duration: n.duration * timeScale, velocity: n.velocity * velocity })).sort((a, b) => a.beat - b.beat));
}
export function arrangePattern(part, name, source, { beat = 0, repeat = 1, transpose = 0, velocity = 1 } = {}) {
  part.patterns ??= {};
  part.clips ??= [];
  if (part.patterns[name] && JSON.stringify(part.patterns[name]) !== JSON.stringify(source)) throw new Error(`Pattern ${name} already exists with different notes.`);
  part.patterns[name] = structuredClone(source);
  part.clips.push({ pattern: name, beat, repeat, transpose, velocity });
  return part;
}
export function arpeggiate(pitches, { beat = 0, beats = 4, step = 0.5, gate = 0.75, velocity = 0.6, order = pitches.map((_, i) => i) } = {}) {
  if (!pitches.length || !order.length || !Number.isFinite(step) || step <= 0 || !Number.isFinite(beats) || beats <= 0 || beats / step > 100000 || !Number.isFinite(gate) || gate <= 0 || gate > 1) throw new TypeError('Arpeggios need pitches, order, bounded positive timing and gate 0–1.');
  if (order.some(i => !Number.isInteger(i) || i < 0 || i >= pitches.length)) throw new TypeError('Arpeggio order must index chord pitches.');
  const output = [];
  for (let i = 0; i * step < beats - 1e-8; i++) output.push(note(pitches[order[i % order.length]], beat + i * step, Math.min(step * gate, beats - i * step), velocity * (i % order.length === 0 ? 1 : 0.82)));
  return output;
}
export function makeSections(items, { beatsPerBar = 4, durationScale = 1 } = {}) {
  if (!Number.isFinite(durationScale) || durationScale <= 0 || durationScale > 4) throw new TypeError('durationScale must be greater than 0 and at most 4.');
  let beat = 0;
  return items.map(([id, name, bars]) => {
    const beats = Math.max(1, Math.round(bars * durationScale)) * beatsPerBar;
    const section = { id, name, beat, beats };
    beat += beats;
    return section;
  });
}
