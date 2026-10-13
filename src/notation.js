// Score version 2 notation. Two compact strings describe a pattern's notes,
// and the compiler turns them into ordinary {pitch, beat, duration, velocity}
// events, so a version 2 score expands to the same note lists as version 1.
//
//   steps: "x..x|..x.|x...|x.o."   hits spread evenly over the pattern's beats
//   line:  "G4/.5 Eb5 [C4 Eb4 G4]/2@.6 -/1"   pitch/duration@velocity in order

export function parsePitch(pitch) {
  if (Number.isInteger(pitch) && pitch >= 0 && pitch <= 127) return pitch;
  if (typeof pitch === 'string') {
    const match = /^([A-Ga-g])([#b]?)(-?\d{1,2})$/.exec(pitch);
    if (match) {
      const pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1].toUpperCase()];
      const midi = (Number(match[3]) + 1) * 12 + pc + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
      if (midi >= 0 && midi <= 127) return midi;
    }
  }
  throw new TypeError('Expected a MIDI integer 0–127 or scientific pitch such as C#4.');
}

export const STEP_VELOCITY = Object.freeze({ X: 0.95, x: 0.75, o: 0.4 });
export const LINE_VELOCITY = 0.7;
const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)$/;
const MAX_ISSUES = 8;

// Hits share the pattern evenly: 16 steps over 4 beats are sixteenth notes.
// Each hit lasts one step. X, x and o set velocity; "." rests; "|" and spaces
// only help reading.
export function parseSteps(text, beats, pitch = 60) {
  const hits = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '|' || /\s/.test(c)) continue;
    if (c === '.') hits.push(0);
    else if (Object.hasOwn(STEP_VELOCITY, c)) hits.push(STEP_VELOCITY[c]);
    else return { notes: [], issues: [`Character ${i + 1} “${c}” is not a step. Use X, x or o for hits and . for rests.`] };
  }
  if (!hits.length) return { notes: [], issues: ['Write at least one step.'] };
  const step = beats / hits.length;
  return { notes: hits.flatMap((velocity, i) => velocity ? [{ pitch, beat: i * step, duration: step, velocity }] : []), issues: [] };
}

function duration(text) {
  const [a, b, extra] = text.split('/');
  if (extra !== undefined || !NUMBER.test(a) || (b !== undefined && !NUMBER.test(b))) return NaN;
  return b === undefined ? Number(a) : Number(a) / Number(b);
}
function pitch(text) {
  return parsePitch(/^\d+$/.test(text) ? Number(text) : text);
}
function tokens(text) {
  const list = [];
  for (let i = 0; i < text.length;) {
    if (/[\s|]/.test(text[i])) { i++; continue; }
    const start = i;
    if (text[i] === '[') {
      const close = text.indexOf(']', i);
      if (close < 0) return { list, error: `Character ${i + 1}: the chord “[” is never closed.` };
      i = close + 1;
    }
    while (i < text.length && !/[\s|]/.test(text[i])) i++;
    list.push(text.slice(start, i));
  }
  return { list };
}

// Tokens run in order from beat 0. A duration in beats follows "/" (".5",
// "1.5", or a fraction such as "1/3") and stays in effect until the next one;
// the first defaults to one beat. "@" sets one token's velocity (default 0.7).
// "-" rests and [ ] sounds a chord.
export function parseLine(text, beats) {
  const notes = [], issues = [];
  const { list, error } = tokens(text);
  let position = 0, length = 1;
  for (const [index, token] of list.entries()) {
    if (issues.length >= MAX_ISSUES) break;
    const fail = message => issues.push(`Token ${index + 1} “${token}”: ${message}`);
    const match = /^(\[[^\]]*\]|[^/@[\]]+)(?:\/([^@]*))?(?:@(.*))?$/.exec(token);
    if (!match) { fail('write pitch/duration@velocity, [chord]/duration or -/duration.'); continue; }
    const [, item, durationText, velocityText] = match;
    if (durationText !== undefined) {
      const value = duration(durationText);
      if (!Number.isFinite(value) || value <= 0) { fail('the duration must be a positive number of beats such as .5, 2 or 1/3.'); continue; }
      length = value;
    }
    let velocity = LINE_VELOCITY;
    if (velocityText !== undefined) {
      velocity = NUMBER.test(velocityText) ? Number(velocityText) : NaN;
      if (!(velocity > 0 && velocity <= 1)) { fail('velocity must be greater than 0 and at most 1.'); continue; }
    }
    const start = position;
    position += length;
    if (item === '-') { if (velocityText !== undefined) fail('a rest has no velocity.'); continue; }
    const names = item.startsWith('[') ? item.slice(1, -1).trim().split(/\s+/).filter(Boolean) : [item];
    if (!names.length) { fail('the chord is empty.'); continue; }
    let pitches;
    try { pitches = names.map(pitch); } catch (error) { fail(error.message); continue; }
    if (start + length <= beats + 1e-8) for (const p of pitches) notes.push({ pitch: p, beat: start, duration: length, velocity });
  }
  if (error) issues.push(error);
  else if (!list.length) issues.push('Write at least one note or rest.');
  else if (position > beats + 1e-8 && issues.length < MAX_ISSUES) issues.push(`The line lasts ${+position.toFixed(6)} beats, longer than the pattern’s ${beats}.`);
  return { notes, issues };
}
