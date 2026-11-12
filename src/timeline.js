// Beats to seconds. A score plays at its bpm from beat 0; each tempo change
// (score version 3) takes over from its beat. A change with `ramp` glides
// there instead: the tempo moves evenly, beat by beat, from the tempo before
// it and arrives at the new one on the change's beat (a ritardando or
// accelerando).

// [{beat, bpm, ramp}] in beat order, starting with the score's bpm at beat 0.
function points(bpm, changes = []) {
  return [{ beat: 0, bpm, ramp: false }, ...changes.map(({ beat, bpm: next, ramp = false }) => ({ beat, bpm: next, ramp: !!ramp }))];
}

// Seconds from the start of a segment to `beats` into it.
function segmentSeconds(from, to, length, beats) {
  if (!to?.ramp || to.bpm === from.bpm) return beats * 60 / from.bpm;
  const slope = (to.bpm - from.bpm) / length;
  return 60 / slope * Math.log((from.bpm + slope * beats) / from.bpm);
}

/** Converts between beats and seconds for a compiled score. tempoAt(beat)
 * gives the tempo in effect at a beat. */
export function makeTimeline({ bpm, beats, tempo = [] }) {
  const list = points(bpm, tempo);
  const starts = [0];
  for (let i = 0; i < list.length - 1; i++) {
    const from = list[i], to = list[i + 1];
    starts.push(starts[i] + segmentSeconds(from, to, to.beat - from.beat, to.beat - from.beat));
  }
  const segment = beat => {
    let i = list.length - 1;
    while (i > 0 && list[i].beat > beat) i--;
    return i;
  };
  const seconds = beat => {
    const i = segment(beat), from = list[i], to = list[i + 1];
    return starts[i] + segmentSeconds(from, to?.ramp ? to : null, to ? to.beat - from.beat : 0, beat - from.beat);
  };
  const tempoAt = beat => {
    const i = segment(beat), from = list[i], to = list[i + 1];
    return to?.ramp ? from.bpm + (to.bpm - from.bpm) * (beat - from.beat) / (to.beat - from.beat) : from.bpm;
  };
  const beatAt = time => {
    let i = starts.length - 1;
    while (i > 0 && starts[i] > time) i--;
    const from = list[i], to = list[i + 1], into = time - starts[i];
    if (!to?.ramp || to.bpm === from.bpm) return from.beat + into * from.bpm / 60;
    const slope = (to.bpm - from.bpm) / (to.beat - from.beat);
    return from.beat + from.bpm * (Math.exp(into * slope / 60) - 1) / slope;
  };
  return { seconds, beatAt, tempoAt, duration: seconds(beats), constant: list.length === 1 };
}
