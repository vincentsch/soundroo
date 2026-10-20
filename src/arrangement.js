// Arrangement suggestions for an expanded score. They point at what listeners
// notice in agent-written music (late drums, long unchanged loops, sections
// that all sound the same, a silent ending). They are hints, not errors: a
// slow intro or a steady loop is fine when the person asked for it.
import { getCatalog } from './catalog.js';

const DRUMS = new Set(getCatalog().instruments.filter(preset => preset.drums).map(preset => preset.id));
const BASSES = new Set(['bass', 'acid-bass', 'electric-bass', 'chip-bass']);
// A final chord and the reverb ring on after the last note, so only a long silence counts.
const BEATS_PER_BAR = 4, LATE_START_BARS = 8, LOOP_BARS = 4, LOOP_FATIGUE_BARS = 24, SILENT_END_SECONDS = 10;

const bar = beat => Math.floor(beat / BEATS_PER_BAR) + 1;

function lateStart(score) {
  const rhythm = score.parts.filter(part => DRUMS.has(part.instrument) || BASSES.has(part.instrument)).flatMap(part => part.notes);
  if (!rhythm.length) return null;
  const first = Math.min(...rhythm.map(note => note.beat));
  if (first < LATE_START_BARS * BEATS_PER_BAR) return null;
  return { code: 'late_start', message: `Drums and bass first come in at bar ${bar(first)}. Lively tracks usually start them within the first eight bars; keep the long intro only if the person asked for a slow build.` };
}

function loopFatigue(score) {
  const bars = Math.ceil(score.beats / BEATS_PER_BAR);
  const content = Array.from({ length: bars }, () => []);
  for (const part of score.parts) for (const note of part.notes) {
    const index = Math.floor(note.beat / BEATS_PER_BAR);
    if (index < bars) content[index].push(`${part.id}:${(note.beat - index * BEATS_PER_BAR).toFixed(3)}:${note.pitch}:${note.duration.toFixed(3)}:${note.velocity.toFixed(2)}`);
  }
  const signature = content.map(notes => notes.sort().join('|'));
  // A run of bars that each equal the bar four earlier is one four-bar block played again and again.
  let best = { length: 0, first: 0 }, runStart = null;
  for (let index = LOOP_BARS; index <= bars; index++) {
    const same = index < bars && signature[index] !== '' && signature[index] === signature[index - LOOP_BARS];
    if (same && runStart === null) runStart = index;
    if (!same && runStart !== null) {
      const length = index - runStart + LOOP_BARS;
      if (length > best.length) best = { length, first: runStart - LOOP_BARS };
      runStart = null;
    }
  }
  if (best.length < LOOP_FATIGUE_BARS) return null;
  return { code: 'loop_fatigue', message: `Bars ${best.first + 1}–${best.first + best.length} repeat the same four bars without a change. Vary the drums, add or drop a part, or change the melody at least every eight bars.` };
}

function flatEnergy(score) {
  if (score.sections.length < 3) return null;
  const active = score.sections.map(section => score.parts.filter(part => part.notes.some(note => note.beat >= section.beat && note.beat < section.beat + section.beats)).map(part => part.id).sort().join(','));
  if (new Set(active).size > 1) return null;
  return { code: 'flat_energy', message: 'Every section uses the same parts, so nothing builds. Drop some parts in a verse or break and bring them back for the chorus.' };
}

function silentEnd(score) {
  const notes = score.parts.flatMap(part => part.notes);
  if (!notes.length) return null;
  const end = Math.max(...notes.map(note => note.beat + note.duration));
  const silence = (score.beats - end) * 60 / score.bpm;
  if (silence < SILENT_END_SECONDS) return null;
  return { code: 'silent_end', message: `The last ${Math.round(silence)} seconds are silent. Set beats to where the music ends, plus a short tail.` };
}

/** Suggestions for an expanded score: [{code, message}], most important first. */
export function arrangementSuggestions(score) {
  return [lateStart, loopFatigue, flatEnergy, silentEnd].map(check => check(score)).filter(Boolean);
}
