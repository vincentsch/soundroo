import { note, chordPitches, chordNotes, pattern, transformPattern, arrangePattern, arpeggiate, makeSections } from '../src/compose.js';
import { hashSeed, makeRng } from '../src/audio/rng.js';

const colors = ['#e8ac74', '#8cae9d', '#b6a2d0', '#78a9bb', '#d48e8a', '#d7be73'];
function score(id, title, description, genre, mood, key, bpm, form, seed, scale, meter = 4, reverb = 0.22) {
  const sections = makeSections(form, { beatsPerBar: meter, durationScale: scale });
  return { version: 1, id, title, description, genre, mood, key, bpm, beats: sections.at(-1).beat + sections.at(-1).beats, seed: hashSeed(seed, id), sections, master: { volume: 0.83, reverb }, parts: [] };
}
function part(s, id, name, instrument, volume = 0.8, pan = 0, tone) {
  const p = { id, name, instrument, volume, pan, color: colors[s.parts.length % colors.length], notes: [], ...(tone ? { tone } : {}) };
  s.parts.push(p); return p;
}
const add = (p, pitches, beat, duration, velocity = 0.6) => p.notes.push(...chordNotes(Array.isArray(pitches) ? pitches : [pitches], beat, duration, velocity));
function bars(section, meter, callback) { for (let i = 0; i < section.beats / meter; i++) callback(section.beat + i * meter, i); }
function motif(pitches, times, durations, length = 8, velocity = 0.72) { return pattern(length, pitches.map((p, i) => note(p, times[i], durations[i], velocity * (i % 3 === 0 ? 1 : 0.83)))); }
function playMotif(p, name, source, section, { every = source.beats, transpose = 0, velocity = 1, offset = 0 } = {}) {
  for (let beat = section.beat + offset; beat + source.beats <= section.beat + section.beats + 1e-8; beat += every) arrangePattern(p, name, source, { beat, transpose, velocity });
}
function ending(s, bass, harmony, root, quality, meter = 4) {
  const section = s.sections.at(-1);
  if (bass) add(bass, parseRoot(root) - 24, section.beat, Math.min(meter * 2, section.beats) - 0.2, 0.6);
  if (harmony) add(harmony, chordPitches(root, quality), section.beat, Math.max(0.5, section.beats / 2), 0.45);
}
const parseRoot = p => chordPitches(p)[0];

function house(seed, scale) {
  const s = score('glass-orchard', 'Glass Orchard', 'A rising tine figure opens into offbeat bass, warm ninths and a bright answering pluck, then returns to a quiet final chord.', 'Melodic house', 'Warm, hopeful', 'D minor', 116, [['opening', 'First light', 8], ['groove', 'Orchard paths', 16], ['air', 'Open sky', 8], ['return', 'Full bloom', 16], ['ending', 'Afterglow', 4]], seed, scale);
  const keys = part(s, 'tines', 'Tine motif', 'electric-piano', 0.88, -0.2), pad = part(s, 'cloud', 'Ninths', 'pad', 0.72, 0.15), bass = part(s, 'roots', 'Offbeat bass', 'bass', 0.68), lead = part(s, 'answer', 'Pluck answer', 'pluck', 0.55, 0.35);
  const kick = part(s, 'pulse', 'Four on the floor', 'kick', 0.75), clap = part(s, 'hands', 'Clap', 'clap', 0.68), hat = part(s, 'leaves', 'Offbeat hats', 'hi-hat', 0.8, -0.35);
  const a = motif([74, 77, 81, 79, 76, 74, 72], [0, 0.75, 1.5, 3, 4.5, 5.25, 6.5], [0.55, 0.55, 1.1, 0.6, 0.45, 0.9, 1]);
  const response = motif([86, 84, 81, 79], [0.5, 2, 4, 6.5], [0.4, 0.5, 0.8, 0.4]);
  const harmony = [['D3', 'minor9'], ['Bb2', 'maj7'], ['F3', 'add9'], ['C3', 'sus2']];
  for (const sec of s.sections.slice(0, -1)) {
    playMotif(keys, sec.id === 'return' ? 'bloom' : 'seed', sec.id === 'return' ? transformPattern(a, { transpose: 12, velocity: 0.86 }) : a, sec, { velocity: sec.id === 'opening' ? 0.75 : 1 });
    bars(sec, 4, (b, i) => {
      const [root, quality] = harmony[Math.floor(i / 2) % 4], pitches = chordPitches(root, quality);
      if (i % 2 === 0) add(pad, pitches, b, Math.min(7.5, sec.beat + sec.beats - b), 0.55);
      if (sec.id === 'groove' || sec.id === 'return') {
        for (let j = 0; j < 4; j++) { add(kick, 36, b + j, 0.2, 0.85); add(hat, 42, b + j + 0.5, 0.15, j % 2 ? 0.58 : 0.75); add(bass, pitches[0] - 12, b + j + 0.5, 0.35, 0.75); }
        for (const j of [1, 3]) add(clap, 39, b + j, 0.15, 0.76);
        if (i % 8 === 7) for (const j of [3.25, 3.5, 3.75]) add(hat, 42, b + j, 0.1, 0.45);
      }
    });
    if (sec.id === 'return' || sec.id === 'air') playMotif(lead, 'response', response, sec, { offset: 0 });
  }
  ending(s, bass, pad, 'D3', 'minor9'); add(keys, [74, 77, 81], s.sections.at(-1).beat + 1, 4, 0.55);
  return s;
}

function downtempo(seed, scale) {
  const s = score('paper-tides', 'Paper Tides', 'A lopsided wooden melody drifts above soft electric-piano harmony, with a sparse beat and a reversed answering phrase.', 'Downtempo', 'Intimate, drifting', 'A minor', 86, [['opening', 'Fold', 4], ['drift', 'Low tide', 12], ['bridge', 'Between shores', 8], ['return', 'Incoming tide', 12], ['ending', 'Unfold', 4]], seed, scale, 4, 0.3);
  const wood = part(s, 'wood', 'Wood melody', 'marimba', 0.85, -0.3), keys = part(s, 'paper', 'Soft tines', 'electric-piano', 0.75, 0.25, { brightness: 2300 }), bass = part(s, 'undertow', 'Round low end', 'bass', 0.66), kick = part(s, 'steps', 'Sparse kick', 'kick', 0.65), snare = part(s, 'brush', 'Soft snare', 'snare', 0.45), shaker = part(s, 'sand', 'Shaken sand', 'shaker', 0.65, 0.4);
  const a = motif([76, 79, 74, 72, 71, 76], [0, 1.25, 2.5, 4.25, 5.5, 7], [0.65, 0.55, 0.8, 0.5, 0.85, 0.5]);
  const chords = [['A2', 'min7'], ['F3', 'maj7'], ['C3', 'maj7'], ['E3', 'sus4']];
  for (const sec of s.sections.slice(0, -1)) {
    playMotif(wood, sec.id === 'bridge' ? 'reflection' : 'tide', sec.id === 'bridge' ? transformPattern(a, { reverse: true, transpose: -12 }) : a, sec, { velocity: sec.id === 'opening' ? 0.65 : 1 });
    bars(sec, 4, (b, i) => {
      const pitches = chordPitches(...chords[i % 4]);
      add(keys, pitches, b + 0.25, 2.9, 0.5); add(bass, pitches[0] - 12, b, 1.6, 0.6);
      if (sec.id !== 'opening' && sec.id !== 'bridge') {
        for (const j of [0, 2.75]) add(kick, 36, b + j, 0.15, 0.75);
        for (const j of [1, 3]) add(snare, 38, b + j + 0.06, 0.15, 0.58);
        for (let j = 0; j < 8; j++) add(shaker, 42, b + j * 0.5 + (j % 2 ? 0.12 : 0), 0.1, j % 2 ? 0.45 : 0.65);
        if (i % 4 === 3) add(bass, pitches[0], b + 3.25, 0.55, 0.4);
      }
    });
  }
  ending(s, bass, keys, 'A3', 'min7'); add(wood, [76, 79], s.sections.at(-1).beat + 2, 0.8, 0.42); return s;
}

function ambient(seed, scale) {
  const s = score('blue-distance', 'Blue Distance', 'Long suspended chords widen into a luminous middle register; isolated bell calls and filtered air leave space for a slow, resolved ending.', 'Ambient', 'Spacious, contemplative', 'E major', 64, [['opening', 'Horizon', 8], ['rise', 'Nearer light', 8], ['wide', 'Wide water', 12], ['ending', 'Distance', 4]], seed, scale, 4, 0.55);
  const pad = part(s, 'horizon', 'Slow pad', 'pad', 0.75, -0.15, { attack: 1.8, release: 2.8, brightness: 1400, detune: 11 }), strings = part(s, 'glow', 'Upper glow', 'strings', 0.5, 0.3), bells = part(s, 'beacons', 'Bell calls', 'bell', 0.8, -0.4, { release: 3.5 }), air = part(s, 'air', 'Filtered air', 'noise', 0.16, 0.2);
  const chords = [['E3', 'add9'], ['A3', 'maj7'], ['C#3', 'min7'], ['B2', 'sus4']];
  for (const [si, sec] of s.sections.slice(0, -1).entries()) {
    bars(sec, 4, (b, i) => {
      if (i % 2 !== 0) return;
      const pitches = chordPitches(...chords[(i / 2 + si) % 4]);
      add(pad, pitches, b, Math.min(7.5, sec.beat + sec.beats - b), 0.52);
      if (si > 0) add(strings, pitches.slice(1).map(p => p + 12), b + 1, Math.min(6, sec.beat + sec.beats - b - 1), 0.4);
      add(bells, [83, 78, 80, 75][(i / 2 + si) % 4], b + 2.5, 1.2, 0.58);
      if (si === 2) add(bells, [87, 85, 83][i % 3], b + 6, 0.8, 0.3);
      add(air, 60, b, Math.min(6, sec.beat + sec.beats - b), 0.6);
    });
  }
  ending(s, null, pad, 'E3', 'add9'); add(bells, 88, s.sections.at(-1).beat + 1.5, 1, 0.45); return s;
}

function synthwave(seed, scale) {
  const s = score('afterimage-drive', 'Afterimage Drive', 'A bold climbing analog hook crosses pulsing octaves and glass arpeggios. The bridge dims the drums before a higher final chorus.', 'Synthwave', 'Nocturnal, determined', 'F# minor', 104, [['opening', 'Ignition', 4], ['verse', 'Empty avenue', 12], ['chorus', 'Afterimages', 12], ['bridge', 'Underpass', 8], ['return', 'Last turn', 8], ['ending', 'Home', 4]], seed, scale);
  const lead = part(s, 'headlights', 'Analog hook', 'analog-lead', 0.65, -0.15, { brightness: 3600, release: 0.16 }), arp = part(s, 'glass', 'Glass arpeggio', 'fm-lead', 0.4, 0.4, { release: 0.1 }), pad = part(s, 'sky', 'Chord bed', 'strings', 0.65, -0.3), bass = part(s, 'motor', 'Octave bass', 'acid-bass', 0.58, 0, { brightness: 950, release: 0.18 }), kick = part(s, 'wheels', 'Kick', 'kick', 0.7), snare = part(s, 'signs', 'Snare', 'snare', 0.75), hat = part(s, 'sparks', 'Hats', 'hi-hat', 0.65, 0.3);
  const a = motif([78, 81, 85, 83, 81, 80, 78, 76], [0, 1, 2.5, 3.25, 4, 5, 6.25, 7], [0.8, 1.1, 0.55, 0.55, 0.8, 0.85, 0.45, 0.7]);
  const chords = [['F#3', 'minor'], ['D3', 'maj7'], ['A3', 'major'], ['E3', 'sus2']];
  for (const sec of s.sections.slice(0, -1)) {
    if (['chorus', 'return'].includes(sec.id)) playMotif(lead, sec.id === 'return' ? 'high-road' : 'hook', sec.id === 'return' ? transformPattern(a, { transpose: 12, velocity: 0.8 }) : a, sec);
    bars(sec, 4, (b, i) => {
      const pitches = chordPitches(...chords[i % 4]); add(pad, pitches, b, 3.6, 0.5);
      if (sec.id !== 'bridge') {
        arp.notes.push(...arpeggiate(pitches.map(p => p + 12), { beat: b, step: 0.5, velocity: 0.45, order: [0, 2, 1, 2] }));
        for (let j = 0; j < 8; j++) { add(bass, pitches[0] - (j % 2 ? 0 : 12), b + j / 2, 0.28, j % 2 ? 0.45 : 0.7); add(hat, 42, b + j / 2, 0.1, j % 2 ? 0.4 : 0.6); }
        if (sec.id !== 'opening') { for (const j of [0, 2]) add(kick, 36, b + j, 0.2, 0.85); for (const j of [1, 3]) add(snare, 38, b + j, 0.2, 0.8); }
      } else add(lead, [73, 76, 78, 80][i % 4], b + 0.5, 2.5, 0.45);
    });
  }
  ending(s, bass, pad, 'F#3', 'minor'); add(lead, 78, s.sections.at(-1).beat, 3, 0.5); return s;
}

function piano(seed, scale) {
  const s = score('small-hours', 'Small Hours', 'An unhurried three-beat piano miniature: a falling question, a brighter inversion, then a low-register reprise with room to breathe.', 'Minimal piano', 'Tender, reflective', 'C major', 72, [['opening', 'Question', 8], ['middle', 'Window light', 8], ['return', 'Remembering', 12], ['ending', 'Rest', 4]], seed, scale, 3, 0.32);
  const right = part(s, 'right-hand', 'Piano melody', 'piano', 0.85, 0.22, { brightness: 4800, release: 0.8 }), left = part(s, 'left-hand', 'Piano accompaniment', 'piano', 0.75, -0.3, { brightness: 2800, release: 0.65 });
  const a = motif([79, 76, 74, 72, 76, 71], [0, 1, 2, 3.5, 4, 5], [0.9, 0.8, 0.8, 0.4, 0.8, 0.9], 6, 0.65);
  const b = motif([81, 79, 83, 79, 77, 76], [0, 0.75, 2, 3, 4.25, 5], [0.6, 1, 0.8, 1, 0.55, 0.9], 6, 0.7);
  const chords = [['C3', 'maj7'], ['A2', 'min7'], ['F3', 'maj7'], ['G2', 'sus4']];
  const rng = makeRng(s.seed);
  for (const sec of s.sections.slice(0, -1)) {
    playMotif(right, sec.id === 'middle' ? 'window' : sec.id === 'return' ? 'memory' : 'question', sec.id === 'middle' ? b : sec.id === 'return' ? transformPattern(a, { transpose: -12, velocity: 0.85 }) : a, sec);
    bars(sec, 3, (beat, i) => {
      const pitches = chordPitches(...chords[Math.floor(i / 2) % 4]);
      add(left, pitches[0] - 12, beat, 2.5, 0.48 + rng.next() * 0.08);
      add(left, pitches.slice(1, 3), beat + 1, 1.7, 0.38 + rng.next() * 0.07);
      if (sec.id === 'middle' && i % 2) add(right, 84, beat + 2.25, 0.6, 0.32);
    });
  }
  ending(s, null, left, 'C3', 'maj7', 3); add(right, [72, 76], s.sections.at(-1).beat + 1, 4.5, 0.42); return s;
}

function broken(seed, scale) {
  const s = score('sidewalk-kites', 'Sidewalk Kites', 'Syncopated FM phrases hop across a broken drum grid. Bass answers the melody, and a stripped bridge rebuilds into playful counterpoint.', 'Broken beat', 'Agile, bright', 'G minor', 132, [['opening', 'Lift', 4], ['groove', 'Crosswind', 12], ['reply', 'Two kites', 12], ['bridge', 'Still air', 8], ['return', 'Updraft', 8], ['ending', 'Landing', 4]], seed, scale, 4, 0.18);
  const lead = part(s, 'kite', 'FM motif', 'fm-lead', 0.7, -0.25, { release: 0.12 }), answer = part(s, 'reply', 'Wood reply', 'marimba', 0.65, 0.4), keys = part(s, 'color', 'Tine stabs', 'electric-piano', 0.64), bass = part(s, 'bounce', 'Bass answer', 'bass', 0.67), kick = part(s, 'feet', 'Broken kick', 'kick', 0.7), snare = part(s, 'claps', 'Snare', 'snare', 0.65), hat = part(s, 'thread', 'Skipping hats', 'hi-hat', 0.65, 0.3);
  const a = motif([79, 82, 77, 79, 86, 84, 82], [0.25, 1.5, 2.25, 3.5, 4.75, 6, 7.25], [0.35, 0.4, 0.45, 0.3, 0.65, 0.4, 0.5]);
  const response = motif([74, 77, 79, 77], [0, 2.75, 4.25, 6.75], [0.5, 0.45, 0.6, 0.65]);
  const chords = [['G3', 'min7'], ['Eb3', 'maj7'], ['Bb2', 'maj7'], ['D3', 'dominant7']];
  for (const sec of s.sections.slice(0, -1)) {
    if (sec.id !== 'bridge') playMotif(lead, 'kite', a, sec);
    if (['reply', 'return', 'bridge'].includes(sec.id)) playMotif(answer, 'reply', response, sec);
    bars(sec, 4, (b, i) => {
      const pitches = chordPitches(...chords[i % 4]);
      for (const j of [0.75, 2.5]) add(keys, pitches, b + j, 0.4, 0.55);
      for (const j of [0, 1.75, 3.25]) add(bass, pitches[0] - 12 + (j === 3.25 ? 7 : 0), b + j, 0.45, 0.7);
      if (sec.id !== 'opening' && sec.id !== 'bridge') {
        for (const j of (i % 2 ? [0, 1.5, 2.75] : [0, 2.25, 3.5])) add(kick, 36, b + j, 0.18, 0.8);
        for (const j of [1, 3]) add(snare, 38, b + j, 0.15, 0.73);
        for (const j of [0.5, 1.25, 1.75, 2.5, 3.25, 3.75]) add(hat, 42, b + j, 0.1, j === 3.75 ? 0.4 : 0.6);
        if (i % 4 === 3) add(snare, 38, b + 3.75, 0.1, 0.35);
      }
    });
  }
  ending(s, bass, keys, 'G3', 'min7'); add(answer, [79, 82], s.sections.at(-1).beat + 1, 0.7, 0.5); return s;
}

function dub(seed, scale) {
  const s = score('room-for-rain', 'Room for Rain', 'Deep half-time bass and organ skanks leave space for three spoken phrases, with tape echoes and granular rain in the middle passage.', 'Dub', 'Deep, spacious', 'D minor', 78, [['opening', 'Clouds', 4], ['groove', 'Room', 12], ['bridge', 'Rain', 8], ['return', 'Clear streets', 12], ['ending', 'Shelter', 4]], seed, scale, 4, 0.48);
  const organ = part(s, 'skank', 'Organ skanks', 'organ', 0.68, -0.35, { release: 0.1, brightness: 1900 }), bass = part(s, 'ground', 'Dub bass', 'bass', 0.85), bell = part(s, 'drops', 'Echo droplets', 'pluck', 0.44, 0.45, { brightness: 2400, release: 0.7 }), kick = part(s, 'heart', 'Half-time kick', 'kick', 0.7), snare = part(s, 'rim', 'Sparse snare', 'snare', 0.6), hat = part(s, 'rain', 'Shaker', 'shaker', 0.65, -0.3);
  const voices = [
    ['slow', 'Slow down', 'slow-down', 'dry', -0.2],
    ['city', 'City tape', 'city-never-sleeps', 'tape', 0.3],
    ['stay', 'Granular stay', 'stay-a-little', 'granular', 0.1],
  ].map(([id, name, asset, effect, pan]) => { const p = part(s, id, name, 'sample', 0.38, pan); p.sample = { asset: `builtin:${asset}`, effect, semitones: effect === 'tape' ? -3 : 0, stretch: effect === 'granular' ? 1.8 : 1 }; return p; });
  const roots = [50, 50, 46, 48];
  for (const sec of s.sections.slice(0, -1)) {
    bars(sec, 4, (b, i) => {
      const root = roots[i % 4];
      add(bass, root - 12, b, 1.5, 0.76); add(bass, root - 5, b + 2.5, 0.6, 0.58); add(bass, root - 12, b + 3.5, 0.3, 0.5);
      for (const j of [1.5, 3.5]) add(organ, chordPitches(root + 12, 'min7'), b + j, 0.2, 0.65);
      if (i % 2 === 1) { add(bell, root + 24, b + 0.75, 0.3, 0.6); add(bell, root + 24, b + 1.5, 0.3, 0.3); add(bell, root + 31, b + 2.25, 0.3, 0.2); }
      if (sec.id !== 'opening' && sec.id !== 'bridge') { add(kick, 36, b, 0.15, 0.85); add(kick, 36, b + 2.75, 0.15, 0.55); add(snare, 38, b + 2, 0.15, 0.75); for (let j = 0; j < 8; j++) add(hat, 42, b + j / 2, 0.1, j % 2 ? 0.4 : 0.65); }
    });
    const voice = sec.id === 'bridge' ? voices[2] : sec.id === 'return' ? voices[1] : voices[0];
    for (let b = sec.beat + 2; b + 4 <= sec.beat + sec.beats; b += 16) add(voice, 57, b, 4, 0.8);
  }
  ending(s, bass, organ, 'D3', 'min7'); return s;
}

function kosmische(seed, scale) {
  const s = score('copper-satellites', 'Copper Satellites', 'An interlocking step sequence orbits a held fifth. Filters brighten, the upper sequence inverts, and a slow melody finds a landing beyond the motor pulse.', 'Kosmische', 'Propulsive, weightless', 'E minor', 108, [['opening', 'Orbit', 8], ['rise', 'Copper light', 12], ['drift', 'Far side', 8], ['return', 'Reentry', 8], ['ending', 'Landing', 4]], seed, scale, 4, 0.33);
  const seq = part(s, 'copper', 'Copper sequence', 'pluck', 0.6, -0.45, { brightness: 2500, release: 0.2 }), upper = part(s, 'satellite', 'Upper sequence', 'bell', 0.5, 0.45, { release: 0.8 }), melody = part(s, 'signal', 'Slow analog signal', 'analog-lead', 0.45, 0.1, { attack: 0.18, release: 0.8, brightness: 2200 }), pad = part(s, 'space', 'Held fifths', 'pad', 0.65), bass = part(s, 'engine', 'Motor bass', 'bass', 0.5), kick = part(s, 'motor', 'Motor kick', 'kick', 0.6), hat = part(s, 'dust', 'Motor hats', 'hi-hat', 0.45, 0.3);
  const a = pattern(4, arpeggiate([64, 71, 74, 67], { step: 0.5, order: [0, 1, 2, 1, 3, 1, 2, 3], velocity: 0.65 }));
  const b = motif([83, 79, 78, 74, 76], [0.25, 1.75, 3.25, 5, 6.5], [0.4, 0.45, 0.4, 0.5, 0.5]);
  for (const [si, sec] of s.sections.slice(0, -1).entries()) {
    playMotif(seq, si === 2 ? 'night-orbit' : 'orbit', si === 2 ? transformPattern(a, { transpose: -5 }) : a, sec);
    if (si > 0) playMotif(upper, si === 3 ? 'inversion' : 'satellite', si === 3 ? transformPattern(b, { invertAround: 79 }) : b, sec);
    bars(sec, 4, (beat, i) => {
      const root = [52, 55, 50, 57][Math.floor(i / 4) % 4];
      if (i % 4 === 0) { add(pad, [root, root + 7, root + 14], beat, Math.min(15, sec.beat + sec.beats - beat), 0.5); if (si > 0) add(melody, [76, 79, 78, 74][(i / 4 + si) % 4], beat + 1, Math.min(10, sec.beat + sec.beats - beat - 1), 0.5); }
      for (let j = 0; j < 4; j++) { add(bass, root - 12, beat + j, 0.55, 0.6); if (si !== 2) { add(kick, 36, beat + j, 0.15, 0.65); add(hat, 42, beat + j + 0.5, 0.1, 0.5); } }
    });
  }
  ending(s, bass, pad, 'E3', 'minor'); add(melody, 76, s.sections.at(-1).beat, 4, 0.4); return s;
}

function chamber(seed, scale) {
  const s = score('wood-and-lantern', 'Wood and Lantern', 'A three-beat mallet conversation moves from a single wooden line to bell counterpoint and soft synthetic strings, ending in a delicate unison.', 'Chamber mallets', 'Curious, graceful', 'Bb major', 96, [['opening', 'One lantern', 8], ['reply', 'Two voices', 12], ['middle', 'Turning steps', 8], ['return', 'Lantern garden', 8], ['ending', 'Stillness', 4]], seed, scale, 3, 0.3);
  const wood = part(s, 'wood', 'Marimba lead', 'marimba', 0.95, -0.3), bell = part(s, 'lantern', 'Bell counterpoint', 'bell', 0.65, 0.4, { release: 1.5 }), strings = part(s, 'threads', 'Soft strings', 'strings', 0.55, 0.05), low = part(s, 'floor', 'Low mallets', 'marimba', 0.7, -0.1);
  const a = motif([70, 74, 77, 75, 72, 74, 70], [0, 0.75, 1.5, 2.5, 3.5, 4.5, 5.25], [0.6, 0.5, 0.7, 0.4, 0.65, 0.5, 0.6], 6);
  const b = motif([82, 81, 79, 77], [0.5, 2, 3.75, 5], [0.65, 0.8, 0.7, 0.85], 6, 0.6);
  const chords = [['Bb2', 'major'], ['G3', 'minor'], ['Eb3', 'maj7'], ['F3', 'sus4']];
  for (const sec of s.sections.slice(0, -1)) {
    playMotif(wood, sec.id === 'middle' ? 'turning' : 'wood', sec.id === 'middle' ? transformPattern(a, { reverse: true, transpose: 12, velocity: 0.75 }) : a, sec);
    if (sec.id !== 'opening') playMotif(bell, 'lantern', b, sec);
    bars(sec, 3, (beat, i) => {
      const pitches = chordPitches(...chords[Math.floor(i / 2) % 4]); add(low, pitches[0], beat, 0.8, 0.55); add(low, pitches[1], beat + 1.5, 0.5, 0.4);
      if (sec.id === 'return' || sec.id === 'middle') add(strings, pitches, beat, 2.6, 0.45);
    });
  }
  ending(s, null, strings, 'Bb3', 'major', 3); add(wood, [70, 74], s.sections.at(-1).beat, 0.9, 0.5); add(bell, 82, s.sections.at(-1).beat + 1.5, 0.9, 0.4); return s;
}

function speech(seed, scale) {
  const s = score('made-of-moments', 'Made of Moments', 'Spoken light, rhythmic syllable chops and a filter-bank vocoder trade phrases over a shifting electronic groove. These are playful speech textures, not natural singing.', 'Speech electronica', 'Playful, luminous', 'C minor', 120, [['opening', 'A spark', 4], ['groove', 'In motion', 12], ['reply', 'Let it change', 12], ['bridge', 'Weightless words', 8], ['return', 'Together', 8], ['ending', 'A moment', 4]], seed, scale, 4, 0.25);
  const keys = part(s, 'light', 'Electric-piano motif', 'electric-piano', 0.73, -0.25), pad = part(s, 'halo', 'Pad halo', 'pad', 0.6, 0.25), bass = part(s, 'motion', 'Acid motion', 'acid-bass', 0.52, 0, { brightness: 1300, release: 0.25 }), kick = part(s, 'pulse', 'Kick', 'kick', 0.66), clap = part(s, 'hands', 'Clap', 'clap', 0.6), hat = part(s, 'glitter', 'Hats', 'hi-hat', 0.6, 0.3);
  const spoken = part(s, 'spoken-light', 'Spoken light', 'sample', 0.38, -0.15); spoken.sample = { asset: 'builtin:made-of-light', effect: 'dry' };
  const chops = part(s, 'syllables', 'Rhythmic syllables', 'sample', 0.3, 0.3); chops.sample = { asset: 'builtin:in-the-rhythm', effect: 'chop', pattern: [0, null, 2, 1, 3, null, 1, 2], semitones: 2 };
  const vocoder = part(s, 'change', 'Vocoder phrase', 'sample', 0.38, -0.1); vocoder.sample = { asset: 'builtin:let-it-change', effect: 'vocoder', pitch: 'G3' };
  const a = motif([72, 75, 79, 77, 74, 75], [0, 1.5, 2.5, 4.25, 5.5, 7], [0.7, 0.5, 0.8, 0.5, 0.7, 0.5]);
  const chords = [['C3', 'min7'], ['Ab2', 'maj7'], ['Eb3', 'maj7'], ['Bb2', 'sus2']];
  for (const sec of s.sections.slice(0, -1)) {
    playMotif(keys, sec.id === 'bridge' ? 'float' : 'light', sec.id === 'bridge' ? transformPattern(a, { reverse: true, velocity: 0.7 }) : a, sec);
    bars(sec, 4, (b, i) => {
      const pitches = chordPitches(...chords[i % 4]); add(pad, pitches, b, 3.5, 0.5);
      if (sec.id !== 'bridge' && sec.id !== 'opening') {
        for (const j of [0, 1.5, 2.5, 3.25]) add(bass, pitches[0] - 12 + (j === 3.25 ? 12 : 0), b + j, 0.3, 0.65);
        for (const j of [0, 2, 3.5]) add(kick, 36, b + j, 0.15, 0.75); for (const j of [1, 3]) add(clap, 39, b + j, 0.15, 0.7); for (let j = 0; j < 8; j++) add(hat, 42, b + j / 2, 0.1, j % 2 ? 0.48 : 0.6);
      }
      if (i % 4 === 0 && sec.beat + sec.beats - b >= 4) {
        const voice = sec.id === 'opening' || sec.id === 'bridge' ? spoken : sec.id === 'reply' || sec.id === 'return' ? vocoder : chops;
        add(voice, 55, b, 4, 0.78);
        if (sec.id === 'return' && i % 8 === 4) add(chops, 55, b + 4, 4, 0.55);
      }
    });
  }
  ending(s, bass, pad, 'C3', 'min7'); add(keys, [72, 75, 79], s.sections.at(-1).beat + 1, 3, 0.4); return s;
}

/** A clearly labeled built-in demonstration, never personalized user music. */
export function buildExampleCollection({ seed = 1, durationScale = 1 } = {}) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new TypeError('seed must be a uint32 integer.');
  if (!Number.isFinite(durationScale) || durationScale <= 0 || durationScale > 4) throw new TypeError('durationScale must be greater than 0 and at most 4.');
  const tracks = [house, downtempo, ambient, synthwave, piano, broken, dub, kosmische, chamber, speech].map(build => build(seed, durationScale));
  // Every record in the collection has its own original sleeve composition.
  const sleeves = ['sun', 'strata', 'ripple', 'window', 'monolith', 'constellation', 'wave', 'orbit', 'petal', 'weave'];
  const palettes = [
    ['#35302b', '#ddbb86', '#f1ede1'], ['#1f1b4d', '#f67553', '#f5cf89'],
    ['#082b28', '#84d5af', '#d7f29a'], ['#eddccb', '#dc5436', '#272321'],
    ['#412116', '#ea9378', '#eec89c'], ['#f0d832', '#253734', '#fff5c5'],
    ['#152d69', '#97cbff', '#f6e6b3'], ['#102e35', '#b6e0c5', '#f1f0d7'],
    ['#2e1d36', '#e57bae', '#ffd5b6'], ['#161826', '#98a6ee', '#e7e0fe'],
  ];
  const levels = [0.95, 1.15, 2, 1.45, 1.8, 0.9, 1, 1.25, 2, 1.15];
  tracks.forEach((track, i) => {
    track.artwork = { style: sleeves[i], colors: palettes[i], seed };
    track.master.volume = levels[i];
  });
  // Very short previews retain the form, but truncate the final gestures to the
  // smaller timeline. Full-size compositions keep their original note lengths.
  for (const track of tracks) for (const p of track.parts) {
    p.notes = p.notes.filter(n => n.beat < track.beats).map(n => ({ ...n, duration: Math.min(n.duration, track.beats - n.beat) }));
  }
  return { collection: { version: 1, id: 'soundroo-examples', title: 'The Open Window', description: 'Ten softer example tracks that come with Soundroo. Ask your AI agent for music of your own.', source: 'examples', seed, tracks: tracks.map(t => t.id) }, tracks };
}
export default buildExampleCollection;
