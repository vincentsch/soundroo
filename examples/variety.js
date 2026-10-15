import { note, pattern, transformPattern, arrangePattern, makeSections } from '../src/compose.js';

// "Turn It Up": ten original example pieces with band energy, pop hooks and
// two focused grooves. Every riff, hook and groove below is written for this
// collection. The seed only changes performance detail (velocity feel, drum
// noise and sleeves); it never swaps the composed material.

function hash(...values) {
  let h = 2166136261 >>> 0;
  for (const value of values) for (const c of `${value}\u0000`) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const round = x => Math.round(x * 10000) / 10000;
const level = v => Math.min(1, Math.max(0.05, Math.round(v * 1000) / 1000));
const pitchOf = p => (typeof p === 'number' ? p : note(p).pitch);
const T = 1 / 3; // triplet eighth, used by the shuffles

/** Start a score; returns the score plus small performance helpers bound to it. */
function begin(seed, meta, form) {
  const sections = makeSections(form);
  const s = {
    version: 1, id: meta.id, title: meta.title, description: meta.description, genre: meta.genre, mood: meta.mood, key: meta.key, bpm: meta.bpm,
    beats: sections.at(-1).beat + sections.at(-1).beats, seed: hash(seed, meta.id),
    master: { volume: meta.volume, reverb: meta.reverb }, artwork: { style: meta.sleeve, colors: meta.colors, seed }, sections, parts: [],
  };
  const rand = random(hash(seed, meta.id, 'performance'));
  const at = Object.fromEntries(sections.map(section => [section.id, section]));
  const part = (id, name, instrument, volume, pan = 0, tone) => {
    const p = { id, name, instrument, volume, pan, color: meta.inks[s.parts.length % meta.inks.length], notes: [] };
    if (tone) p.tone = tone;
    s.parts.push(p);
    return p;
  };
  const human = (v, spread = 0.05) => level(v + (rand() * 2 - 1) * spread);
  // Strum offsets are written in milliseconds so a downstroke feels alike at any tempo.
  const strum = (p, pitches, beat, duration, velocity, { up = false, ms = 9 } = {}) => {
    const list = [pitches].flat().map(pitchOf);
    (up ? [...list].reverse() : list).forEach((pitch, i) => hit(p, pitch, beat + i * ms / 1000 * s.bpm / 60, duration, velocity * (up ? 0.85 : 1) * (1 - i * 0.03)));
  };
  return { s, at, part, human, strum, bar: (section, i) => section.beat + i * 4 };
}

/** Add a note or a stack of notes (double-stops, chords). */
function hit(p, pitches, beat, duration, velocity) {
  for (const pitch of [pitches].flat()) p.notes.push({ pitch: pitchOf(pitch), beat: round(beat), duration: round(duration), velocity: level(velocity) });
}
/** A named motif; rows are [pitch or [pitches], beat, duration, velocity]. */
function riff(beats, rows) {
  return pattern(beats, rows.flatMap(([p, b, d, v]) => [p].flat().map(x => note(x, round(b), round(d), v))));
}
function play(p, name, motif, beat, { repeat = 1, transpose = 0, velocity = 1 } = {}) {
  arrangePattern(p, name, motif, { beat: round(beat), repeat, transpose, velocity });
}
/** An even roll with a velocity ramp, for builds and drum fills. */
function roll(p, pitch, from, to, step, v0, v1, duration = 0.12) {
  const count = Math.round((to - from) / step);
  for (let i = 0; i < count; i++) hit(p, pitch, from + i * step, Math.min(duration, step), v0 + (v1 - v0) * i / Math.max(1, count - 1));
}
const power = (root, octave = true) => (octave ? [root, root + 7, root + 12] : [root, root + 7]);
const swing8 = (e, ratio = 2 / 3) => Math.floor(e / 2) + (e % 2 ? ratio : 0);

// 1 ─ Rock-and-roll boogie ──────────────────────────────────────────────────
function hotwireBoogie(seed) {
  const { s, at, part, human, strum, bar } = begin(seed, {
    id: 'hotwire-boogie', title: 'Hotwire Boogie', genre: 'Rock and roll boogie', mood: 'Rowdy, swinging, grinning', key: 'A major blues, final chorus in B', bpm: 168,
    description: 'A shuffling rock-and-roll opener: an unaccompanied chromatic guitar riff, double-stop shouts, walking boogie bass and a hard 2-and-4 backbeat. Stop-time breaks feed a burning solo, the last chorus jumps up a whole step, and the band slams a bVI–bVII–I ending.',
    volume: 0.63, reverb: 0.1, sleeve: 'sun', colors: ['#b3202a', '#f6e7c8', '#141414'], inks: ['#f6e7c8', '#ff6b4a', '#ffd23f', '#9ad0ec', '#c2f970'],
  }, [
    ['intro', 'Ignition riff', 4], ['verse', 'Main street', 12], ['build', 'Red light', 4], ['chorus', 'Hotwire', 12],
    ['verse-two', 'Second gear', 12], ['stop-time', 'Stop time', 8], ['solo', 'Burnout solo', 12], ['final', 'Floor it', 12], ['ending', 'Last call', 5],
  ]);
  const lead = part('lead', 'Lead guitar', 'guitar-crunch', 1.6, 0.08, { drive: 0.3, palmMute: 0.05, brightness: 5200, release: 0.9 });
  const left = part('boogie-left', 'Boogie guitar left', 'guitar-crunch', 0.8, -0.62, { drive: 0.55, palmMute: 0.55, brightness: 3800, release: 0.5 });
  const right = part('boogie-right', 'Boogie guitar right', 'guitar-crunch', 0.76, 0.62, { drive: 0.65, palmMute: 0.45, brightness: 4300, release: 0.5 });
  const bass = part('bass', 'Walking bass', 'electric-bass', 0.85, 0, { brightness: 2000, palmMute: 0.3, release: 0.6 });
  const piano = part('piano', 'Barrelhouse piano', 'piano', 0.45, -0.28, { brightness: 4200, release: 0.3 });
  const kick = part('kick', 'Kick', 'rock-kick', 0.6);
  const snare = part('snare', 'Snare', 'rock-snare', 0.8, 0.04);
  const hat = part('hat', 'Hi-hat', 'hi-hat', 1.9, -0.3);
  const ride = part('ride', 'Ride', 'ride', 0.92, 0.32);
  const crash = part('crash', 'Crash', 'crash', 0.76, -0.18);
  const toms = part('toms', 'Toms', 'tom', 0.6, 0.12);

  const hotwire = riff(8, [
    ['G4', 0, 0.28, 0.8], ['G#4', T, 0.28, 0.76], ['A4', 2 * T, 0.8, 0.95],
    ['E4', 5 * T, 0.28, 0.74], ['G4', 2, 0.28, 0.82], ['A4', 7 * T, 0.28, 0.78], ['C5', 8 * T, 0.5, 0.92], ['A4', 10 * T, 0.55, 0.8],
    [['C#5', 'E5'], 4, 0.3, 0.95], [['C#5', 'E5'], 14 * T, 0.28, 0.78], [['C#5', 'E5'], 5, 0.3, 0.86],
    [['B4', 'D5'], 17 * T, 0.3, 0.82], [['A4', 'C#5'], 6, 1.4, 0.92],
  ]);
  const head = riff(4, hotwire.notes.filter(n => n.beat < 4).map(n => [n.pitch, n.beat, n.duration, n.velocity]));
  const tune = riff(8, [
    ['E4', 0, 0.42, 0.86], ['E4', 2 * T, 0.26, 0.7], ['C#4', 1, 0.42, 0.8], ['E4', 5 * T, 0.28, 0.74],
    ['F#4', 2, 0.6, 0.88], ['E4', 8 * T, 0.28, 0.7], ['C#4', 3, 0.55, 0.78],
    ['A3', 4, 0.95, 0.86], ['C4', 16 * T, 0.26, 0.66], ['C#4', 17 * T, 1, 0.8],
  ]);
  const answer = riff(8, [
    ['B4', 0, 0.42, 0.88], ['B4', 2 * T, 0.26, 0.72], ['G#4', 1, 0.5, 0.8], ['E4', 2, 0.42, 0.78], ['D4', 8 * T, 0.28, 0.7], ['E4', 3, 0.6, 0.8],
    ['A4', 4, 0.42, 0.86], ['F#4', 14 * T, 0.28, 0.72], ['D4', 5, 0.5, 0.78], ['C4', 6, 0.28, 0.7], ['C#4', 19 * T, 1.2, 0.8],
  ]);
  const turnaround = riff(8, [
    ['A4', 0, 0.42, 0.86], ['G4', 2 * T, 0.26, 0.74], ['F#4', 1, 0.42, 0.78], ['F4', 5 * T, 0.26, 0.72], ['E4', 2, 0.6, 0.82], ['C#4', 8 * T, 0.26, 0.7], ['A3', 3, 0.55, 0.78],
    ['E4', 4, 0.42, 0.88], ['D4', 14 * T, 0.26, 0.72], ['B3', 5, 0.42, 0.78], ['G#3', 17 * T, 0.26, 0.72], ['E3', 6, 0.9, 0.84],
  ]);
  const shout = riff(8, [
    [['G#4', 'B4'], 0, 0.3, 0.95], [['G#4', 'B4'], 2 * T, 0.26, 0.78], [['G#4', 'B4'], 1, 0.3, 0.88], [['A4', 'C#5'], 5 * T, 0.3, 0.84], [['G#4', 'B4'], 2, 0.9, 0.9], ['E4', 10 * T, 0.5, 0.78],
    [['F#4', 'A4'], 4, 0.3, 0.92], [['F#4', 'A4'], 14 * T, 0.26, 0.76], [['F#4', 'A4'], 5, 0.3, 0.86], [['E4', 'G4'], 17 * T, 0.3, 0.8], [['D4', 'F#4'], 6, 1.2, 0.88],
  ]);

  // Twelve-bar blues as semitone offsets from the tonic: I I I I IV IV I I V IV I V.
  const blues = [0, 0, 0, 0, 5, 5, 0, 0, 7, 5, 0, 7];
  const guitarRoot = o => (o === 7 ? 40 : 45 + o);
  const bassRoot = o => (o === 7 ? 28 : 33 + o);
  function boogie(p, b, o, key, velocity = 1) {
    const r = guitarRoot(o) + key;
    [7, 9, 10, 9].forEach((interval, j) => {
      strum(p, [r, r + interval], b + j, 0.42, human(0.9 * velocity), { ms: 6 });
      strum(p, [r, r + interval], b + j + 2 * T, 0.26, human(0.68 * velocity), { ms: 5, up: true });
    });
  }
  function walk(b, o, key, velocity = 1) {
    const r = bassRoot(o) + key;
    [0, 4, 7, 9, 10, 9, 7, 4].forEach((interval, e) => hit(bass, r + interval, b + swing8(e), e % 2 ? 0.28 : 0.5, human((e % 2 ? 0.72 : 0.9) * velocity)));
  }
  function pianoStabs(b, o, key) {
    const shape = { 0: ['A4', 'C#5', 'E5'], 5: ['A4', 'D5', 'F#5'], 7: ['G#4', 'B4', 'E5'] }[o].map(p => pitchOf(p) + key);
    hit(piano, shape, b, 0.4, human(0.7));
    for (const e of [1, 3, 5, 7]) hit(piano, shape, b + swing8(e), 0.22, human(0.55));
  }
  function shuffleDrums(b, { cymbal = hat, fill = null, crashIt = false, push = false } = {}) {
    for (let e = 0; e < 8; e++) hit(cymbal, cymbal === ride ? 51 : 42, b + swing8(e), 0.2, human(e % 2 ? 0.38 : 0.62, 0.06));
    if (cymbal === ride) for (const j of [1, 3]) hit(hat, 42, b + j, 0.1, human(0.32));
    hit(kick, 36, b, 0.25, human(0.95));
    hit(kick, 36, b + 2, 0.25, human(0.88));
    if (push) hit(kick, 36, b + 8 * T, 0.25, human(0.7));
    if (crashIt) hit(crash, 49, b, 1, human(0.9));
    if (fill === 'triplets') {
      hit(snare, 38, b + 1, 0.2, human(0.95));
      [38, 38, 38, 48, 45, 41].forEach((pitch, i) => hit(pitch === 38 ? snare : toms, pitch, b + 2 + i * T, 0.2, human(0.62 + i * 0.06)));
    } else if (fill === 'toms') {
      hit(snare, 38, b + 1, 0.2, human(0.95));
      [[2, 50], [2 + T, 50], [2 + 2 * T, 47], [3, 45], [3 + T, 43], [3 + 2 * T, 41]].forEach(([t, pitch], i) => hit(toms, pitch, b + t, 0.2, human(0.7 + i * 0.04)));
    } else {
      for (const j of [1, 3]) hit(snare, 38, b + j, 0.2, human(0.96, 0.03));
      if (fill === 'pickup') hit(snare, 38, b + 3 + 2 * T, 0.12, human(0.45));
    }
  }

  // Intro: the riff alone, then the band crashes in on the repeat.
  const intro = at.intro;
  play(lead, 'hotwire', hotwire, intro.beat);
  play(lead, 'hotwire', hotwire, bar(intro, 2));
  for (let i = 2; i < 4; i++) {
    const o = i === 3 ? 7 : 0;
    boogie(left, bar(intro, i), o, 0); boogie(right, bar(intro, i), o, 0); walk(bar(intro, i), o, 0);
    shuffleDrums(bar(intro, i), { crashIt: i === 2, fill: i === 3 ? 'triplets' : null });
  }

  function twelveBar(section, key, { leadPlan, both = true, pianoOn = false, cymbal = hat, crashBars = [0] }) {
    blues.forEach((o, i) => {
      const b = bar(section, i);
      boogie(left, b, o, key);
      if (both) boogie(right, b, o, key, 0.95);
      walk(b, o, key);
      if (pianoOn) pianoStabs(b, o, key);
      shuffleDrums(b, { cymbal, crashIt: crashBars.includes(i), push: i % 2 === 1, fill: i === 11 ? 'toms' : i % 4 === 3 ? 'pickup' : null });
    });
    leadPlan(section, key);
  }
  const verseLead = (lift = 0) => (section, key) => {
    play(lead, lift ? 'tune-high' : 'tune', lift ? transformPattern(tune, { transpose: 12 }) : tune, section.beat, { transpose: key });
    play(lead, lift ? 'head-high' : 'head', lift ? transformPattern(head, { transpose: 12 }) : head, bar(section, 3), { transpose: key });
    play(lead, lift ? 'tune-high' : 'tune', lift ? transformPattern(tune, { transpose: 12 }) : tune, bar(section, 4), { transpose: key + 5 });
    play(lead, lift ? 'head-high' : 'head', lift ? transformPattern(head, { transpose: 12 }) : head, bar(section, 7), { transpose: key });
    play(lead, lift ? 'answer-high' : 'answer', lift ? transformPattern(answer, { transpose: 12 }) : answer, bar(section, 8), { transpose: key });
    play(lead, 'turnaround', turnaround, bar(section, 10), { transpose: key });
  };
  const chorusLead = (section, key) => {
    play(lead, 'hotwire', hotwire, section.beat, { repeat: 2, transpose: key });
    play(lead, 'hotwire', hotwire, bar(section, 4), { transpose: key + 5 });
    play(lead, 'hotwire', hotwire, bar(section, 6), { transpose: key });
    play(lead, 'shout', shout, bar(section, 8), { transpose: key });
    play(lead, 'turnaround-high', transformPattern(turnaround, { transpose: 12 }), bar(section, 10), { transpose: key });
  };

  twelveBar(at.verse, 0, { leadPlan: verseLead(0), both: false });
  // Build: stop hits on the dominant, a climbing lead and a snare that tightens into the chorus.
  const build = at.build;
  for (let i = 0; i < 4; i++) {
    const b = bar(build, i), hits = i < 2 ? [0, 5 * T] : i === 2 ? [0, 1, 2, 3] : [0, T, 2 * T];
    for (const h of hits) {
      strum(left, power(40), b + h, 0.45, human(0.95)); strum(right, power(40), b + h + 0.02, 0.45, human(0.92));
      hit(bass, 28, b + h, 0.45, human(0.92)); hit(kick, 36, b + h, 0.25, human(0.92));
    }
    if (i < 3) for (let j = 0; j < 4; j++) hit(snare, 38, b + j, 0.15, 0.42 + i * 0.12 + j * 0.03);
  }
  roll(snare, 38, bar(build, 3) + 1, bar(build, 3) + 4, T / 2, 0.45, 1, 0.08);
  play(lead, 'climb', riff(16, [
    ['B4', 2 * T, 0.3, 0.8], ['D5', 1, 0.3, 0.84], ['E5', 5 * T, 1.6, 0.9],
    ['B4', 4 + 2 * T, 0.3, 0.8], ['D5', 5, 0.3, 0.84], ['G5', 5 + 2 * T, 1.6, 0.92],
    ['G#5', 8, 0.5, 0.92], ['G#5', 9, 0.5, 0.88], ['G#5', 10, 0.5, 0.9], ['G#5', 11, 0.5, 0.92],
    ['E5', 12, 0.3, 0.9], ['G5', 12 + T, 0.3, 0.86], ['G#5', 12 + 2 * T, 0.9, 0.95],
  ]), build.beat);
  hit(crash, 49, bar(build, 2), 1, 0.8);

  twelveBar(at.chorus, 0, { leadPlan: chorusLead, cymbal: ride, crashBars: [0, 4, 8] });
  twelveBar(at['verse-two'], 0, { leadPlan: verseLead(12), pianoOn: true, crashBars: [0] });

  // Stop time: the band hits once a bar and the guitar answers in the gaps.
  const stop = at['stop-time'], stopChords = [0, 0, 5, 5, 0, 0, 7, 7];
  const lickA = riff(4, [['C5', 2 * T, 0.26, 0.82], ['C#5', 1, 0.42, 0.88], ['A4', 5 * T, 0.26, 0.74], ['E4', 2, 0.42, 0.78], ['G4', 8 * T, 0.26, 0.72], ['A4', 3, 0.6, 0.84]]);
  const lickB = riff(4, [['E5', 2 * T, 0.26, 0.84], ['E5', 1, 0.26, 0.8], ['C5', 4 * T, 0.26, 0.76], ['C#5', 5 * T, 0.26, 0.8], ['A4', 2, 0.42, 0.8], ['G4', 8 * T, 0.26, 0.7], ['E4', 3, 0.6, 0.78]]);
  const lickE = riff(4, [['E5', 2 * T, 0.3, 0.85], ['G5', 1, 0.3, 0.88], ['G#5', 4 * T, 0.6, 0.92], ['E5', 2, 0.26, 0.8], ['D5', 7 * T, 0.26, 0.78], ['B4', 8 * T, 0.26, 0.76], ['G#4', 3, 0.6, 0.8]]);
  const runUp = riff(4, [['E4', 2 * T, 0.24, 0.78], ['G#4', 1, 0.24, 0.8], ['B4', 4 * T, 0.24, 0.82], ['D5', 5 * T, 0.24, 0.84], ['E5', 2, 0.24, 0.86], ['G#5', 7 * T, 0.24, 0.88], ['B5', 8 * T, 1.2, 0.95]]);
  stopChords.forEach((o, i) => {
    const b = bar(stop, i), hits = i < 4 ? [0] : [0, 5 * T];
    for (const h of hits) {
      strum(left, power(guitarRoot(o)), b + h, 0.6, human(0.95)); strum(right, power(guitarRoot(o)), b + h + 0.02, 0.6, human(0.92));
      hit(bass, bassRoot(o), b + h, 0.6, human(0.92)); hit(kick, 36, b + h, 0.25, human(0.95));
    }
    if (i === 0 || i === 4) hit(crash, 49, b, 1, human(0.85));
    if (i < 6) for (const j of [1, 3]) hit(hat, 42, b + j, 0.1, human(0.45));
  });
  [['lick-a', lickA, 0], ['lick-b', lickB, 0], ['lick-a', lickA, 5], ['lick-b', lickB, 5], ['lick-a', lickA, 0], ['lick-b', lickB, 0], ['lick-e', lickE, 0], ['run-up', runUp, 0]]
    .forEach(([name, lick, transpose], i) => play(lead, name, lick, bar(stop, i), { transpose }));
  roll(snare, 38, bar(stop, 6) + 1, bar(stop, 7) + 2, T, 0.35, 0.85, 0.1);
  [[2, 50], [2 + T, 48], [2 + 2 * T, 47], [3, 45], [3 + T, 43], [3 + 2 * T, 41]].forEach(([t, pitch], i) => hit(toms, pitch, bar(stop, 7) + t, 0.2, 0.75 + i * 0.04));

  // Solo: triplet rolls, a shriek, pounding double-stops and a high turnaround.
  const burn = riff(8, [
    ...Array.from({ length: 12 }, (_, i) => [['E5', 'G5', 'A5'][i % 3], i * T, 0.3, i % 3 === 2 ? 0.88 : 0.74]),
    ['C6', 4, 0.6, 0.95], ['A5', 14 * T, 0.26, 0.8], ['C6', 5, 0.6, 0.92], ['A5', 17 * T, 0.26, 0.78], ['G5', 6, 0.26, 0.8], ['E5', 19 * T, 0.26, 0.76], ['C5', 20 * T, 0.26, 0.74], ['C#5', 7, 0.8, 0.86],
  ]);
  const tumble = riff(8, [
    ...['C6', 'A5', 'G5', 'E5', 'D5', 'C5', 'A4', 'G4', 'E4'].map((p, i) => [p, i * T, 0.28, 0.9 - i * 0.02]),
    ['G4', 3, 0.26, 0.74], ['A4', 3 + T, 0.26, 0.76], ['C5', 3 + 2 * T, 0.26, 0.8],
    ['C#5', 4, 0.9, 0.88], ['A4', 5, 0.42, 0.8], ['E5', 6, 0.42, 0.84], ['C#5', 7, 0.6, 0.8],
  ]);
  const pound = riff(8, [
    ...Array.from({ length: 8 }, (_, e) => [['F#5', 'A5'], swing8(e), e % 2 ? 0.24 : 0.36, e % 2 ? 0.76 : 0.92]),
    ...Array.from({ length: 6 }, (_, e) => [['D5', 'F#5'], 4 + swing8(e), e % 2 ? 0.24 : 0.36, e % 2 ? 0.74 : 0.9]),
    [['C5', 'E5'], 7, 0.9, 0.86],
  ]);
  const wail = riff(8, [
    ['G5', 0, 0.2, 0.8], ['G#5', 0.15, 1.3, 0.95], ['E5', 5 * T, 0.26, 0.8], ['G#5', 2, 0.26, 0.86], ['B5', 7 * T, 0.9, 0.92], ['G#5', 10 * T, 0.5, 0.82],
    ['A5', 4, 0.42, 0.9], ['F#5', 14 * T, 0.26, 0.8], ['D5', 5, 0.42, 0.82], ['C5', 17 * T, 0.26, 0.76], ['A4', 6, 0.42, 0.8], ['C5', 20 * T, 0.26, 0.76], ['C#5', 7, 0.8, 0.86],
  ]);
  twelveBar(at.solo, 0, {
    cymbal: ride, crashBars: [0, 4], leadPlan: section => {
      play(lead, 'burn', burn, section.beat); play(lead, 'tumble', tumble, bar(section, 2));
      play(lead, 'pound', pound, bar(section, 4)); play(lead, 'burn', burn, bar(section, 6));
      play(lead, 'wail', wail, bar(section, 8)); play(lead, 'turnaround-high', transformPattern(turnaround, { transpose: 12 }), bar(section, 10));
    },
  });
  twelveBar(at.final, 2, { leadPlan: chorusLead, cymbal: ride, pianoOn: true, crashBars: [0, 2, 4, 6, 8, 10] });

  // Ending in B: riff, bVI–bVII–I hits, a roll over the tonic and one last slam.
  const end = at.ending;
  play(lead, 'hotwire', hotwire, end.beat, { transpose: 2 });
  for (let i = 0; i < 2; i++) {
    boogie(left, bar(end, i), 0, 2); boogie(right, bar(end, i), 0, 2, 0.95); walk(bar(end, i), 0, 2);
    shuffleDrums(bar(end, i), { cymbal: ride, crashIt: i === 0 });
  }
  [[8, 43], [9, 45], [10, 47]].forEach(([t, root]) => {
    const b = end.beat + t, long = t === 10 ? 3.4 : 0.8;
    strum(left, power(root), b, long, 0.98); strum(right, power(root), b + 0.02, long, 0.95);
    hit(bass, root - 12, b, long, 0.9); hit(kick, 36, b, 0.25, 0.85); hit(crash, 49, b, 1, t === 10 ? 0.95 : 0.7);
    hit(piano, [root + 12, root + 16, root + 19], b, long, 0.62);
  });
  for (let i = 0; i < 10; i++) hit(lead, ['B4', 'D#5'], end.beat + 10 + i * T, 0.3, 0.92 - i * 0.03);
  roll(snare, 38, end.beat + 10, end.beat + 13.6, T / 2, 0.35, 0.95, 0.08);
  const last = end.beat + 14;
  strum(left, power(47), last, 3, 1); strum(right, power(47), last + 0.02, 3, 1);
  hit(bass, 35, last, 3, 0.88); hit(kick, 36, last, 0.3, 0.85); hit(crash, 49, last, 1, 0.95); hit(snare, 38, last, 0.2, 0.82);
  hit(lead, ['B4', 'F#5', 'B5'], last, 3.2, 1); hit(piano, ['B4', 'D#5', 'F#5', 'B5'], last, 3, 0.6);
  return s;
}

// 2 ─ Garage / pop-punk ─────────────────────────────────────────────────────
function rooftopRiot(seed) {
  const { s, at, part, human, strum, bar } = begin(seed, {
    id: 'rooftop-riot', title: 'Rooftop Riot', genre: 'Garage pop-punk', mood: 'Loud, sunny, reckless', key: 'E major', bpm: 172,
    description: 'Palm-muted garage chugs with E–G–A and E–D–A accents, a shout-along octave-guitar chorus over open power chords, a half-time bridge of clean arpeggios, and a skate-beat final chorus that ends with band stabs, a ringing B over a tom roll and one last E.',
    volume: 0.62, reverb: 0.1, sleeve: 'monolith', colors: ['#121212', '#ff3e8a', '#e8ff3b'], inks: ['#ff3e8a', '#e8ff3b', '#7af0ff', '#ffffff', '#ff9f1c'],
  }, [
    ['intro', 'Fuse', 4], ['verse', 'Stairwell', 8], ['pre', 'Fire escape', 4], ['chorus', 'Rooftop riot', 8], ['post', 'Skyline', 4],
    ['verse-two', 'Neighbours', 8], ['pre-two', 'Fire escape again', 4], ['chorus-two', 'Rooftop riot', 8], ['bridge', 'Half-time sunset', 8],
    ['final', 'Everyone up here', 12], ['ending', 'Last hits', 5],
  ]);
  const lead = part('lead', 'Octave lead guitar', 'guitar-crunch', 1.5, 0.05, { drive: 0.6, palmMute: 0.05, brightness: 5000, release: 0.7 });
  const chug = part('chug', 'Muted chugs', 'guitar-crunch', 0.8, -0.38, { drive: 0.8, palmMute: 0.8, brightness: 3600, release: 0.45 });
  const left = part('power-left', 'Power chords left', 'guitar-crunch', 0.78, -0.72, { drive: 0.75, palmMute: 0.12, brightness: 4200, release: 0.6 });
  const right = part('power-right', 'Power chords right', 'guitar-crunch', 0.74, 0.72, { drive: 0.85, palmMute: 0.12, brightness: 4700, release: 0.6 });
  const clean = part('clean', 'Clean arpeggios', 'guitar-clean', 0.8, 0.35, { brightness: 4000, release: 1.4, palmMute: 0.05 });
  const bass = part('bass', 'Pick bass', 'electric-bass', 0.88, 0, { brightness: 2600, palmMute: 0.35, release: 0.5 });
  const kick = part('kick', 'Kick', 'rock-kick', 0.62);
  const snare = part('snare', 'Snare', 'rock-snare', 0.82, 0.04);
  const hat = part('hat', 'Hi-hat', 'hi-hat', 1.9, -0.32);
  const open = part('open-hat', 'Open hat', 'open-hat', 1.2, -0.25);
  const crash = part('crash', 'Crash', 'crash', 0.8, 0.22);
  const toms = part('toms', 'Toms', 'tom', 0.62, -0.08);

  const P = { E: 40, G: 43, A: 45, B: 47, D: 50, 'F#': 42, 'C#': 49 };
  const BASS = { E: 28, G: 31, A: 33, B: 35, D: 38, 'F#': 30, 'C#': 37 };
  const octave = motif => pattern(motif.beats, motif.notes.flatMap(n => [n, { ...n, pitch: n.pitch - 12, velocity: level(n.velocity * 0.9) }]));
  const hook = octave(riff(8, [
    ['E5', 0, 0.42, 0.92], ['E5', 1, 0.42, 0.86], ['E5', 1.5, 0.42, 0.88], ['D#5', 2.5, 0.42, 0.84], ['C#5', 3.5, 0.42, 0.86],
    ['B4', 4, 1.4, 0.92], ['G#4', 6, 0.42, 0.8], ['B4', 7, 0.42, 0.84],
  ]));
  const hookLift = octave(riff(8, [
    ['F#5', 0, 0.42, 0.92], ['F#5', 1, 0.42, 0.86], ['F#5', 1.5, 0.42, 0.88], ['E5', 2.5, 0.42, 0.84], ['D#5', 3.5, 0.42, 0.86],
    ['C#5', 4, 1.4, 0.92], ['B4', 6, 0.42, 0.8], ['C#5', 7, 0.42, 0.84],
  ]));
  const resolve = octave(riff(8, [['D#5', 0, 0.42, 0.88], ['E5', 0.5, 0.42, 0.86], ['F#5', 1, 0.9, 0.92], ['E5', 2, 0.42, 0.84], ['D#5', 2.5, 0.42, 0.84], ['B4', 3, 2.6, 0.9]]));
  const resolveHome = octave(riff(8, [['D#5', 0, 0.42, 0.88], ['E5', 0.5, 0.42, 0.86], ['F#5', 1, 0.9, 0.92], ['E5', 2, 0.42, 0.84], ['D#5', 2.5, 0.42, 0.84], ['E5', 3, 2.6, 0.95]]));
  const verseLine = riff(8, [
    ['G#4', 0.5, 0.4, 0.8], ['B4', 1, 0.4, 0.82], ['B4', 1.5, 0.4, 0.8], ['A4', 2, 0.4, 0.78], ['G#4', 2.5, 0.4, 0.78], ['E4', 3, 0.9, 0.82],
    ['G#4', 4.5, 0.4, 0.8], ['B4', 5, 0.4, 0.82], ['D5', 5.5, 0.9, 0.86], ['B4', 6.5, 0.4, 0.78], ['A4', 7, 0.9, 0.8],
  ]);
  const preLine = riff(16, [
    ['C#5', 0, 1.4, 0.86], ['B4', 1.5, 0.45, 0.78], ['C#5', 2, 0.45, 0.8], ['E5', 2.5, 1.4, 0.88],
    ['E5', 4, 0.95, 0.86], ['D#5', 5, 0.45, 0.8], ['C#5', 5.5, 0.45, 0.8], ['B4', 6, 1.8, 0.84],
    ['B4', 8, 0.45, 0.8], ['C#5', 8.5, 0.45, 0.82], ['D#5', 9, 0.45, 0.84], ['E5', 9.5, 0.45, 0.86], ['F#5', 10, 1.9, 0.9],
    ['B4', 12, 0.45, 0.82], ['C#5', 12.5, 0.45, 0.85], ['D#5', 13, 1.6, 0.92],
  ]);
  const skyline = riff(16, [
    ['G#5', 0, 0.4, 0.9], ['F#5', 0.5, 0.4, 0.8], ['E5', 1, 0.4, 0.82], ['B4', 1.5, 0.4, 0.78], ['E5', 2, 0.4, 0.82], ['F#5', 2.5, 0.4, 0.82], ['G#5', 3, 0.9, 0.9],
    ['G#5', 4, 0.4, 0.88], ['F#5', 4.5, 0.4, 0.8], ['E5', 5, 0.4, 0.82], ['C#5', 5.5, 0.4, 0.78], ['E5', 6, 0.4, 0.82], ['F#5', 6.5, 0.4, 0.82], ['G#5', 7, 0.9, 0.9],
    ['A5', 8, 0.4, 0.9], ['G#5', 8.5, 0.4, 0.8], ['F#5', 9, 0.4, 0.82], ['E5', 9.5, 0.4, 0.78], ['C#5', 10, 0.4, 0.8], ['E5', 10.5, 0.4, 0.82], ['A5', 11, 0.9, 0.9],
    ['B5', 12, 0.9, 0.95], ['A5', 13, 0.4, 0.84], ['G#5', 13.5, 0.4, 0.84], ['F#5', 14, 0.9, 0.88], ['D#5', 15, 0.9, 0.86],
  ]);

  function eighths(p, root, b, { count = 8, length = 0.42, velocity = 1, from = 0 } = {}) {
    for (let e = from; e < from + count; e++) strum(p, power(root), b + e / 2, length, human((e % 2 ? 0.8 : 0.95) * velocity), { ms: 7 });
  }
  function bassEighths(root, b, { count = 8, from = 0, velocity = 1 } = {}) {
    for (let e = from; e < from + count; e++) hit(bass, root, b + e / 2, 0.42, human((e % 2 ? 0.78 : 0.92) * velocity));
  }
  function verseBar(b, second, both) {
    // Two-bar garage figure: muted E chugs answered by open G–A or D–A shots.
    const shots = second ? [['D', 2, 0.9], ['A', 3, 0.9]] : [['G', 3, 0.45], ['A', 3.5, 0.45]];
    for (let e = 0; e < (second ? 4 : 6); e++) strum(chug, power(40, false), b + e / 2, 0.3, human(e % 2 ? 0.72 : 0.9), { ms: 5 });
    for (const [chord, t, length] of shots) {
      const root = chord === 'D' ? P.D : P[chord];
      strum(left, power(root), b + t, length, human(0.95));
      if (both) strum(right, power(root), b + t + 0.015, length, human(0.92));
      for (let e = 0; e < length / 0.5; e++) hit(bass, BASS[chord], b + t + e / 2, 0.42, human(0.9));
    }
    for (let e = 0; e < (second ? 4 : 6); e++) hit(bass, 28, b + e / 2, 0.42, human(e % 2 ? 0.76 : 0.9));
  }
  function rockBeat(b, { cymbal = hat, kicks = [0, 2, 2.5], crashIt = false, fill = null, ghost = false } = {}) {
    for (let e = 0; e < 8; e++) hit(cymbal, cymbal === open ? 46 : 42, b + e / 2, 0.2, human(e % 2 ? 0.45 : 0.68, 0.06));
    for (const k of kicks) hit(kick, 36, b + k, 0.25, human(0.92));
    if (crashIt) hit(crash, 49, b, 1, human(0.95));
    if (fill === 'snare') {
      hit(snare, 38, b + 1, 0.2, human(0.97));
      roll(snare, 38, b + 2, b + 4, 0.25, 0.55, 1, 0.1);
    } else if (fill === 'toms') {
      hit(snare, 38, b + 1, 0.2, human(0.97));
      [[2, 38], [2.25, 38], [2.5, 50], [2.75, 50], [3, 47], [3.25, 45], [3.5, 43], [3.75, 41]].forEach(([t, pitch], i) => hit(pitch === 38 ? snare : toms, pitch, b + t, 0.2, 0.72 + i * 0.035));
    } else {
      for (const j of [1, 3]) hit(snare, 38, b + j, 0.2, human(0.97, 0.03));
      if (ghost) hit(snare, 38, b + 3.75, 0.1, human(0.3));
    }
  }
  function skateBeat(b, { crashIt = false, fill = null } = {}) {
    for (let j = 0; j < 4; j++) {
      if (fill && j >= 2) continue;
      hit(kick, 36, b + j, 0.25, human(0.9));
      hit(snare, 38, b + j + 0.5, 0.2, human(0.86));
      hit(open, 46, b + j, 0.2, human(0.55));
    }
    if (crashIt) hit(crash, 49, b, 1, human(0.95));
    if (fill) [[2, 50], [2.25, 50], [2.5, 47], [2.75, 47], [3, 45], [3.25, 43], [3.5, 41], [3.75, 41]].forEach(([t, pitch], i) => hit(toms, pitch, b + t, 0.2, 0.74 + i * 0.03));
  }
  function chorus(section, { skate = false, last = false } = {}) {
    const chords = ['A', 'E', 'B', 'C#', 'A', 'E', 'B', last ? 'E' : 'B'];
    chords.forEach((c, i) => {
      const b = bar(section, i), bassRoot = c === 'E' ? 28 : BASS[c];
      eighths(left, P[c], b); eighths(right, P[c], b + 0.012, { velocity: 0.95 });
      bassEighths(bassRoot, b);
      if (skate) skateBeat(b, { crashIt: i % 2 === 0, fill: i === 7 && !last ? 'toms' : null });
      else rockBeat(b, { cymbal: open, kicks: [0, 1.5, 2, 2.5], crashIt: i % 4 === 0, fill: i === 7 ? 'snare' : null, ghost: true });
    });
    play(lead, 'hook', hook, section.beat); play(lead, 'hook-lift', hookLift, bar(section, 2));
    play(lead, 'hook', hook, bar(section, 4)); play(lead, last ? 'resolve-home' : 'resolve', last ? resolveHome : resolve, bar(section, 6));
  }
  function pre(section) {
    const plan = [['F#', 30], ['A', 33], ['B', 35], ['B', 35]];
    plan.forEach(([c, low], i) => {
      const b = bar(section, i);
      if (i < 2) { strum(left, power(P[c]), b, 3.6, 0.95); strum(right, power(P[c]), b + 0.015, 3.6, 0.92); bassEighths(low, b); }
      else {
        eighths(left, P[c], b, { count: i === 3 ? 6 : 8, velocity: 0.8 + i * 0.05 }); eighths(right, P[c], b + 0.012, { count: i === 3 ? 6 : 8, velocity: 0.78 + i * 0.05 });
        bassEighths(low, b, { count: i === 3 ? 6 : 8 });
      }
      if (i < 2) { for (let j = 0; j < 4; j++) hit(toms, 41, b + j, 0.2, human(0.7)); for (const j of [1, 3]) hit(snare, 38, b + j, 0.2, human(0.9)); hit(kick, 36, b, 0.25, 0.9); hit(kick, 36, b + 2, 0.25, 0.85); }
      else if (i === 2) for (let j = 0; j < 4; j++) { hit(snare, 38, b + j, 0.2, 0.7 + j * 0.06); hit(kick, 36, b + j, 0.25, 0.88); }
      else { roll(snare, 38, b, b + 2, 0.5, 0.75, 0.85); roll(snare, 38, b + 2, b + 4, 0.25, 0.7, 1, 0.1); hit(kick, 36, b, 0.25, 0.9); hit(kick, 36, b + 1, 0.25, 0.9); hit(kick, 36, b + 2, 0.25, 0.9); }
    });
    hit(crash, 49, section.beat, 1, 0.7);
    play(lead, 'pre-line', preLine, section.beat);
  }

  // Intro: the chorus hook up front over the chorus chords, then straight into the chugs.
  const intro = at.intro;
  ['A', 'E', 'B', 'C#'].forEach((c, i) => {
    const b = bar(intro, i);
    eighths(left, P[c], b); eighths(right, P[c], b + 0.012, { velocity: 0.95 }); bassEighths(BASS[c], b);
    rockBeat(b, { cymbal: open, kicks: [0, 1.5, 2, 2.5], crashIt: i === 0, fill: i === 3 ? 'toms' : null });
  });
  play(lead, 'hook', hook, intro.beat); play(lead, 'hook-lift', hookLift, bar(intro, 2));

  for (const [id, both] of [['verse', false], ['verse-two', true]]) {
    const section = at[id];
    for (let i = 0; i < 8; i++) {
      const b = bar(section, i);
      verseBar(b, i % 2 === 1, both);
      rockBeat(b, { crashIt: i === 0, fill: i === 7 ? 'snare' : null, ghost: i % 2 === 1 });
    }
    play(lead, 'verse-line', verseLine, section.beat, { velocity: 0.95 });
    play(lead, 'verse-line', verseLine, bar(section, 4), { velocity: 0.95 });
    if (both) {
      // Second verse: a ringing clean counter-line on top of the chugs.
      for (let i = 0; i < 8; i++) {
        const b = bar(section, i), shape = i % 2 ? [50, 57, 62, 66] : [52, 59, 64, 68];
        [0, 1, 2, 3, 2, 1, 3, 2].forEach((k, e) => hit(clean, shape[k], b + e / 2, 0.9, human(e % 2 ? 0.55 : 0.68)));
      }
    }
  }
  pre(at.pre); chorus(at.chorus);
  const post = at.post;
  ['E', 'C#', 'A', 'B'].forEach((c, i) => {
    const b = bar(post, i);
    eighths(left, P[c], b); eighths(right, P[c], b + 0.012, { velocity: 0.95 }); bassEighths(c === 'E' ? 28 : BASS[c], b);
    skateBeat(b, { crashIt: i === 0, fill: i === 3 ? 'toms' : null });
  });
  play(lead, 'skyline', skyline, post.beat);
  pre(at['pre-two']); chorus(at['chorus-two']);

  // Bridge: half-time clean arpeggios, then a muted build that stops dead before the last chorus.
  const bridge = at.bridge;
  const shapes = { 'C#': [49, 56, 61, 64], A: [45, 52, 57, 61], E: [40, 47, 52, 56], B: [47, 54, 59, 63] };
  ['C#', 'A', 'E', 'B', 'C#', 'A', 'E', 'B'].forEach((c, i) => {
    const b = bar(bridge, i), root = c === 'E' ? 28 : BASS[c];
    if (i < 4) {
      [0, 1, 2, 3, 2, 1, 3, 2].forEach((k, e) => hit(clean, shapes[c][k] + 12, b + e / 2, 1.2, human(e % 2 ? 0.58 : 0.72)));
      hit(bass, root, b, 3.8, 0.88);
      hit(kick, 36, b, 0.25, 0.9); hit(snare, 38, b + 2, 0.2, 0.95); hit(toms, 43, b + 3, 0.2, 0.6); hit(toms, 41, b + 3.5, 0.2, 0.66);
      for (let j = 0; j < 4; j++) hit(hat, 42, b + j, 0.2, human(0.5));
    } else {
      const count = i === 7 ? 4 : 8;
      for (let e = 0; e < count; e++) strum(chug, power(P[c], false), b + e / 2, 0.3, 0.62 + (i - 4) * 0.1 + (e % 2 ? 0 : 0.06), { ms: 5 });
      bassEighths(root, b, { count, velocity: 0.8 + (i - 4) * 0.05 });
      if (i < 6) { for (let j = 0; j < 4; j++) { hit(kick, 36, b + j, 0.25, 0.85); hit(snare, 38, b + j + 0.5, 0.15, 0.4 + (i - 4) * 0.1 + j * 0.03); } }
      else if (i === 6) roll(snare, 38, b, b + 4, 0.25, 0.55, 0.85, 0.1);
      else { roll(snare, 38, b, b + 2, 0.125, 0.8, 1, 0.08); hit(crash, 49, b + 2, 0.5, 0.6); }
      if (i === 4) [[0, 'C#5'], [2, 'E5']].forEach(([t, p]) => hit(lead, p, b + t, 1.8, 0.82));
      if (i === 5) [[0, 'C#5'], [2, 'E5']].forEach(([t, p]) => hit(lead, p, b + t, 1.8, 0.86));
      if (i === 6) [[0, 'F#5'], [1, 'F#5'], [2, 'G#5'], [3, 'G#5']].forEach(([t, p]) => hit(lead, p, b + t, 0.9, 0.9));
      if (i === 7) hit(lead, 'B5', b, 1.9, 0.95);
    }
  });
  chorus({ ...at.final, beats: 32 }, { skate: true, last: true });
  const tag = bar(at.final, 8);
  ['E', 'C#', 'A', 'B'].forEach((c, i) => {
    const b = tag + i * 4;
    eighths(left, P[c], b); eighths(right, P[c], b + 0.012, { velocity: 0.95 }); bassEighths(c === 'E' ? 28 : BASS[c], b);
    skateBeat(b, { crashIt: true, fill: i === 3 ? 'toms' : null });
  });
  play(lead, 'skyline', skyline, tag);

  // Ending: the hook as band stabs, a B that rings over a tom roll, one last E.
  const end = at.ending;
  play(lead, 'hook', hook, end.beat);
  const stabs = [['A', 0, 0.42], ['A', 1, 0.42], ['A', 1.5, 0.42], ['A', 2.5, 0.42], ['A', 3.5, 0.42], ['E', 4, 1.4], ['E', 6, 0.42], ['E', 7, 0.42]];
  for (const [c, t, length] of stabs) {
    strum(left, power(P[c]), end.beat + t, length, 0.95); strum(right, power(P[c]), end.beat + t + 0.012, length, 0.92);
    hit(bass, c === 'E' ? 28 : BASS[c], end.beat + t, length, 0.92); hit(kick, 36, end.beat + t, 0.25, 0.92);
  }
  hit(crash, 49, end.beat, 1, 0.9); hit(snare, 38, end.beat + 1, 0.2, 0.95); hit(snare, 38, end.beat + 3, 0.2, 0.95); hit(snare, 38, end.beat + 5, 0.2, 0.95);
  const ring = end.beat + 8;
  strum(left, power(P.B), ring, 3.4, 0.98); strum(right, power(P.B), ring + 0.012, 3.4, 0.95); hit(bass, 35, ring, 3.4, 0.95);
  hit(lead, ['B4', 'D#5', 'F#5'], ring, 3.4, 0.9); hit(crash, 49, ring, 1, 0.95); hit(kick, 36, ring, 0.25, 0.95);
  [50, 50, 48, 48, 47, 47, 45, 45, 43, 43, 41, 41].forEach((pitch, i) => hit(toms, pitch, ring + 1 + i * 0.25, 0.2, 0.6 + i * 0.03));
  roll(snare, 38, ring + 3.25, ring + 4, 0.125, 0.75, 1, 0.08);
  const last = end.beat + 12;
  strum(left, power(P.E), last, 3.2, 1); strum(right, power(P.E), last + 0.012, 3.2, 1); hit(bass, 28, last, 3.2, 1);
  hit(lead, ['E4', 'B4', 'E5'], last, 3.4, 1); hit(kick, 36, last, 0.3, 1); hit(snare, 38, last, 0.2, 1); hit(crash, 49, last, 1, 1);
  return s;
}

// 3 ─ Indie / heartland guitar anthem ───────────────────────────────────────
function northboundLights(seed) {
  const { s, at, part, human, strum, bar } = begin(seed, {
    id: 'northbound-lights', title: 'Northbound Lights', genre: 'Indie guitar anthem', mood: 'Open-road, hopeful, big-hearted', key: 'D major', bpm: 138,
    description: 'A chiming clean-guitar riff with a dotted-eighth echo rides four-on-the-floor heartland drums. Long-toned verses climb through a tom-driven pre-chorus into a soaring lead chorus; the last chorus adds a twin-guitar harmony before the riff signs off over one big D.',
    volume: 0.68, reverb: 0.14, sleeve: 'strata', colors: ['#0f2238', '#f2a541', '#e9f0f7'], inks: ['#f2a541', '#e9f0f7', '#6fb7ff', '#ff7b54', '#b8e986'],
  }, [
    ['intro', 'Headlights', 4], ['verse', 'County line', 8], ['pre', 'Overpass', 4], ['chorus', 'Northbound', 8], ['interlude', 'Mile markers', 4],
    ['verse-two', 'Service station', 8], ['pre-two', 'Overpass', 4], ['chorus-two', 'Northbound', 8], ['bridge', 'Rain on the windscreen', 8],
    ['final', 'All the lights', 8], ['outro', 'Arrival', 6],
  ]);
  const chime = part('chime', 'Chiming riff guitar', 'guitar-clean', 1, -0.3, { brightness: 3800, release: 1.6, palmMute: 0.15 });
  const echo = part('echo', 'Dotted-eighth echo', 'guitar-clean', 0.62, 0.48, { brightness: 3000, release: 1.3, palmMute: 0.15 });
  const lead = part('lead', 'Anthem lead guitar', 'guitar-crunch', 1.5, 0.06, { drive: 0.45, palmMute: 0, brightness: 4800, release: 1.2 });
  const harmony = part('harmony', 'Harmony lead guitar', 'guitar-crunch', 1.05, 0.3, { drive: 0.4, palmMute: 0, brightness: 4400, release: 1.2 });
  const left = part('drive-left', 'Drive chords left', 'guitar-crunch', 0.7, -0.7, { drive: 0.6, palmMute: 0.2, brightness: 4000, release: 0.8 });
  const right = part('drive-right', 'Drive chords right', 'guitar-crunch', 0.68, 0.7, { drive: 0.7, palmMute: 0.2, brightness: 4400, release: 0.8 });
  const bass = part('bass', 'Driving bass', 'electric-bass', 0.9, 0, { brightness: 2400, palmMute: 0.4, release: 0.5 });
  const organ = part('organ', 'Organ swell', 'organ', 0.3, -0.12, { brightness: 2400, attack: 0.08, release: 0.5 });
  const kick = part('kick', 'Kick', 'rock-kick', 0.64);
  const snare = part('snare', 'Snare', 'rock-snare', 0.85, 0.03);
  const hat = part('hat', 'Hi-hat', 'hi-hat', 1.9, -0.3);
  const ride = part('ride', 'Ride', 'ride', 1, 0.32);
  const crash = part('crash', 'Crash', 'crash', 0.8, -0.22);
  const toms = part('toms', 'Toms', 'tom', 0.7, 0.1);

  // The hook: a descending top line over a ringing pedal, echoed a dotted eighth later.
  const riffRows = [
    ['A4', 0, 0.9, 0.6], ['D5', 0.5, 0.9, 0.82], ['F#5', 1, 0.9, 0.86], ['A4', 1.5, 0.9, 0.58], ['E5', 2, 0.9, 0.8], ['A4', 2.5, 0.9, 0.58], ['D5', 3, 0.9, 0.8], ['A4', 3.5, 0.9, 0.58],
    ['B4', 4, 0.9, 0.6], ['D5', 4.5, 0.9, 0.82], ['G5', 5, 0.9, 0.88], ['B4', 5.5, 0.9, 0.58], ['F#5', 6, 0.9, 0.82], ['B4', 6.5, 0.9, 0.58], ['E5', 7, 0.9, 0.8], ['D5', 7.5, 0.5, 0.7],
  ];
  const hookRiff = riff(8, riffRows);
  function chimeRiff(b, bars = 2, velocity = 1) {
    for (let k = 0; k < bars; k += 2) {
      play(chime, 'riff', hookRiff, b + k * 4, { velocity });
      for (const [p, t, , v] of riffRows) hit(echo, p, b + k * 4 + t + 0.75, 0.6, v * 0.55 * velocity);
    }
  }
  const chords = { D: [50, 57, 62], G: [43, 50, 55], A: [45, 52, 57], Bm: [47, 54, 59], Em: [40, 47, 52] };
  const lows = { D: 38, G: 31, A: 33, Bm: 35, Em: 28 };
  const organShapes = { D: [62, 66, 69], G: [62, 67, 71], A: [61, 64, 69], Bm: [62, 66, 71], Em: [59, 64, 67] };
  function drive(c, b, { count = 8, velocity = 1, mute = false } = {}) {
    for (let e = 0; e < count; e++) {
      const v = human((e % 2 ? 0.78 : 0.94) * velocity);
      strum(left, mute ? chords[c].slice(0, 2) : chords[c], b + e / 2, mute ? 0.3 : 0.45, v, { ms: 8 });
      strum(right, mute ? chords[c].slice(0, 2) : chords[c], b + e / 2 + 0.012, mute ? 0.3 : 0.45, v * 0.96, { ms: 8 });
    }
  }
  function bassLine(c, b, velocity = 1) { for (let e = 0; e < 8; e++) hit(bass, lows[c] + (e === 7 ? 7 : 0), b + e / 2, 0.42, human((e % 2 ? 0.78 : 0.92) * velocity)); }
  function beat(b, { cymbal = hat, crashIt = false, fill = null, snareOn = true, floor = false } = {}) {
    for (let j = 0; j < 4; j++) hit(kick, 36, b + j, 0.25, human(j % 2 ? 0.84 : 0.94));
    for (let e = 0; e < 8; e++) {
      if (floor) hit(toms, 41, b + e / 2, 0.2, human(e % 2 ? 0.55 : 0.75));
      else hit(cymbal, cymbal === ride ? 51 : 42, b + e / 2, 0.2, human(e % 2 ? 0.42 : 0.66, 0.05));
    }
    if (crashIt) hit(crash, 49, b, 1, human(0.92));
    if (fill === 'toms') {
      hit(snare, 38, b + 1, 0.2, human(0.95));
      [[2, 50], [2.25, 50], [2.5, 48], [2.75, 48], [3, 45], [3.25, 45], [3.5, 41], [3.75, 41]].forEach(([t, pitch], i) => hit(toms, pitch, b + t, 0.2, 0.7 + i * 0.035));
    } else if (fill === 'snare') {
      hit(snare, 38, b + 1, 0.2, human(0.95));
      roll(snare, 38, b + 2, b + 4, 0.25, 0.5, 0.95, 0.1);
    } else if (snareOn) for (const j of [1, 3]) hit(snare, 38, b + j, 0.2, human(0.96, 0.03));
  }

  const intro = at.intro;
  chimeRiff(intro.beat, 4, 0.92);
  for (let i = 0; i < 4; i++) {
    const b = bar(intro, i);
    if (i < 2) for (let j = 0; j < 4; j++) hit(kick, 36, b + j, 0.25, 0.6 + i * 0.12 + j * 0.03);
    else { beat(b, { crashIt: i === 2, fill: i === 3 ? 'snare' : null }); bassLine(i === 2 ? 'D' : 'G', b, 0.9); }
  }

  const verseChords = ['D', 'G', 'D', 'G', 'D', 'G', 'Em', 'A'];
  const verseLead = riff(32, [
    ['F#4', 0, 1.9, 0.78], ['A4', 2, 1.9, 0.8], ['B4', 4, 2.9, 0.84], ['A4', 7, 0.9, 0.74],
    ['F#4', 8, 1.9, 0.78], ['E4', 10, 1.9, 0.76], ['D4', 12, 3.5, 0.8],
    ['F#4', 16, 1.9, 0.8], ['A4', 18, 1.9, 0.82], ['D5', 20, 2.9, 0.88], ['B4', 23, 0.9, 0.76],
    ['B4', 24, 1.9, 0.82], ['G4', 26, 1.9, 0.78], ['A4', 28, 2.9, 0.84],
  ]);
  for (const [id, full] of [['verse', false], ['verse-two', true]]) {
    const section = at[id];
    chimeRiff(section.beat, 6, full ? 0.8 : 0.72);
    verseChords.forEach((c, i) => {
      const b = bar(section, i);
      bassLine(c, b, full ? 1 : 0.88);
      beat(b, { crashIt: i === 0, fill: i === 7 ? 'toms' : null });
      if (full) drive(c, b, { mute: true, velocity: 0.75 });
      if (full && i % 2 === 0) hit(organ, organShapes[c], b, 7.6, 0.55);
    });
    // Bars 7–8 hand the riff over to a plain strum so the turn to Em–A is heard.
    strum(chime, [52, 59, 64, 67, 71], bar(section, 6), 3.6, 0.46, { ms: 16 }); strum(chime, [57, 64, 69, 73, 76], bar(section, 7), 3.6, 0.48, { ms: 16 });
    play(lead, 'verse-line', verseLead, section.beat, { velocity: full ? 1 : 0.92 });
  }

  const preLine = riff(16, [
    ['E4', 0, 0.9, 0.8], ['G4', 1, 0.9, 0.82], ['B4', 2, 1.9, 0.86], ['D5', 4, 1.9, 0.88], ['B4', 6, 1.9, 0.82],
    ['C#5', 8, 0.9, 0.86], ['D5', 9, 0.9, 0.88], ['E5', 10, 1.9, 0.92], ['E5', 12, 0.9, 0.9], ['D5', 13, 0.9, 0.88], ['C#5', 14, 1.6, 0.9],
  ]);
  for (const id of ['pre', 'pre-two']) {
    const section = at[id];
    ['Em', 'G', 'A', 'A'].forEach((c, i) => {
      const b = bar(section, i);
      if (i < 3) { strum(left, chords[c], b, 3.6, 0.92); strum(right, chords[c], b + 0.012, 3.6, 0.9); hit(organ, organShapes[c], b, 3.8, 0.6); }
      else drive(c, b, { count: 6, velocity: 0.9 });
      bassLine(c, b);
      if (i < 3) { beat(b, { floor: true, snareOn: i === 2 }); if (i < 2) hit(snare, 38, b + 3, 0.2, 0.9); }
      else { for (let j = 0; j < 3; j++) hit(kick, 36, b + j, 0.25, 0.92); roll(snare, 38, b, b + 3.5, 0.25, 0.55, 1, 0.1); }
    });
    play(lead, 'pre-line', preLine, section.beat);
  }

  const melodyRows = [
    ['B4', 0, 0.9, 0.86], ['D5', 1, 0.9, 0.88], ['E5', 2, 1.8, 0.92],
    ['E5', 4, 1.4, 0.9], ['D5', 5.5, 0.45, 0.82], ['C#5', 6, 0.9, 0.86], ['A4', 7, 0.9, 0.82],
    ['D5', 8, 0.9, 0.88], ['F#5', 9, 1.4, 0.94], ['E5', 10.5, 0.45, 0.84], ['D5', 11, 0.9, 0.86], ['B4', 12, 3, 0.88],
    ['B4', 16, 0.9, 0.86], ['D5', 17, 0.9, 0.88], ['G5', 18, 1.8, 0.96],
    ['F#5', 20, 1.4, 0.92], ['E5', 21.5, 0.45, 0.84], ['C#5', 22, 0.9, 0.86], ['E5', 23, 0.9, 0.88],
    ['D5', 24, 1.8, 0.92], ['A4', 26, 0.9, 0.84], ['D5', 27, 0.9, 0.88], ['D5', 28, 3, 0.92],
  ];
  const anthem = riff(32, melodyRows);
  // Twin-guitar harmony a diatonic third below, used only in the last chorus.
  const scale = [2, 4, 6, 7, 9, 11, 1];
  const third = p => { let q = p; for (let k = 0; k < 2; k++) do q--; while (!scale.includes(((q % 12) + 12) % 12)); return q; };
  const twin = riff(32, melodyRows.map(([p, t, d, v]) => [third(pitchOf(p)), t, d, v * 0.92]));
  for (const id of ['chorus', 'chorus-two', 'final']) {
    const section = at[id];
    ['G', 'A', 'Bm', 'Bm', 'G', 'A', 'D', 'D'].forEach((c, i) => {
      const b = bar(section, i);
      drive(c, b); bassLine(c, b);
      beat(b, { cymbal: ride, crashIt: i % 4 === 0 || (id === 'final' && i % 2 === 0), fill: i === 7 ? 'toms' : null });
      if (i % 2 === 0) hit(organ, organShapes[c], b, 7.6, 0.7);
    });
    chimeRiff(section.beat, 8, 0.62);
    play(lead, 'anthem', anthem, section.beat);
    if (id === 'final') play(harmony, 'twin', twin, section.beat);
  }

  const inter = at.interlude;
  chimeRiff(inter.beat, 4, 0.95);
  ['D', 'G', 'D', 'G'].forEach((c, i) => { const b = bar(inter, i); drive(c, b, { velocity: 0.85 }); bassLine(c, b); beat(b, { crashIt: i === 0, fill: i === 3 ? 'snare' : null }); });

  // Bridge: half-time, the riff falls silent and the lead finds a higher line.
  const bridge = at.bridge;
  const bridgeLine = riff(32, [
    ['F#5', 0, 2.9, 0.86], ['E5', 3, 0.9, 0.8], ['C#5', 4, 1.9, 0.82], ['E5', 6, 1.9, 0.84],
    ['D5', 8, 3.9, 0.86], ['B4', 12, 1.9, 0.8], ['D5', 14, 1.9, 0.84],
    ['F#5', 16, 1.9, 0.88], ['A5', 18, 1.9, 0.92], ['E5', 20, 1.9, 0.86], ['C#5', 22, 1.9, 0.84],
    ['D5', 24, 1.9, 0.88], ['G5', 26, 1.9, 0.92], ['A5', 28, 1.4, 0.96],
  ]);
  play(lead, 'bridge-line', bridgeLine, bridge.beat);
  ['Bm', 'A', 'G', 'G', 'Bm', 'A', 'G', 'A'].forEach((c, i) => {
    const b = bar(bridge, i);
    if (i < 4) {
      strum(left, chords[c], b, 3.6, 0.8); strum(right, chords[c], b + 2, 1.6, 0.7);
      hit(bass, lows[c], b, 1.4, 0.88); hit(bass, lows[c], b + 1.5, 0.45, 0.7); hit(bass, lows[c] + 7, b + 2.5, 1.2, 0.76);
      hit(kick, 36, b, 0.25, 0.92); hit(kick, 36, b + 2.5, 0.25, 0.8); hit(snare, 38, b + 2, 0.2, 0.96);
      for (let j = 0; j < 4; j++) hit(ride, 51, b + j, 0.2, human(0.5));
      hit(toms, 45, b + 3.5, 0.2, 0.62);
      hit(organ, organShapes[c], b, 3.8, 0.75);
    } else {
      drive(c, b, { mute: i < 6, velocity: 0.75 + (i - 4) * 0.08, count: i === 7 ? 6 : 8 });
      for (let e = 0; e < (i === 7 ? 6 : 8); e++) hit(bass, lows[c], b + e / 2, 0.42, human(0.82));
      for (let j = 0; j < (i === 7 ? 3 : 4); j++) hit(kick, 36, b + j, 0.25, 0.9);
      if (i < 6) for (let e = 0; e < 8; e++) hit(snare, 38, b + e / 2, 0.12, 0.3 + (i - 4) * 0.15 + e * 0.02);
      else roll(snare, 38, b, b + (i === 7 ? 3.5 : 4), 0.25, 0.6, 1, 0.1);
      hit(organ, organShapes[c], b, i === 7 ? 3 : 3.8, 0.8);
    }
  });

  // Outro: the riff with the whole band, one big D, then the echo has the last word.
  const outro = at.outro;
  chimeRiff(outro.beat, 4, 1);
  ['D', 'G', 'D', 'G'].forEach((c, i) => { const b = bar(outro, i); drive(c, b); bassLine(c, b); beat(b, { cymbal: ride, crashIt: i % 2 === 0, fill: i === 3 ? 'toms' : null }); });
  const last = bar(outro, 4);
  strum(left, [38 + 12, 45 + 12, 50 + 12], last, 3.4, 1); strum(right, chords.D, last + 0.012, 3.4, 1);
  hit(bass, 38, last, 3.4, 1); hit(kick, 36, last, 0.3, 1); hit(crash, 49, last, 1, 1); hit(snare, 38, last, 0.2, 0.95);
  hit(lead, ['A4', 'D5'], last, 3.4, 0.95); hit(organ, [62, 66, 69, 74], last, 3.4, 0.8);
  for (const [p, t, , v] of riffRows.slice(0, 4)) { hit(chime, p, last + t, 1.4, v * 0.8); hit(echo, p, last + t + 0.75, 1, v * 0.42); }
  return s;
}

// 4 ─ Modern dance-pop ──────────────────────────────────────────────────────
function neonConfetti(seed) {
  const { s, at, part, human, strum, bar } = begin(seed, {
    id: 'neon-confetti', title: 'Neon Confetti', genre: 'Dance-pop', mood: 'Euphoric, glossy, sing-along', key: 'F minor, final drop in G minor', bpm: 124,
    description: 'A leaping synth topline arrives in the first bars over a lighter groove, then explodes over four-on-the-floor drums, pumping offbeat bass and saw stabs. Muted pop guitar and snaps carry the verses, a riser pre-chorus lifts into each drop, and the last drop jumps up a whole step.',
    volume: 0.82, reverb: 0.16, sleeve: 'petal', colors: ['#2a0b3d', '#ff4fd8', '#5ef2ff'], inks: ['#ff4fd8', '#5ef2ff', '#ffe066', '#b388ff', '#7cffb2'],
  }, [
    ['intro', 'Doors open', 4], ['verse', 'Glitter on the stairs', 8], ['pre', 'Countdown', 4], ['drop', 'Neon confetti', 8], ['post', 'Hands up', 4],
    ['verse-two', 'Cab line', 8], ['pre-two', 'Countdown', 4], ['drop-two', 'Neon confetti', 8], ['bridge', 'Quiet corner', 8],
    ['final', 'Higher confetti', 8], ['outro', 'Lights on', 4],
  ]);
  const topline = part('topline', 'Topline synth', 'analog-lead', 2, 0, { brightness: 5200, attack: 0.008, release: 0.18, detune: 14 });
  const verseLead = part('verse-lead', 'Verse synth', 'fm-lead', 1.35, -0.1, { brightness: 4200, attack: 0.01, release: 0.25 });
  const sparkle = part('sparkle', 'Glass octave double', 'fm-lead', 0.85, 0.12, { brightness: 6000, attack: 0.005, release: 0.2 });
  const pluck = part('pluck', 'Bright pluck', 'pluck', 1.8, 0.18, { brightness: 4600, release: 0.24 });
  const saws = part('saws', 'Saw stabs', 'pad', 1.6, 0, { brightness: 3600, attack: 0.006, release: 0.16, detune: 16 });
  const guitar = part('guitar', 'Muted pop guitar', 'guitar-clean', 0.62, 0.42, { brightness: 3400, palmMute: 0.6, release: 0.6 });
  const keys = part('keys', 'Bridge keys', 'electric-piano', 0.42, -0.22, { brightness: 3000 });
  const pad = part('pad', 'Wide pad', 'pad', 0.9, -0.05, { brightness: 2200, attack: 0.6, release: 1.5, detune: 12 });
  const bass = part('bass', 'Sub bass', 'bass', 0.72);
  const kick = part('kick', 'Kick', 'kick', 0.82);
  const clap = part('clap', 'Clap', 'clap', 2, 0.05);
  const snare = part('snare', 'Build snare', 'snare', 1.45, -0.05);
  const hat = part('hat', 'Hi-hat', 'hi-hat', 1.9, 0.3);
  const open = part('open-hat', 'Open hat', 'open-hat', 1.15, -0.3);
  const crash = part('crash', 'Crash', 'crash', 0.75, 0.2);
  const riser = part('riser', 'Riser', 'noise', 1.7, 0, { brightness: 5200, attack: 3, release: 0.4 });

  const hookRows = [
    ['C5', 0, 0.35, 0.86], ['C5', 0.5, 0.35, 0.8], ['F5', 1, 0.7, 0.95], ['Eb5', 1.75, 0.35, 0.84], ['C5', 2.25, 0.5, 0.86], ['Ab4', 3, 0.9, 0.84],
    ['Bb4', 4, 0.35, 0.86], ['Bb4', 4.5, 0.35, 0.8], ['Eb5', 5, 0.7, 0.95], ['Db5', 5.75, 0.35, 0.84], ['Bb4', 6.25, 0.5, 0.86], ['G4', 7, 0.9, 0.84],
    ['Ab4', 8, 0.35, 0.86], ['C5', 8.5, 0.35, 0.86], ['F5', 9, 0.45, 0.9], ['G5', 9.5, 0.45, 0.92], ['Ab5', 10, 1.1, 0.98], ['G5', 11.25, 0.25, 0.84], ['F5', 11.5, 0.45, 0.86],
    ['Eb5', 12, 0.45, 0.88], ['C5', 12.75, 0.5, 0.86], ['C5', 14, 1.6, 0.9],
  ];
  const hook = riff(16, hookRows);
  const hookFat = pattern(16, hook.notes.flatMap(n => [n, { ...n, pitch: n.pitch - 12, velocity: level(n.velocity * 0.85) }]));
  const chant = riff(8, hookRows.filter(([, t]) => t < 8));
  const verseLine = riff(16, [
    ['F4', 0.5, 0.4, 0.8], ['Ab4', 1, 0.4, 0.82], ['C5', 1.5, 0.9, 0.88], ['Bb4', 2.75, 0.25, 0.74], ['Ab4', 3, 0.9, 0.82],
    ['Ab4', 4.5, 0.4, 0.8], ['Bb4', 5, 0.4, 0.82], ['C5', 5.5, 0.4, 0.84], ['Ab4', 6, 1.4, 0.82],
    ['C5', 8.5, 0.4, 0.84], ['Eb5', 9, 0.4, 0.88], ['C5', 9.5, 0.4, 0.82], ['Bb4', 10, 0.4, 0.8], ['Ab4', 10.5, 1, 0.84],
    ['G4', 12.5, 0.4, 0.8], ['Ab4', 13, 0.4, 0.82], ['Bb4', 13.5, 1.9, 0.86],
  ]);
  const verseTurn = riff(16, [
    ['F4', 0.5, 0.4, 0.8], ['Ab4', 1, 0.4, 0.82], ['C5', 1.5, 0.9, 0.88], ['Bb4', 2.75, 0.25, 0.74], ['Ab4', 3, 0.9, 0.82],
    ['Ab4', 4.5, 0.4, 0.8], ['Bb4', 5, 0.4, 0.82], ['C5', 5.5, 0.4, 0.84], ['Db5', 6, 1.4, 0.86],
    ['Eb5', 8.5, 0.4, 0.88], ['F5', 9, 0.4, 0.9], ['Eb5', 9.5, 0.4, 0.86], ['C5', 10, 0.4, 0.84], ['Ab4', 10.5, 1, 0.84],
    ['Bb4', 12.5, 0.4, 0.84], ['C5', 13, 0.4, 0.86], ['Eb5', 13.5, 1.9, 0.92],
  ]);
  const preLine = riff(16, [['Db5', 0, 1.9, 0.86], ['C5', 2, 0.9, 0.8], ['Bb4', 3, 0.9, 0.8], ['Eb5', 4, 1.9, 0.88], ['D5', 6, 0.9, 0.82], ['C5', 7, 0.9, 0.82], ['F5', 8, 1.9, 0.9], ['Eb5', 10, 0.9, 0.86], ['Db5', 11, 0.9, 0.86], ['G5', 12, 2.9, 0.95]]);
  const bridgeLine = riff(32, [['Ab4', 0, 2.9, 0.78], ['C5', 3, 0.9, 0.8], ['Eb5', 4, 3.4, 0.84], ['C5', 8, 1.9, 0.8], ['Eb5', 10, 1.9, 0.86], ['F5', 12, 3.4, 0.9], ['Eb5', 16, 0.9, 0.84], ['F5', 17, 0.9, 0.86], ['Ab5', 18, 1.9, 0.9], ['C6', 20, 2.9, 0.94], ['Bb5', 24, 1.9, 0.9], ['G5', 26, 1.9, 0.88], ['Bb5', 28, 2.9, 0.96]]);

  const stab = { Db: [56, 61, 65], Eb: [58, 63, 67], Fm: [56, 60, 65], Cm: [55, 60, 63], Ab: [56, 60, 63], Bbm: [58, 61, 65], Fm9: [53, 56, 60, 63, 67], 'Eb/G': [55, 58, 63] };
  const low = { Db: 37, Eb: 39, Fm: 41, Fm9: 41, Cm: 36, Ab: 44, 'Eb/G': 43, Bbm: 46 };
  const dropChords = ['Db', 'Eb', 'Fm', 'Cm', 'Db', 'Eb', 'Fm', 'Fm'];
  const shift = (list, k) => list.map(p => p + k);

  function fourFloor(b, { crashIt = false, open16 = true, lastBar = false } = {}) {
    for (let j = 0; j < 4; j++) {
      if (!(lastBar && j === 3)) hit(kick, 36, b + j, 0.25, human(0.95, 0.03));
      hit(open, 46, b + j + 0.5, 0.2, human(0.62));
    }
    for (const j of [1, 3]) { hit(clap, 39, b + j, 0.2, human(0.92)); hit(snare, 38, b + j, 0.15, human(0.55)); }
    if (open16) for (let x = 0; x < 16; x++) if (x % 4 !== 2) hit(hat, 42, b + x / 4, 0.1, human(x % 4 === 0 ? 0.62 : 0.42, 0.06));
    if (crashIt) hit(crash, 49, b, 1, human(0.9));
  }
  function dropSection(section, k, { teaser = false } = {}) {
    dropChords.forEach((c, i) => {
      const b = bar(section, i);
      if (teaser) {
        if (i >= 4) return;
        hit(pad, shift(stab[c], k + 12), b, 3.8, 0.7);
        for (let j = 0; j < 4; j++) { hit(kick, 36, b + j, 0.25, human(0.8)); hit(open, 46, b + j + 0.5, 0.2, human(0.5)); hit(bass, low[c] + k, b + j + 0.5, 0.42, human(0.75)); }
        for (const j of [1, 3]) hit(clap, 39, b + j, 0.2, human(0.82));
        for (let e = 0; e < 8; e++) hit(hat, 42, b + e / 2, 0.1, human(e % 2 ? 0.45 : 0.6));
        if (i === 3) { hit(snare, 38, b + 3, 0.1, 0.6); hit(snare, 38, b + 3.5, 0.1, 0.75); hit(snare, 38, b + 3.75, 0.1, 0.85); }
        return;
      }
      for (let j = 0; j < 4; j++) {
        hit(saws, shift(stab[c], k), b + j + 0.5, 0.38, human(0.88));
        hit(bass, low[c] + k, b + j + 0.5, 0.42, human(0.9));
      }
      hit(pad, shift(stab[c], k + 12), b, 3.8, 0.5);
      for (let x = 0; x < 16; x++) hit(pluck, shift(stab[c], k + 12)[[0, 1, 2, 1][x % 4]], b + x / 4, 0.2, human(x % 4 === 0 ? 0.7 : 0.5));
      fourFloor(b, { crashIt: i === 0 || i === 4 });
    });
    if (teaser) { play(topline, 'hook', hook, section.beat, { transpose: k, velocity: 0.92 }); play(pluck, 'hook-teaser', hook, section.beat, { transpose: k + 12 }); return; }
    play(topline, 'hook-fat', hookFat, section.beat, { repeat: 2, transpose: k });
    play(sparkle, 'hook-sparkle', hook, section.beat, { repeat: 2, transpose: k + 12, velocity: 0.8 });
  }
  function verseSection(section, second) {
    ['Fm9', 'Db', 'Ab', 'Eb/G', 'Fm9', 'Db', 'Ab', 'Eb/G'].forEach((c, i) => {
      const b = bar(section, i), chord = stab[c];
      hit(pad, chord, b, 3.8, second ? 0.6 : 0.5);
      for (const [t, length, v, up] of [[0, 0.3, 0.8], [0.75, 0.2, 0.6, true], [1.5, 0.3, 0.75], [2.5, 0.2, 0.62, true], [2.75, 0.3, 0.78], [3.5, 0.2, 0.6, true]]) strum(guitar, chord.slice(-3), b + t, length, human(v), { up, ms: 7 });
      for (const [t, length] of [[0, 1.4], [1.75, 0.6], [2.5, 1.2]]) hit(bass, low[c], b + t, length, human(0.88));
      for (const t of [0, 1.75, 2.5]) hit(kick, 36, b + t, 0.25, human(0.9));
      for (const j of [1, 3]) hit(clap, 39, b + j, 0.2, human(0.85));
      for (let e = 0; e < 8; e++) hit(hat, 42, b + e / 2, 0.1, human(e % 2 ? 0.42 : 0.58));
      if (second) for (let x = 1; x < 16; x += 4) hit(hat, 42, b + x / 4 + 0.5, 0.08, human(0.32));
      if (i === 7) { hit(snare, 38, b + 3, 0.1, 0.6); hit(snare, 38, b + 3.5, 0.1, 0.75); }
    });
    play(verseLead, 'verse-line', verseLine, section.beat);
    play(verseLead, 'verse-turn', verseTurn, bar(section, 4));
  }
  function preSection(section) {
    ['Bbm', 'Cm', 'Db', 'Eb'].forEach((c, i) => {
      const b = bar(section, i);
      hit(pad, stab[c], b, 3.8, 0.62 + i * 0.08);
      for (let e = 0; e < 8; e++) hit(saws, stab[c], b + e / 2, 0.22, 0.42 + i * 0.1 + e * 0.01);
      for (let e = 0; e < 8; e++) hit(bass, low[c], b + e / 2, 0.3, human(0.82));
      for (let j = 0; j < (i === 3 ? 0 : 4); j++) hit(kick, 36, b + j, 0.25, human(0.9));
      for (const j of [1, 3]) hit(clap, 39, b + j, 0.2, human(0.85));
      hit(riser, 60, b, 3.9, 0.3 + i * 0.2);
    });
    const b = section.beat;
    roll(snare, 38, b, b + 4, 1, 0.45, 0.55); roll(snare, 38, b + 4, b + 8, 0.5, 0.5, 0.65); roll(snare, 38, b + 8, b + 12, 0.25, 0.55, 0.8, 0.1); roll(snare, 38, b + 12, b + 15.5, 0.125, 0.6, 1, 0.08);
    play(verseLead, 'pre-line', preLine, section.beat);
  }

  dropSection(at.intro, 0, { teaser: true });
  verseSection(at.verse, false);
  preSection(at.pre);
  dropSection(at.drop, 0);
  const post = at.post;
  ['Db', 'Eb', 'Fm', 'Fm'].forEach((c, i) => {
    const b = bar(post, i);
    for (let j = 0; j < 4; j++) { hit(saws, stab[c], b + j + 0.5, 0.38, human(0.85)); hit(bass, low[c], b + j + 0.5, 0.42, human(0.9)); }
    for (let x = 0; x < 16; x++) hit(pluck, stab[c][[0, 2, 1, 2][x % 4]] + 12, b + x / 4, 0.2, human(x % 4 === 0 ? 0.75 : 0.52));
    fourFloor(b, { crashIt: i === 0 });
  });
  play(topline, 'chant', chant, post.beat, { repeat: 2 });
  verseSection(at['verse-two'], true);
  preSection(at['pre-two']);
  dropSection(at['drop-two'], 0);

  // Bridge: half-time keys and a slow topline, then a build that tips into the higher key.
  const bridge = at.bridge;
  ['Db', 'Ab', 'Eb', 'Fm', 'Db', 'Ab', 'Eb', 'Eb'].forEach((c, i) => {
    const b = bar(bridge, i), chord = { Db: [53, 56, 60, 63], Ab: [51, 56, 60, 63], Eb: [51, 55, 58, 62], Fm: [53, 56, 60, 63] }[c];
    hit(keys, chord, b, 1.6, 0.62); hit(keys, chord, b + 2.5, 1.2, 0.5);
    hit(pad, chord, b, 3.8, 0.55 + (i >= 4 ? (i - 4) * 0.08 : 0));
    hit(bass, low[c === 'Ab' ? 'Ab' : c], b, 3.6, 0.8);
    if (i < 4) { hit(clap, 39, b + 2, 0.2, 0.8); for (let e = 0; e < 8; e++) hit(hat, 42, b + e / 2, 0.1, human(0.38)); }
    else {
      for (let j = 0; j < (i === 7 ? 3 : 4); j++) hit(kick, 36, b + j, 0.25, 0.75 + (i - 4) * 0.05);
      for (let x = 0; x < 16; x++) hit(hat, 42, b + x / 4, 0.08, 0.3 + (i - 4) * 0.08);
      hit(riser, 60, b, 3.9, 0.3 + (i - 4) * 0.2);
    }
  });
  roll(snare, 38, bar(bridge, 6), bar(bridge, 7), 0.25, 0.5, 0.75, 0.1); roll(snare, 38, bar(bridge, 7), bar(bridge, 7) + 3.5, 0.125, 0.7, 1, 0.08);
  play(topline, 'bridge-line', bridgeLine, bridge.beat, { velocity: 0.9 });

  dropSection(at.final, 2);
  const outro = at.outro;
  ['Db', 'Eb'].forEach((c, i) => {
    const b = bar(outro, i);
    for (let j = 0; j < 4; j++) { hit(saws, shift(stab[c], 2), b + j + 0.5, 0.38, human(0.85)); hit(bass, low[c] + 2, b + j + 0.5, 0.42, human(0.9)); }
    fourFloor(b, { crashIt: i === 0 });
  });
  play(topline, 'chant', chant, outro.beat, { transpose: 2 });
  const last = bar(outro, 2);
  hit(saws, [58, 62, 67, 70], last, 2.4, 0.95); hit(pad, [55, 58, 62, 67, 74], last, 3, 0.8); hit(topline, ['G4', 'G5'], last, 2.6, 0.95);
  hit(bass, 31, last, 2.6, 0.95); hit(kick, 36, last, 0.25, 1); hit(crash, 49, last, 1, 1); hit(clap, 39, last, 0.2, 0.9);
  return s;
}

// 5 ─ Nu-disco / funk ───────────────────────────────────────────────────────
function mirrorballShift(seed) {
  const { s, at, part, human, strum, bar } = begin(seed, {
    id: 'mirrorball-shift', title: 'Mirrorball Shift', genre: 'Nu-disco funk', mood: 'Strutting, warm, glittering', key: 'A Dorian', bpm: 118,
    description: 'A two-chord Dorian vamp with sixteenth-note funk scratch guitar, octave disco bass, string stabs and an open hat on every offbeat. A syncopated synth-brass hook leads into a lyrical chorus, a stripped bass-and-claps break, and a final string-tom flourish.',
    volume: 0.8, reverb: 0.16, sleeve: 'ripple', colors: ['#1d0f2e', '#f5c542', '#ff7a59'], inks: ['#f5c542', '#ff7a59', '#9be7ff', '#e0aaff', '#caffbf'],
  }, [
    ['intro', 'Doors and wires', 4], ['groove', 'Mirrorball', 8], ['verse', 'Velvet rope', 8], ['build', 'Spotlight', 4], ['chorus', 'Shift', 8],
    ['break', 'Bass and claps', 8], ['build-two', 'Spotlight', 4], ['chorus-two', 'Shift', 8], ['hook-out', 'Everybody glitters', 8], ['ending', 'Last dance', 4],
  ]);
  const lead = part('lead', 'Synth-brass hook', 'analog-lead', 2, 0.05, { brightness: 3400, attack: 0.012, release: 0.15, detune: 9 });
  const funk = part('funk', 'Funk scratch guitar', 'guitar-clean', 0.74, -0.45, { brightness: 3200, palmMute: 0.5, release: 0.35 });
  const bass = part('bass', 'Octave disco bass', 'electric-bass', 0.95, 0, { brightness: 2800, palmMute: 0.3, release: 0.45 });
  const stabs = part('stabs', 'String stabs', 'strings', 1.5, 0.32, { brightness: 4200, attack: 0.015, release: 0.3, detune: 14 });
  const swell = part('swell', 'String swells', 'strings', 1.1, -0.22, { brightness: 3000, attack: 0.5, release: 1.1, detune: 12 });
  const keys = part('keys', 'Rhodes chords', 'electric-piano', 0.38, 0.22, { brightness: 2800 });
  const kick = part('kick', 'Kick', 'kick', 0.72);
  const clap = part('clap', 'Clap', 'clap', 2, 0.04);
  const snare = part('snare', 'Snare', 'rock-snare', 0.5, -0.04);
  const hat = part('hat', 'Sixteenth hats', 'hi-hat', 2, 0.28);
  const open = part('open-hat', 'Offbeat open hat', 'open-hat', 1.35, -0.28);
  const shaker = part('shaker', 'Tambourine shaker', 'shaker', 2, 0.4);
  const crash = part('crash', 'Crash', 'crash', 0.75, 0.18);
  const toms = part('toms', 'Disco toms', 'tom', 0.62, -0.12);

  const fat = motif => pattern(motif.beats, motif.notes.flatMap(n => [n, { ...n, pitch: n.pitch - 12, velocity: level(n.velocity * 0.8) }]));
  const hook = fat(riff(8, [
    ['E5', 0, 0.4, 0.9], ['E5', 0.75, 0.25, 0.8], ['G5', 1, 0.5, 0.92], ['E5', 1.75, 0.25, 0.8], ['D5', 2, 0.4, 0.84], ['E5', 2.5, 0.9, 0.9],
    ['A5', 4, 0.4, 0.95], ['G5', 4.75, 0.25, 0.82], ['F#5', 5, 0.5, 0.88], ['E5', 5.75, 0.25, 0.8], ['D5', 6, 0.4, 0.84], ['C5', 6.5, 0.4, 0.84], ['A4', 7, 0.75, 0.88],
  ]));
  const chorusLine = fat(riff(32, [
    ['A5', 0, 1.4, 0.92], ['G5', 1.5, 0.45, 0.84], ['E5', 2, 0.9, 0.86], ['C5', 3, 0.9, 0.84],
    ['D5', 4, 1.4, 0.88], ['E5', 5.5, 0.45, 0.84], ['G5', 6, 1.9, 0.92],
    ['G5', 8, 1.4, 0.9], ['E5', 9.5, 0.45, 0.82], ['D5', 10, 0.9, 0.84], ['B4', 11, 0.9, 0.82],
    ['C5', 12, 1.4, 0.86], ['D5', 13.5, 0.45, 0.84], ['E5', 14, 1.9, 0.9],
    ['A5', 16, 1.4, 0.94], ['G5', 17.5, 0.45, 0.84], ['E5', 18, 0.9, 0.86], ['C5', 19, 0.9, 0.84],
    ['D5', 20, 1.4, 0.88], ['E5', 21.5, 0.45, 0.84], ['G5', 22, 1.9, 0.92],
    ['B5', 24, 0.9, 0.95], ['A5', 25, 0.45, 0.88], ['G5', 25.5, 0.45, 0.86], ['E5', 26, 0.9, 0.86], ['D5', 27, 0.9, 0.84], ['E5', 28, 0.9, 0.88], ['A5', 29, 2.4, 0.95],
  ]));
  const verseLick = riff(8, [['C5', 2.5, 0.25, 0.8], ['D5', 2.75, 0.25, 0.82], ['E5', 3, 0.5, 0.88], ['G5', 3.5, 0.4, 0.86], ['A5', 6.5, 0.25, 0.86], ['G5', 6.75, 0.25, 0.82], ['E5', 7, 0.75, 0.86]]);

  const vamp = [{ guitar: [64, 67, 72], strings: [69, 72, 76], keys: [57, 60, 64, 67], walk: [33, 45, 33, 45, 33, 45, 40, 43] }, { guitar: [64, 66, 72], strings: [66, 69, 72, 76], keys: [54, 57, 60, 64], walk: [38, 50, 38, 50, 38, 50, 45, 43] }];
  const song = {
    F: { guitar: [64, 69, 72], strings: [69, 72, 76], keys: [53, 57, 60, 64], walk: [29, 41, 29, 41, 29, 41, 36, 41] },
    G: { guitar: [62, 67, 71], strings: [67, 71, 74], keys: [55, 59, 62, 64], walk: [31, 43, 31, 43, 31, 43, 38, 43] },
    Em: { guitar: [62, 67, 71], strings: [67, 71, 74], keys: [52, 55, 59, 62], walk: [28, 40, 28, 40, 28, 40, 35, 38] },
    Am: { guitar: [64, 67, 72], strings: [69, 72, 76], keys: [57, 60, 64, 67], walk: [33, 45, 33, 45, 33, 45, 40, 43] },
    Dm: { guitar: [65, 69, 72], strings: [69, 72, 77], keys: [53, 57, 60, 62], walk: [38, 50, 38, 50, 38, 50, 45, 50] },
    E: { guitar: [64, 68, 71], strings: [68, 71, 76], keys: [52, 56, 59, 62], walk: [28, 40, 28, 40, 28, 40, 35, 40] },
  };
  const scratch = 'X.xXx.X.x.Xx.xX.';
  function funkBar(chord, b, velocity = 1) {
    [...scratch].forEach((c, x) => {
      if (c === 'X') strum(funk, chord.guitar, b + x / 4, 0.2, human(0.76 * velocity), { up: x % 2 === 1, ms: 8 });
      else if (c === 'x') hit(funk, chord.guitar.slice(0, 2), b + x / 4, 0.06, human(0.4 * velocity));
    });
  }
  function bassBar(chord, b, velocity = 1) { chord.walk.forEach((p, e) => hit(bass, p, b + e / 2, 0.35, human((e % 2 ? 0.78 : 0.94) * velocity))); }
  function discoBeat(b, { crashIt = false, fill = false, light = false } = {}) {
    for (let j = 0; j < 4; j++) {
      hit(kick, 36, b + j, 0.25, human(0.95, 0.03));
      if (!light) hit(open, 46, b + j + 0.5, 0.2, human(0.62));
    }
    for (const j of [1, 3]) { if (!(fill && j === 3)) { hit(clap, 39, b + j, 0.2, human(0.9)); hit(snare, 38, b + j, 0.2, human(0.62)); } }
    if (!light) for (let x = 0; x < 16; x++) { if (x % 4 !== 2) hit(hat, 42, b + x / 4, 0.08, human(x % 4 === 0 ? 0.5 : 0.36, 0.06)); hit(shaker, 70, b + x / 4, 0.08, human(x % 2 ? 0.38 : 0.55)); }
    if (crashIt) hit(crash, 49, b, 1, human(0.88));
    if (fill) [55, 55, 52, 52, 48, 48, 45, 43].forEach((pitch, i) => hit(toms, pitch, b + 2 + i * 0.25, 0.2, 0.62 + i * 0.04));
  }
  function stabPair(chord, b) { hit(stabs, chord.strings, b + 2.5, 0.22, 0.85); hit(stabs, chord.strings, b + 3, 0.4, 0.92); }

  const intro = at.intro;
  for (let i = 0; i < 4; i++) {
    const b = bar(intro, i), chord = vamp[i % 2];
    funkBar(chord, b);
    if (i >= 1) bassBar(chord, b, 0.9);
    if (i >= 2) discoBeat(b, { crashIt: i === 2, fill: i === 3, light: i === 2 });
    else for (let j = 0; j < 4; j++) hit(kick, 36, b + j, 0.25, 0.7 + i * 0.1);
  }
  for (const id of ['groove', 'verse', 'hook-out']) {
    const section = at[id];
    for (let i = 0; i < 8; i++) {
      const b = bar(section, i), chord = vamp[i % 2];
      funkBar(chord, b); bassBar(chord, b);
      discoBeat(b, { crashIt: i === 0, fill: i === 7 });
      if (i % 2 === 1 && id !== 'verse') stabPair(chord, b);
      if (id === 'verse' && i % 2 === 0) hit(keys, chord.keys, b + 1.5, 0.5, 0.6);
      if (id === 'hook-out' && i % 2 === 0) hit(swell, [[76, 79], [78, 81]][i / 2 % 2], b, 7.5, 0.7);
    }
    if (id === 'verse') { play(lead, 'verse-lick', verseLick, section.beat, { repeat: 4, velocity: 0.92 }); continue; }
    play(lead, 'hook', hook, section.beat, { repeat: 4 });
  }

  function build(section) {
    ['Dm', 'Em', 'F', 'E'].forEach((name, i) => {
      const b = bar(section, i), chord = song[name];
      funkBar(chord, b, 0.85 + i * 0.05); bassBar(chord, b);
      hit(swell, chord.strings, b, 3.8, 0.55 + i * 0.12);
      for (let j = 0; j < 4; j++) hit(kick, 36, b + j, 0.25, human(0.9));
      for (let x = 0; x < (i < 2 ? 8 : 16); x++) hit(snare, 38, b + x * (i < 2 ? 0.5 : 0.25), 0.1, 0.3 + i * 0.13 + x * 0.008);
      for (const j of [1, 3]) hit(clap, 39, b + j, 0.2, human(0.85));
    });
    play(lead, 'climb', riff(16, [['A4', 0, 1.9, 0.82], ['C5', 2, 1.9, 0.84], ['B4', 4, 1.9, 0.84], ['D5', 6, 1.9, 0.86], ['C5', 8, 1.9, 0.86], ['E5', 10, 1.9, 0.9], ['G#5', 12, 1.4, 0.92], ['B5', 13.5, 2.2, 0.95]]), section.beat);
  }
  function chorus(section) {
    ['F', 'G', 'Em', 'Am', 'F', 'G', 'Em', 'Am'].forEach((name, i) => {
      const b = bar(section, i), chord = song[name];
      funkBar(chord, b); bassBar(chord, b);
      hit(keys, chord.keys, b, 1.4, 0.6); hit(keys, chord.keys, b + 2.5, 0.9, 0.5);
      hit(swell, chord.strings, b, 3.8, 0.62);
      discoBeat(b, { crashIt: i % 4 === 0, fill: i === 7 });
    });
    play(lead, 'chorus-line', chorusLine, section.beat);
  }
  build(at.build); chorus(at.chorus);

  // Break: kick, claps and a slap-style bass riff; the band creeps back in for the second half.
  const brk = at.break;
  const slap = riff(8, [
    ['A1', 0, 0.25, 0.95], ['A2', 0.5, 0.2, 0.86], ['G2', 0.75, 0.2, 0.78], ['A2', 1, 0.25, 0.86], ['E2', 1.5, 0.25, 0.82], ['G2', 2, 0.25, 0.84], ['A2', 2.5, 0.2, 0.86], ['C3', 2.75, 0.2, 0.84], ['A2', 3.25, 0.2, 0.8], ['G2', 3.5, 0.4, 0.84],
    ['D2', 4, 0.25, 0.95], ['D3', 4.5, 0.2, 0.86], ['C3', 4.75, 0.2, 0.78], ['D3', 5, 0.25, 0.86], ['A2', 5.5, 0.25, 0.82], ['C3', 6, 0.25, 0.84], ['D3', 6.5, 0.2, 0.86], ['F#3', 6.75, 0.2, 0.84], ['E3', 7.25, 0.2, 0.8], ['C3', 7.5, 0.4, 0.84],
  ]);
  play(bass, 'slap', slap, brk.beat, { repeat: 4 });
  for (let i = 0; i < 8; i++) {
    const b = bar(brk, i);
    for (let j = 0; j < 4; j++) hit(kick, 36, b + j, 0.25, human(0.92));
    for (const j of [1, 3]) hit(clap, 39, b + j, 0.2, human(0.95));
    if (i >= 2) funkBar(vamp[i % 2], b, 0.8);
    if (i >= 4) for (let j = 0; j < 4; j++) hit(open, 46, b + j + 0.5, 0.2, human(0.55));
    if (i >= 6) for (let x = 0; x < 16; x++) hit(shaker, 70, b + x / 4, 0.08, human(0.45));
    if (i === 5 || i === 7) stabPair(vamp[1], b);
  }
  play(lead, 'verse-lick', verseLick, bar(brk, 4), { repeat: 2, velocity: 0.95 });
  build(at['build-two']); chorus(at['chorus-two']);

  // Ending: the hook once more, a disco-tom run and one sustained Am9.
  const end = at.ending;
  for (let i = 0; i < 2; i++) { const b = bar(end, i), chord = vamp[i % 2]; funkBar(chord, b); bassBar(chord, b); discoBeat(b, { crashIt: i === 0, fill: i === 1 }); }
  play(lead, 'hook', hook, end.beat);
  const last = bar(end, 2);
  hit(stabs, [69, 72, 76, 79], last, 3, 0.95); hit(swell, [57, 64, 67, 71, 72], last, 3, 0.8); hit(keys, [57, 60, 64, 67, 71], last, 3, 0.75);
  strum(funk, [57, 64, 67, 71, 76], last, 2.5, 0.8, { ms: 18 }); hit(bass, 33, last, 3, 1); hit(lead, ['A4', 'E5', 'A5'], last, 2.8, 0.9);
  hit(kick, 36, last, 0.25, 1); hit(clap, 39, last, 0.2, 0.95); hit(crash, 49, last, 1, 1);
  return s;
}

// 6 ─ Modern soul / Afro-pop groove ─────────────────────────────────────────
function goldenHourAvenue(seed) {
  const { s, at, part, human, bar } = begin(seed, {
    id: 'golden-hour-avenue', title: 'Golden Hour Avenue', genre: 'Afro-pop soul', mood: 'Sun-warm, bouncing, generous', key: 'E-flat major', bpm: 106,
    description: 'A marimba hook in dotted-eighth tresillo rhythm over interlocking highlife guitars, conga-like toms, a syncopated rim pattern and a bouncing bass. Soul chords open a singable synth-lead chorus; a percussion break rebuilds into the last chorus and a warm final chord.',
    volume: 0.95, reverb: 0.18, sleeve: 'weave', colors: ['#f28c28', '#0b3d3a', '#ffe8c2'], inks: ['#0b3d3a', '#ffe8c2', '#ff5d8f', '#3a86ff', '#ffd166'],
  }, [
    ['intro', 'Corner shop', 4], ['groove', 'Golden hour', 8], ['verse', 'Avenue', 8], ['pre', 'Streetlights warming', 4], ['chorus', 'All of us outside', 8],
    ['break', 'Drums in the yard', 8], ['chorus-two', 'All of us outside', 8], ['outro', 'Last light', 6],
  ]);
  const marimba = part('marimba', 'Marimba hook', 'marimba', 1.5, -0.18);
  const lead = part('lead', 'Warm synth lead', 'analog-lead', 2, 0.06, { brightness: 2600, attack: 0.02, release: 0.22, detune: 5 });
  const high = part('highlife', 'Highlife guitar', 'guitar-clean', 1, 0.42, { brightness: 3200, palmMute: 0.3, release: 0.7 });
  const low = part('second-guitar', 'Second guitar', 'guitar-clean', 0.85, -0.42, { brightness: 2600, palmMute: 0.45, release: 0.6 });
  const keys = part('keys', 'Soul keys', 'electric-piano', 0.42, 0.15, { brightness: 2600 });
  const pad = part('pad', 'Warm pad', 'pad', 0.8, -0.1, { brightness: 1900, attack: 0.4, release: 1.2, detune: 10 });
  const bass = part('bass', 'Bounce bass', 'electric-bass', 1, 0, { brightness: 1900, palmMute: 0.45, release: 0.5 });
  const kick = part('kick', 'Kick', 'kick', 0.7);
  const rim = part('rim', 'Rim pattern', 'snare', 1.5, 0.12);
  const clap = part('clap', 'Clap', 'clap', 1.8, -0.05);
  const shaker = part('shaker', 'Shaker', 'shaker', 2, 0.35);
  const hat = part('hat', 'Hi-hat', 'hi-hat', 1.6, -0.3);
  const congas = part('congas', 'Conga toms', 'tom', 0.5, -0.32);
  const crash = part('crash', 'Crash', 'crash', 0.62, 0.2);

  const hookRows = [
    ['Bb4', 0, 0.35, 0.86], ['G4', 0.75, 0.35, 0.8], ['Bb4', 1.5, 0.35, 0.82], ['Eb5', 2, 0.5, 0.92], ['D5', 2.75, 0.35, 0.82], ['Bb4', 3.5, 0.4, 0.84],
    ['C5', 4, 0.35, 0.86], ['Bb4', 4.75, 0.35, 0.8], ['G4', 5.5, 0.35, 0.82], ['F4', 6, 0.5, 0.86], ['Eb4', 6.75, 0.35, 0.8], ['G4', 7.5, 0.4, 0.82],
    ['Ab4', 8, 0.35, 0.86], ['C5', 8.75, 0.35, 0.82], ['Eb5', 9.5, 0.35, 0.86], ['F5', 10, 0.5, 0.94], ['Eb5', 10.75, 0.35, 0.84], ['C5', 11.5, 0.4, 0.84],
    ['D5', 12, 0.35, 0.88], ['Bb4', 12.75, 0.35, 0.82], ['F4', 13.5, 0.35, 0.8], ['Bb4', 14, 1.2, 0.86],
  ];
  const hook = riff(16, hookRows);
  const chorusLine = pattern(32, riff(32, [
    ['C5', 0, 0.9, 0.86], ['Eb5', 1, 0.4, 0.84], ['C5', 1.5, 0.4, 0.82], ['Bb4', 2, 1.4, 0.86], ['Ab4', 3.5, 0.4, 0.8],
    ['Bb4', 4, 0.9, 0.84], ['D5', 5, 0.4, 0.86], ['F5', 5.5, 0.9, 0.92], ['Eb5', 6.5, 0.4, 0.84], ['D5', 7, 0.9, 0.86],
    ['D5', 8, 0.9, 0.86], ['Bb4', 9, 0.4, 0.82], ['G4', 9.5, 0.9, 0.82], ['F4', 10.5, 0.4, 0.78], ['G4', 11, 0.9, 0.82],
    ['Eb5', 12, 1.9, 0.9], ['D5', 14, 0.4, 0.84], ['C5', 14.5, 1.4, 0.86],
    ['C5', 16, 0.9, 0.88], ['Eb5', 17, 0.4, 0.86], ['C5', 17.5, 0.4, 0.84], ['Bb4', 18, 1.4, 0.88], ['Ab4', 19.5, 0.4, 0.82],
    ['Bb4', 20, 0.9, 0.86], ['D5', 21, 0.4, 0.88], ['F5', 21.5, 0.9, 0.94], ['Eb5', 22.5, 0.4, 0.86], ['D5', 23, 0.9, 0.88],
    ['D5', 24, 0.9, 0.88], ['F5', 25, 0.4, 0.88], ['G5', 25.5, 0.9, 0.94], ['F5', 26.5, 0.4, 0.86], ['D5', 27, 0.9, 0.86],
    ['G5', 28, 0.9, 0.95], ['F5', 29, 0.4, 0.88], ['Eb5', 29.5, 2.2, 0.92],
  ]).notes.flatMap(n => [n, { ...n, pitch: n.pitch - 12, velocity: level(n.velocity * 0.7) }]));

  const chords = {
    Eb: { tones: [67, 70, 75], keys: [55, 58, 62, 65], root: 39 }, Cm: { tones: [67, 72, 75], keys: [55, 58, 60, 63], root: 36 },
    Ab: { tones: [68, 72, 75], keys: [55, 60, 63, 68], root: 44 }, Bb: { tones: [65, 70, 74], keys: [56, 58, 62, 65], root: 34 },
    Fm: { tones: [65, 68, 72], keys: [56, 60, 63, 65], root: 41 }, Gm: { tones: [67, 70, 74], keys: [53, 58, 62, 65], root: 43 },
  };
  const loop = ['Eb', 'Cm', 'Ab', 'Bb'];
  const upper = [0, null, 1, 2, null, 1, 0, null, 2, null, 1, 2, null, 0, 1, null];
  const under = [null, 0, null, null, 1, null, null, 2, null, 0, null, null, 2, null, null, 1];
  const sw = x => x / 4 + (x % 2 ? 0.02 : 0); // a light sixteenth swing
  function guitars(c, b, velocity = 1) {
    upper.forEach((k, x) => { if (k !== null) hit(high, chords[c].tones[k], b + sw(x), 0.22, human((x % 4 === 0 ? 0.72 : 0.58) * velocity)); });
    under.forEach((k, x) => { if (k !== null) hit(low, chords[c].tones[k] - 12, b + sw(x), 0.3, human(0.6 * velocity)); });
  }
  function bassBar(c, b, velocity = 1) {
    const r = chords[c].root;
    for (const [t, interval, length, v] of [[0, 0, 0.5, 0.95], [0.75, 0, 0.25, 0.7], [1.5, 7, 0.45, 0.82], [2.5, 12, 0.25, 0.74], [2.75, 7, 0.25, 0.7], [3.5, 10, 0.4, 0.78]]) hit(bass, r + interval, b + t, length, human(v * velocity));
  }
  function groove(b, { clapOn = false, crashIt = false, conga = true, light = false } = {}) {
    for (const [t, v] of [[0, 0.95], [2, 0.9], [2.75, 0.6]]) hit(kick, 36, b + t, 0.25, human(v));
    for (const t of [0.75, 1.5, 3]) hit(rim, 37, b + t, 0.1, human(0.7));
    if (clapOn) for (const j of [1, 3]) hit(clap, 39, b + j, 0.2, human(0.88));
    for (let x = 0; x < 16; x++) hit(shaker, 70, b + sw(x), 0.08, human(x % 2 ? 0.62 : 0.42));
    if (!light) for (let e = 0; e < 8; e++) hit(hat, 42, b + e / 2, 0.08, human(e % 2 ? 0.5 : 0.36));
    if (conga) for (const [t, p, v] of [[0.5, 57, 0.62], [1.25, 52, 0.5], [2.5, 57, 0.6], [3.25, 52, 0.48], [3.75, 55, 0.55]]) hit(congas, p, b + t, 0.2, human(v));
    if (crashIt) hit(crash, 49, b, 1, human(0.82));
  }

  const intro = at.intro;
  loop.forEach((c, i) => {
    const b = bar(intro, i);
    guitars(c, b, 0.9);
    if (i >= 2) { bassBar(c, b, 0.9); groove(b, { light: true, conga: i === 3 }); } else for (let x = 0; x < 16; x++) hit(shaker, 70, b + sw(x), 0.08, human(x % 2 ? 0.55 : 0.36));
  });
  play(marimba, 'hook', hook, intro.beat);
  for (const id of ['groove', 'verse']) {
    const section = at[id];
    for (let i = 0; i < 8; i++) {
      const b = bar(section, i), c = loop[i % 4];
      guitars(c, b); bassBar(c, b);
      groove(b, { crashIt: i === 0, clapOn: id === 'groove' });
      if (id === 'verse') { hit(keys, chords[c].keys, b + 0.5, 0.9, 0.6); hit(keys, chords[c].keys, b + 2.25, 0.6, 0.48); }
    }
    if (id === 'groove') play(marimba, 'hook', hook, section.beat, { repeat: 2 });
    else play(marimba, 'hook-echo', riff(16, hookRows.filter(([, t]) => t < 4 || (t >= 8 && t < 12))), section.beat, { repeat: 2, velocity: 0.85 });
  }
  const verseLine = riff(32, [['G4', 4, 1.4, 0.8], ['Bb4', 5.5, 0.4, 0.8], ['C5', 6, 1.6, 0.84], ['Eb5', 12, 1.4, 0.86], ['D5', 13.5, 0.4, 0.82], ['Bb4', 14, 1.6, 0.82], ['G4', 20, 1.4, 0.8], ['Bb4', 21.5, 0.4, 0.8], ['C5', 22, 1.6, 0.84], ['F5', 28, 1.4, 0.88], ['Eb5', 29.5, 0.4, 0.84], ['D5', 30, 1.6, 0.86]]);
  play(lead, 'verse-line', verseLine, at.verse.beat, { velocity: 0.9 });

  const pre = at.pre;
  ['Fm', 'Gm', 'Ab', 'Bb'].forEach((c, i) => {
    const b = bar(pre, i);
    for (const t of [0, 1.5, 3]) hit(keys, chords[c].keys, b + t, 0.6, 0.62);
    hit(pad, chords[c].keys, b, 3.8, 0.55 + i * 0.08);
    for (const t of [0, 1.5, 3]) hit(bass, chords[c].root, b + t, 0.6, 0.88);
    for (let j = 0; j < (i === 3 ? 2 : 4); j++) hit(kick, 36, b + j, 0.25, 0.85);
    for (let x = 0; x < 16; x++) hit(shaker, 70, b + sw(x), 0.08, human(x % 2 ? 0.6 : 0.4));
    if (i === 3) [60, 60, 57, 57, 55, 55, 52, 52].forEach((p, k) => hit(congas, p, b + 2 + k * 0.25, 0.2, 0.55 + k * 0.05));
  });
  play(lead, 'pre-line', riff(16, [['F4', 0, 0.9, 0.8], ['Ab4', 1, 0.9, 0.82], ['C5', 2, 1.9, 0.86], ['G4', 4, 0.9, 0.82], ['Bb4', 5, 0.9, 0.84], ['D5', 6, 1.9, 0.88], ['Ab4', 8, 0.9, 0.84], ['C5', 9, 0.9, 0.86], ['Eb5', 10, 1.9, 0.9], ['F5', 12, 0.9, 0.92], ['D5', 13, 0.9, 0.88]]), pre.beat);

  for (const id of ['chorus', 'chorus-two']) {
    const section = at[id];
    ['Ab', 'Bb', 'Gm', 'Cm', 'Ab', 'Bb', 'Gm', 'Cm'].forEach((c, i) => {
      const b = bar(section, i);
      guitars(c, b); bassBar(c, b);
      hit(pad, chords[c].keys, b, 3.8, 0.62);
      hit(keys, chords[c].keys, b + 0.5, 0.9, 0.58); hit(keys, chords[c].keys, b + 2.25, 0.6, 0.46);
      groove(b, { clapOn: true, crashIt: i % 4 === 0 });
    });
    play(lead, 'chorus-line', chorusLine, section.beat);
    if (id === 'chorus-two') play(marimba, 'chorus-sparkle', riff(32, [['C6', 3.5, 0.3, 0.7], ['Eb6', 7.5, 0.3, 0.72], ['D6', 11.5, 0.3, 0.7], ['G5', 15.5, 0.3, 0.7], ['C6', 19.5, 0.3, 0.72], ['F6', 23.5, 0.3, 0.74], ['D6', 27.5, 0.3, 0.72]]), section.beat);
  }

  // Break: drums, congas and bass alone, then the guitars and hook find their way back in.
  const brk = at.break;
  for (let i = 0; i < 8; i++) {
    const b = bar(brk, i), c = loop[i % 4];
    bassBar(c, b, i < 4 ? 0.85 : 1);
    groove(b, { clapOn: i >= 4, crashIt: i === 4 });
    for (const [t, p, v] of [[0.25, 60, 0.5], [1, 55, 0.62], [1.75, 60, 0.5], [2.25, 55, 0.55], [3.5, 57, 0.62]]) hit(congas, p, b + t, 0.2, human(v));
    if (i >= 4) guitars(c, b, 0.85 + (i - 4) * 0.05);
    if (i === 7) roll(rim, 37, b + 2, b + 4, 0.25, 0.5, 0.95, 0.08);
  }
  play(marimba, 'hook', hook, bar(brk, 4), { velocity: 0.9 });

  const outro = at.outro;
  loop.forEach((c, i) => { const b = bar(outro, i); guitars(c, b); bassBar(c, b); groove(b, { clapOn: true, crashIt: i === 0 }); hit(pad, chords[c].keys, b, 3.8, 0.5); });
  play(marimba, 'hook', hook, outro.beat);
  play(lead, 'hook-unison', hook, outro.beat, { transpose: -12, velocity: 0.8 });
  const last = bar(outro, 4);
  hit(keys, [55, 58, 62, 65, 70], last, 3.5, 0.58); hit(pad, [51, 58, 62, 65, 70], last, 4, 0.7); hit(bass, 39, last, 3, 0.85);
  [67, 70, 74, 79].forEach((p, k) => hit(high, p, last + k * 0.04, 3, 0.5)); ['Eb5', 'G5', 'Bb5', 'Eb6'].forEach((p, k) => hit(marimba, p, last + 0.5 + k * 0.125, 0.6, 0.62 + k * 0.04));
  hit(kick, 36, last, 0.25, 0.85); hit(crash, 49, last, 1, 0.8); hit(congas, 52, last, 0.2, 0.7);
  return s;
}

// 7 ─ UK garage / breakbeat ─────────────────────────────────────────────────
function nightBusTwoStep(seed) {
  const { s, at, part, human, bar } = begin(seed, {
    id: 'night-bus-two-step', title: 'Night Bus Two-Step', genre: 'UK garage breakbeat', mood: 'Late, slick, restless', key: 'C minor', bpm: 134,
    description: 'Shuffled two-step drums, minor-ninth organ stabs and a bundled spoken phrase chopped and pitched up into a rhythmic hook: speech as percussion, not singing. A glassy melody rides the drops, stutter builds wind up the tension, and a breakbeat section swaps in a growling bass.',
    volume: 0.86, reverb: 0.14, sleeve: 'window', colors: ['#0b1026', '#ff9e3d', '#8fb3ff'], inks: ['#ff9e3d', '#8fb3ff', '#f7f7ff', '#ff5e78', '#9bf6ff'],
  }, [
    ['intro', 'Last stop', 4], ['verse', 'Top deck', 8], ['build', 'Doors closing', 4], ['drop', 'Two-step', 8], ['verse-two', 'Window seat', 8],
    ['break', 'Breakbeat detour', 8], ['build-two', 'Doors closing', 4], ['drop-two', 'Two-step home', 12], ['outro', 'Final stop', 5],
  ]);
  const glass = part('glass', 'Glass hook', 'fm-lead', 1.45, 0.12, { brightness: 5200, attack: 0.005, release: 0.18 });
  const chops = part('chops', 'Chopped phrase', 'sample', 0.78, 0.08);
  chops.sample = { asset: 'builtin:stay-a-little', effect: 'chop', semitones: 5, pattern: [0, null, 1, 1, null, 2, 3, null] };
  const stutter = part('stutter', 'Phrase stutter', 'sample', 0.7, -0.15);
  stutter.sample = { asset: 'builtin:stay-a-little', effect: 'chop', semitones: 7, pattern: [0, 0, null, 0, 1, null, 1, 3] };
  const organ = part('organ', 'Garage organ stabs', 'organ', 0.55, -0.2, { brightness: 3000, attack: 0.004, release: 0.08 });
  const keys = part('keys', 'Rhodes', 'electric-piano', 0.4, 0.25, { brightness: 2600 });
  const pad = part('pad', 'Night pad', 'pad', 0.7, 0, { brightness: 1700, attack: 0.5, release: 1.2, detune: 10 });
  const sub = part('sub', 'Sub bass', 'bass', 0.8);
  const growl = part('growl', 'Growl bass', 'acid-bass', 1.15, 0, { brightness: 900, release: 0.25 });
  const kick = part('kick', 'Kick', 'kick', 0.82);
  const clap = part('clap', 'Clap', 'clap', 1.9, 0.04);
  const snare = part('snare', 'Break snare', 'rock-snare', 0.66, -0.04);
  const rim = part('rim', 'Rim ticks', 'snare', 1.2, 0.3);
  const hat = part('hat', 'Shuffled hats', 'hi-hat', 1.9, 0.28);
  const open = part('open-hat', 'Open hat', 'open-hat', 1.2, -0.3);
  const shaker = part('shaker', 'Shaker', 'shaker', 1.8, -0.4);
  const crash = part('crash', 'Crash', 'crash', 0.62, 0.15);
  const riser = part('riser', 'Riser', 'noise', 1.6, 0, { brightness: 4800, attack: 3, release: 0.3 });

  const sw = t => round(t + (Math.round(t * 4) % 2 ? 0.04 : 0)); // two-step sixteenth swing
  const hookRows = [
    ['G5', 0, 0.3, 0.88], ['Eb5', 0.5, 0.3, 0.8], ['F5', 0.75, 0.3, 0.82], ['G5', 1.25, 0.5, 0.9], ['Bb5', 2, 0.3, 0.92], ['G5', 2.5, 0.5, 0.86], ['F5', 3.25, 0.5, 0.84],
    ['Eb5', 4, 0.3, 0.86], ['C5', 4.5, 0.3, 0.8], ['Eb5', 4.75, 0.3, 0.82], ['F5', 5.25, 0.5, 0.88], ['Ab5', 6, 0.3, 0.88], ['G5', 6.5, 0.9, 0.9],
    ['C6', 8, 0.3, 0.94], ['Bb5', 8.5, 0.3, 0.86], ['G5', 8.75, 0.3, 0.84], ['Eb5', 9.25, 0.5, 0.86], ['F5', 10, 0.5, 0.86], ['G5', 10.75, 0.75, 0.9],
    ['F5', 12, 0.3, 0.86], ['D5', 12.5, 0.3, 0.8], ['F5', 12.75, 0.3, 0.82], ['Ab5', 13.25, 0.5, 0.86], ['G5', 14, 1.4, 0.9],
  ].map(([p, t, d, v]) => [p, sw(t), d, v]);
  const hook = riff(16, hookRows);
  const hookHigh = pattern(16, hook.notes.flatMap(n => [n, { ...n, pitch: n.pitch + 12, velocity: level(n.velocity * 0.6) }]));
  const answer = riff(8, [['G5', 6, 0.3, 0.8], ['Eb5', sw(6.75), 0.3, 0.76], ['C5', 7.25, 0.5, 0.78]]);

  const chords = { Cm9: [51, 55, 58, 62], Fm9: [51, 55, 56, 60], Ab: [51, 55, 58, 60], G7: [50, 53, 55, 60], G7b9: [50, 53, 56, 59] };
  const roots = { Cm9: 36, Fm9: 29, Ab: 32, G7: 31 };
  const loop = ['Cm9', 'Fm9', 'Ab', 'G7'];
  function stabs(c, b, velocity = 1) {
    const second = c === 'G7' ? chords.G7b9 : chords[c];
    for (const [t, chord, v] of [[0, chords[c], 0.8], [sw(0.75), chords[c], 0.62], [sw(2.25), second, 0.74], [3, second, 0.6]]) hit(organ, chord, b + t, 0.2, human(v * velocity));
  }
  function subBar(c, b, { growlOn = false, velocity = 1 } = {}) {
    const r = roots[c];
    for (const [t, length, interval] of [[0, 0.9, 0], [sw(1.75), 0.4, 0], [2.5, 0.5, 12], [sw(3.25), 0.5, 7]]) hit(sub, r + interval, b + t, length, human(0.9 * velocity));
    if (growlOn) for (const [t, interval] of [[0, 0], [sw(0.75), 12], [1.5, 0], [sw(2.25), 10], [3, 12], [sw(3.75), 7]]) hit(growl, r + 12 + interval, b + t, 0.22, human(0.86));
  }
  function twoStep(b, variant, { crashIt = false, light = false, noKick = false } = {}) {
    const kicks = variant ? [0, 2.5, 3.25] : [0, 1.75, 2.5];
    if (!noKick) for (const t of kicks) hit(kick, 36, b + sw(t), 0.25, human(0.92));
    for (const j of [1, 3]) hit(clap, 39, b + j, 0.2, human(0.92));
    for (let x = 0; x < 16; x++) {
      if (x % 4 === 2 && !light) hit(open, 46, b + sw(x / 4), 0.2, human(0.5));
      else if (x % 2 === 1) hit(hat, 42, b + sw(x / 4), 0.08, human(0.55));
      hit(shaker, 70, b + sw(x / 4), 0.06, human(x % 2 ? 0.5 : 0.32));
    }
    for (const t of [0.75, 2.25, 3.75]) hit(rim, 37, b + sw(t), 0.08, human(0.5));
    if (crashIt) hit(crash, 49, b, 1, human(0.85));
  }
  function breakbeat(b, variant) {
    for (const t of variant ? [0, 1.75, 2.5] : [0, 0.5, 2.5]) hit(kick, 36, b + t, 0.25, human(0.94));
    for (const j of [1, 3]) hit(snare, 38, b + j, 0.2, human(0.95));
    for (const t of variant ? [1.75, 3.25, 3.75] : [0.75, 2.25, 3.5]) hit(snare, 38, b + t, 0.1, human(0.32));
    for (let e = 0; e < 8; e++) hit(hat, 42, b + e / 2, 0.08, human(e % 2 ? 0.5 : 0.7));
    hit(open, 46, b + 3.5, 0.2, human(0.6));
  }
  function phrase(p, b, beats, velocity = 0.85) { hit(p, 60, b, beats, velocity); }

  const intro = at.intro;
  loop.forEach((c, i) => {
    const b = bar(intro, i);
    hit(pad, chords[c], b, 3.8, 0.6); stabs(c, b, 0.8);
    for (let x = 0; x < 16; x++) if (x % 2 === 1) hit(hat, 42, b + sw(x / 4), 0.08, human(0.5));
    if (i >= 2) for (const t of [0, 1.75, 2.5]) hit(kick, 36, b + sw(t), 0.25, 0.8);
  });
  phrase(chops, intro.beat, 4); phrase(chops, bar(intro, 2), 4);
  play(glass, 'hook', hook, intro.beat, { velocity: 0.85 });

  for (const id of ['verse', 'verse-two']) {
    const section = at[id];
    for (let i = 0; i < 8; i++) {
      const b = bar(section, i), c = loop[i % 4];
      stabs(c, b); subBar(c, b);
      twoStep(b, i % 2, { crashIt: i === 0, light: id === 'verse' && i < 4 });
      if (id === 'verse-two') { hit(keys, chords[c].map(p => p + 12), b + 1.5, 0.5, 0.52); hit(keys, chords[c].map(p => p + 12), b + sw(3.75), 0.25, 0.42); }
      if (i % 2 === 0) phrase(chops, b, 2, 0.8);
    }
    play(glass, 'answer', answer, section.beat, { repeat: 4, velocity: 0.9 });
  }

  function build(section) {
    loop.forEach((c, i) => {
      const b = bar(section, i);
      hit(pad, chords[c], b, 3.8, 0.55 + i * 0.1); stabs(c, b, 0.85);
      hit(sub, roots[c], b, 3.6, 0.85);
      if (i < 2) for (let j = 0; j < 4; j++) hit(kick, 36, b + j, 0.25, 0.85);
      hit(riser, 60, b, 3.9, 0.3 + i * 0.22);
    });
    const b = section.beat;
    for (const [from, to, step] of [[0, 4, 2], [4, 8, 1], [8, 12, 0.5], [12, 15.5, 0.25]]) for (let t = from; t < to - 1e-9; t += step) phrase(stutter, b + t, step, 0.6 + t * 0.02);
    roll(clap, 39, b + 8, b + 12, 0.5, 0.55, 0.75); roll(clap, 39, b + 12, b + 15.5, 0.25, 0.7, 1, 0.1);
  }
  function drop(section, bars) {
    for (let i = 0; i < bars; i++) {
      const b = bar(section, i), c = loop[i % 4];
      stabs(c, b); subBar(c, b, { growlOn: i % 4 === 3 });
      twoStep(b, i % 2, { crashIt: i % 4 === 0 });
      phrase(chops, b, 4, 0.9);
    }
    play(glass, 'hook', hook, section.beat, { repeat: 2 });
    if (bars > 8) play(glass, 'hook-high', hookHigh, bar(section, 8));
  }
  build(at.build); drop(at.drop, 8);

  // Breakbeat detour: busier drums, growling bass and stuttered syllables over the pad.
  const brk = at.break;
  for (let i = 0; i < 8; i++) {
    const b = bar(brk, i), c = loop[i % 4];
    breakbeat(b, i % 2);
    subBar(c, b, { growlOn: true, velocity: 0.9 });
    hit(pad, chords[c], b, 3.8, 0.55);
    if (i % 2 === 1) phrase(stutter, b + 2, 2, 0.8);
    if (i === 3 || i === 7) [[2, 50], [2.25, 50], [2.5, 47], [2.75, 47], [3, 43], [3.25, 43], [3.5, 41], [3.75, 41]].forEach(([t, p], k) => hit(snare, 38, b + t, 0.1, 0.4 + k * 0.07));
    if (i === 0 || i === 4) hit(crash, 49, b, 1, 0.8);
  }
  build(at['build-two']); drop(at['drop-two'], 12);

  // Outro: groove, the phrase alone, then one last minor-ninth stab.
  const outro = at.outro;
  for (let i = 0; i < 2; i++) { const b = bar(outro, i), c = loop[i]; stabs(c, b); subBar(c, b); twoStep(b, i % 2, { crashIt: i === 0 }); phrase(chops, b, 4, 0.9); }
  const gap = bar(outro, 2);
  phrase(chops, gap, 4, 0.95); for (let x = 0; x < 16; x++) if (x % 2 === 1) hit(hat, 42, gap + sw(x / 4), 0.08, 0.45);
  const last = bar(outro, 3);
  hit(organ, chords.Cm9, last, 0.5, 0.75); hit(keys, chords.Cm9.map(p => p + 12), last, 2.5, 0.6); hit(pad, chords.Cm9, last, 3, 0.7);
  hit(sub, 36, last, 2.5, 0.85); hit(glass, ['C5', 'G5', 'C6'], last, 1.5, 0.75);
  hit(kick, 36, last, 0.25, 0.85); hit(clap, 39, last, 0.2, 0.9); hit(crash, 49, last, 1, 0.9);
  return s;
}

// 8 ─ Focused deep house ────────────────────────────────────────────────────
function deepWorkCircuit(seed) {
  const { s, at, part, human, bar } = begin(seed, {
    id: 'deep-work-circuit', title: 'Deep Work Circuit', genre: 'Deep house (focus)', mood: 'Focused, steady, quietly propulsive', key: 'G minor', bpm: 122,
    description: 'A work groove with deliberately low melodic density: a three-note pluck motif answers syncopated minor-ninth stabs over a rolling bass and crisp four-on-the-floor. A ride-driven lift, a kick-less breakdown and a full return keep it moving without crowding your thoughts.',
    volume: 1.08, reverb: 0.16, sleeve: 'constellation', colors: ['#16201e', '#7de3c3', '#e9fff8'], inks: ['#7de3c3', '#e9fff8', '#ffc857', '#a0c4ff', '#ff8fa3'],
  }, [
    ['intro', 'Log in', 4], ['groove', 'Flow state', 16], ['lift', 'Second wind', 8], ['breakdown', 'Clear head', 8], ['build', 'Refocus', 4], ['drop', 'Deep work', 16], ['outro', 'Log off', 6],
  ]);
  const pluck = part('pluck', 'Three-note hook', 'pluck', 2, 0.14, { brightness: 3600, release: 0.32 });
  const stabs = part('stabs', 'Minor-ninth stabs', 'electric-piano', 0.62, -0.16, { brightness: 2400 });
  const bell = part('bell', 'Focus bell', 'bell', 1.8, 0.32, { release: 1.6 });
  const pad = part('pad', 'Breakdown pad', 'pad', 0.85, -0.08, { brightness: 1500, attack: 1.2, release: 2, detune: 12 });
  const bass = part('bass', 'Rolling bass', 'bass', 0.75);
  const kick = part('kick', 'Kick', 'kick', 0.72);
  const clap = part('clap', 'Clap', 'clap', 1.9, 0.04);
  const hat = part('hat', 'Sixteenth hats', 'hi-hat', 1.8, 0.26);
  const open = part('open-hat', 'Offbeat open hat', 'open-hat', 1.2, -0.26);
  const ride = part('ride', 'Ride', 'ride', 0.85, 0.36);
  const shaker = part('shaker', 'Shaker', 'shaker', 1.8, -0.38);
  const crash = part('crash', 'Crash', 'crash', 0.55, 0.12);
  const riser = part('riser', 'Riser', 'noise', 1.4, 0, { brightness: 4200, attack: 3, release: 0.3 });

  const hook = riff(8, [['D5', 0.5, 0.3, 0.85], ['F5', 1.25, 0.3, 0.9], ['C5', 2, 0.6, 0.82], ['Bb4', 4.5, 0.3, 0.82], ['D5', 5.25, 0.3, 0.86], ['A4', 6, 0.9, 0.8]]);
  const counter = riff(32, [['A5', 0, 3, 0.55], ['F5', 8, 3, 0.52], ['G5', 16, 3, 0.55], ['D5', 24, 3, 0.52]]);
  const chords = { Gm9: [58, 62, 65, 69], Eb: [55, 58, 62, 65], Bb: [57, 60, 62, 65], F: [57, 60, 62, 67] };
  const roots = { Gm9: 31, Eb: 39, Bb: 34, F: 41 };
  const loop = ['Gm9', 'Eb', 'Bb', 'F'];
  const stabRhythm = [[[0.5, 0.3, 0.72], [1.25, 0.25, 0.6], [2.5, 0.4, 0.68]], [[0, 0.3, 0.7], [0.75, 0.25, 0.58], [2, 0.25, 0.62], [3.25, 0.3, 0.66]]];
  function stabBar(c, b, i, velocity = 1) { for (const [t, length, v] of stabRhythm[i % 2]) hit(stabs, chords[c], b + t, length, human(v * velocity, 0.03)); }
  function bassBar(c, b, velocity = 1) {
    for (const [t, length, interval, v] of [[0, 0.45, 0, 0.92], [0.75, 0.2, 12, 0.7], [1.5, 0.45, 0, 0.84], [2.5, 0.45, 0, 0.86], [2.75, 0.2, 10, 0.68], [3.5, 0.4, 7, 0.78]]) hit(bass, roots[c] + interval, b + t, length, human(v * velocity, 0.03));
  }
  function house(b, { clapOn = true, rideOn = false, crashIt = false, kickOn = true, fill = false } = {}) {
    for (let j = 0; j < 4; j++) {
      if (kickOn) hit(kick, 36, b + j, 0.25, human(0.95, 0.02));
      hit(open, 46, b + j + 0.5, 0.2, human(0.5));
      if (rideOn) hit(ride, 51, b + j, 0.2, human(0.6));
    }
    if (clapOn) for (const j of [1, 3]) hit(clap, 39, b + j, 0.2, human(0.82));
    for (let x = 0; x < 16; x++) { if (x % 4 !== 2) hit(hat, 42, b + x / 4, 0.06, human(x % 2 ? 0.36 : 0.5)); hit(shaker, 70, b + x / 4, 0.06, human(x % 2 ? 0.45 : 0.3)); }
    if (fill) roll(clap, 39, b + 3, b + 4, 0.25, 0.45, 0.75, 0.1);
    if (crashIt) hit(crash, 49, b, 1, human(0.7));
  }

  const intro = at.intro;
  loop.forEach((c, i) => { const b = bar(intro, i); house(b, { clapOn: i >= 2 }); if (i >= 2) stabBar(c, b, i, 0.85); });
  play(pluck, 'hook', hook, intro.beat, { repeat: 2, velocity: 0.9 });
  for (const id of ['groove', 'lift', 'drop']) {
    const section = at[id], bars = section.beats / 4;
    for (let i = 0; i < bars; i++) {
      const b = bar(section, i), c = loop[i % 4];
      stabBar(c, b, i); bassBar(c, b);
      house(b, { rideOn: id !== 'groove', crashIt: i % 8 === 0, fill: i % 8 === 7 });
    }
    play(pluck, 'hook', hook, section.beat, { repeat: bars / 2 });
    if (id !== 'groove') play(bell, 'counter', counter, section.beat, { repeat: bars / 8 });
    if (id === 'groove') play(bell, 'counter', counter, bar(section, 8));
  }

  // Breakdown: no kick, long chords and the motif at half speed, then the bass returns.
  const down = at.breakdown;
  loop.concat(loop).forEach((c, i) => {
    const b = bar(down, i);
    hit(pad, chords[c], b, 3.9, 0.62 + i * 0.03);
    hit(stabs, chords[c], b, 1.6, 0.45);
    if (i >= 4) { bassBar(c, b, 0.8); for (const j of [1, 3]) hit(clap, 39, b + j, 0.2, 0.5 + (i - 4) * 0.08); }
    for (let x = 0; x < 16; x++) if (x % 2 === 1 || i >= 4) hit(hat, 42, b + x / 4, 0.06, 0.25 + i * 0.03);
  });
  play(bell, 'slow-hook', transformPattern(hook, { timeScale: 2 }), down.beat, { repeat: 2, velocity: 0.85 });
  const build = at.build;
  loop.forEach((c, i) => {
    const b = bar(build, i);
    hit(pad, chords[c], b, 3.9, 0.75); stabBar(c, b, i, 0.9); bassBar(c, b, 0.85);
    for (let j = 0; j < (i === 3 ? 3 : 4); j++) hit(kick, 36, b + j, 0.25, 0.6 + i * 0.1);
    for (let x = 0; x < 16; x++) hit(hat, 42, b + x / 4, 0.06, 0.35 + i * 0.08);
    hit(riser, 60, b, 3.9, 0.3 + i * 0.22);
  });
  roll(clap, 39, bar(build, 2), bar(build, 3), 0.5, 0.5, 0.7); roll(clap, 39, bar(build, 3), bar(build, 3) + 3.5, 0.25, 0.65, 1, 0.1);
  play(pluck, 'hook', hook, build.beat, { repeat: 2, velocity: 0.85 });

  const outro = at.outro;
  loop.forEach((c, i) => { const b = bar(outro, i); bassBar(c, b); house(b, { rideOn: i < 2, crashIt: i === 0 }); if (i < 2) stabBar(c, b, i); });
  play(pluck, 'hook', hook, outro.beat);
  const last = bar(outro, 4);
  hit(stabs, chords.Gm9, last, 3, 0.75); hit(pad, chords.Gm9, last, 3.5, 0.6); hit(bass, 31, last, 2.5, 0.9);
  [['D5', 0.5], ['F5', 1.25], ['G5', 2]].forEach(([p, t], k) => hit(pluck, p, last + t, k === 2 ? 1.5 : 0.4, 0.85));
  hit(kick, 36, last, 0.25, 0.95); hit(crash, 49, last, 1, 0.75); hit(bell, 'G5', last + 2, 1.2, 0.55);
  return s;
}

// 9 ─ Liquid drum-and-bass ─────────────────────────────────────────────────
function rainlineRunner(seed) {
  const { s, at, part, human, bar } = begin(seed, {
    id: 'rainline-runner', title: 'Rainline Runner', genre: 'Liquid drum and bass (focus)', mood: 'Fast, clear-headed, luminous', key: 'A major', bpm: 174,
    description: 'Rolling two-step breaks at 174 BPM under lush major-ninth chords, a detuned reese and a deep sub. The melody is a sparse bell line that leaves room to think; a roller section, a drumless interlude and a second drop with a soft counter-line keep the momentum before a hard final chord.',
    volume: 0.97, reverb: 0.18, sleeve: 'wave', colors: ['#062a33', '#46d1c4', '#c9b8ff'], inks: ['#46d1c4', '#c9b8ff', '#f9f871', '#ff9671', '#e8f6ff'],
  }, [
    ['intro', 'First drops', 8], ['build', 'Platform', 4], ['drop', 'Rainline', 16], ['roller', 'Express', 8], ['interlude', 'Window glass', 12],
    ['build-two', 'Platform', 4], ['drop-two', 'Rainline', 16], ['outro', 'Terminal', 8],
  ]);
  const bell = part('bell', 'Rain bell hook', 'bell', 2, 0.18, { release: 1.8 });
  const lead = part('lead', 'Soft counter-lead', 'analog-lead', 1.7, -0.16, { brightness: 2800, attack: 0.03, release: 0.3, detune: 6 });
  const keys = part('keys', 'Liquid keys', 'electric-piano', 0.55, -0.22, { brightness: 3000 });
  const strings = part('strings', 'String bed', 'strings', 1.05, 0.2, { brightness: 2600, attack: 0.6, release: 1.4, detune: 12 });
  const reese = part('reese', 'Reese bass', 'analog-lead', 1.8, 0, { brightness: 800, attack: 0.01, release: 0.15, detune: 28 });
  const sub = part('sub', 'Sub', 'bass', 0.65);
  const kick = part('kick', 'Kick', 'rock-kick', 0.64);
  const snare = part('snare', 'Snare', 'rock-snare', 0.9, 0.04);
  const hat = part('hat', 'Hats', 'hi-hat', 1.9, 0.3);
  const ride = part('ride', 'Ride', 'ride', 0.8, -0.32);
  const shaker = part('shaker', 'Shaker', 'shaker', 1.6, -0.36);
  const crash = part('crash', 'Crash', 'crash', 0.6, 0.18);
  const riser = part('riser', 'Riser', 'noise', 1.4, 0, { brightness: 5200, attack: 3, release: 0.3 });

  const hookRows = [
    ['E5', 0, 1.4, 0.82], ['C#5', 1.5, 0.45, 0.74], ['E5', 2, 0.45, 0.78], ['F#5', 2.5, 1.4, 0.86], ['E5', 4, 2.9, 0.8],
    ['G#5', 8, 1.4, 0.86], ['E5', 9.5, 0.45, 0.76], ['C#5', 10, 1.9, 0.8], ['B4', 12, 2.9, 0.78],
    ['A5', 16, 1.4, 0.88], ['G#5', 17.5, 0.45, 0.8], ['E5', 18, 0.9, 0.8], ['C#5', 19, 0.9, 0.78], ['B4', 20, 2.9, 0.78],
    ['A4', 24, 0.9, 0.76], ['B4', 25, 0.9, 0.78], ['C#5', 26, 1.9, 0.82], ['E5', 28, 2.9, 0.84],
  ];
  const hook = riff(32, hookRows);
  const counter = riff(32, [['C#4', 0, 3.4, 0.78], ['B3', 4, 3.4, 0.74], ['E4', 8, 3.4, 0.8], ['D#4', 12, 1.9, 0.76], ['E4', 14, 1.9, 0.78], ['F#4', 16, 3.4, 0.82], ['E4', 20, 3.4, 0.78], ['A4', 24, 3.4, 0.84], ['G#4', 28, 3.4, 0.82]]);
  const chords = { A: [57, 61, 64, 68, 71], 'C#m': [56, 59, 64, 68], 'F#m': [57, 61, 64, 68], D: [54, 57, 61, 64] };
  const roots = { A: 33, 'C#m': 37, 'F#m': 30, D: 38 };
  const loop = ['A', 'C#m', 'F#m', 'D'];
  const chordAt = i => loop[Math.floor(i / 2) % 4];
  function harmony(c, b, i, { stabsOn = true, stringsOn = true } = {}) {
    if (i % 2 === 0) {
      if (stringsOn) hit(strings, chords[c], b, 7.6, 0.6);
      hit(keys, chords[c], b, 1.4, 0.62);
    }
    if (stabsOn) for (const [t, length, v] of i % 2 ? [[0.5, 0.5, 0.5], [2.5, 0.9, 0.55]] : [[1.75, 0.5, 0.5], [3, 0.6, 0.48]]) hit(keys, chords[c], b + t, length, human(v));
  }
  function low(c, b, i, { reeseOn = true, busy = false } = {}) {
    const r = roots[c];
    if (i % 2 === 0) hit(sub, r, b, 7.5, 0.9);
    if (!reeseOn) return;
    const rhythm = busy ? [[0, 0.45, 12], [0.5, 0.45, 12], [1.5, 0.45, 19], [2, 0.9, 12], [3, 0.45, 15], [3.5, 0.45, 12]] : [[0, 1.4, 12], [1.5, 0.4, 12], [2.5, 1.2, i % 2 ? 19 : 12]];
    for (const [t, length, interval] of rhythm) hit(reese, r + interval, b + t, length, human(0.82));
  }
  function breaks(b, i, { rideOn = false, crashIt = false, half = false } = {}) {
    if (half) { hit(kick, 36, b, 0.25, human(0.92)); hit(snare, 38, b + 2, 0.2, human(0.92)); }
    else {
      for (const t of i % 2 ? [0, 1.75, 2.5] : [0, 2.5]) hit(kick, 36, b + t, 0.25, human(0.94));
      for (const j of [1, 3]) hit(snare, 38, b + j, 0.2, human(0.96, 0.03));
      for (const t of i % 2 ? [1.75, 3.5] : [0.75, 2.25, 3.75]) hit(snare, 38, b + t, 0.1, human(0.24, 0.04));
    }
    for (let e = 0; e < 8; e++) hit(rideOn ? ride : hat, rideOn ? 51 : 42, b + e / 2, 0.1, human(e % 2 ? 0.42 : 0.62));
    for (let x = 0; x < 16; x++) hit(shaker, 70, b + x / 4, 0.06, human(x % 2 ? 0.42 : 0.28));
    if (crashIt) hit(crash, 49, b, 1, human(0.8));
  }

  const intro = at.intro;
  for (let i = 0; i < 8; i++) {
    const b = bar(intro, i), c = chordAt(i);
    harmony(c, b, i, { stabsOn: i >= 4 }); low(c, b, i, { reeseOn: false });
    if (i >= 4) breaks(b, i, { half: true });
    else for (let e = 0; e < 8; e++) hit(hat, 42, b + e / 2, 0.08, human(e % 2 ? 0.3 : 0.45));
  }
  play(bell, 'hook', hook, intro.beat);

  function build(section) {
    for (let i = 0; i < 4; i++) {
      const b = bar(section, i), c = chordAt(i + 6);
      harmony(c, b, i, { stabsOn: false }); hit(sub, roots[c], b, 3.6, 0.8);
      hit(reese, roots[c] + 12, b, 3.6, 0.5 + i * 0.12);
      for (let j = 0; j < (i === 3 ? 2 : 4); j++) hit(kick, 36, b + j, 0.25, 0.85);
      hit(riser, 60, b, 3.9, 0.3 + i * 0.22);
    }
    const b = section.beat;
    roll(snare, 38, b, b + 8, 0.5, 0.35, 0.6); roll(snare, 38, b + 8, b + 12, 0.25, 0.55, 0.8, 0.1); roll(snare, 38, b + 12, b + 15, 0.125, 0.7, 1, 0.08);
    play(bell, 'hook-tail', riff(16, hookRows.filter(([, t]) => t >= 24).map(([p, t, d, v]) => [p, t - 16, d, v])), section.beat);
  }
  function drop(section, { second = false } = {}) {
    for (let i = 0; i < 16; i++) {
      const b = bar(section, i), c = chordAt(i);
      harmony(c, b, i); low(c, b, i);
      breaks(b, i, { rideOn: second && i >= 8, crashIt: i % 8 === 0 });
    }
    play(bell, 'hook', hook, section.beat, { repeat: 2 });
    if (second) play(lead, 'counter', counter, section.beat, { repeat: 2 });
  }
  build(at.build); drop(at.drop);

  const roller = at.roller;
  for (let i = 0; i < 8; i++) {
    const b = bar(roller, i), c = chordAt(i);
    harmony(c, b, i); low(c, b, i, { busy: true });
    breaks(b, i, { rideOn: true, crashIt: i === 0 });
    [0, 2, 1, 3, 2, 0, 3, 1].forEach((k, x) => hit(keys, chords[c][k] + 12, b + x / 2, 0.3, human(0.38)));
  }
  // Interlude: the drums step away; strings, keys and the counter-line carry the hook's shape.
  const inter = at.interlude;
  for (let i = 0; i < 12; i++) {
    const b = bar(inter, i), c = chordAt(i);
    harmony(c, b, i, { stabsOn: i >= 8 }); low(c, b, i, { reeseOn: i >= 8 });
    if (i >= 8) breaks(b, i, { half: true });
    else if (i >= 4) for (let e = 0; e < 8; e++) hit(hat, 42, b + e / 2, 0.08, human(e % 2 ? 0.3 : 0.42));
  }
  play(lead, 'counter', counter, inter.beat, { velocity: 0.95 });
  play(bell, 'hook', hook, bar(inter, 4), { velocity: 0.9 });
  build(at['build-two']); drop(at['drop-two'], { second: true });

  const outro = at.outro;
  for (let i = 0; i < 6; i++) {
    const b = bar(outro, i), c = chordAt(i);
    harmony(c, b, i); low(c, b, i, { reeseOn: i < 4 });
    breaks(b, i, { crashIt: i === 0, half: i >= 4 });
  }
  play(bell, 'hook-head', riff(16, hookRows.filter(([, t]) => t < 16)), outro.beat);
  const last = bar(outro, 6);
  hit(strings, chords.A, last, 3.5, 0.7); hit(keys, chords.A, last, 3, 0.55); hit(sub, 33, last, 3, 0.75); hit(reese, 45, last + 0.5, 1, 0.65);
  hit(bell, ['E5', 'A5'], last, 2, 0.75); hit(kick, 36, last, 0.25, 0.78); hit(crash, 49, last, 1, 0.9);
  return s;
}

// 10 ─ Electroclash / hyperpop finale ───────────────────────────────────────
function pixelRiot(seed) {
  const { s, at, part, human, strum, bar } = begin(seed, {
    id: 'pixel-riot', title: 'Pixel Riot', genre: 'Hyperpop electroclash', mood: 'Hyper, glittering, defiant', key: 'B minor', bpm: 160,
    description: 'A sequenced octave-leaping hook over half-time trap hats and an electro acid bass, with a bundled spoken phrase run through a vocoder and chopped into pitched rhythm: robotic texture, not singing. The drops slam in pop-punk power chords, chip arpeggios and a full-speed beat; a glitch bridge stutters before the final drop, a hard stop and one last vocoded phrase.',
    volume: 0.75, reverb: 0.12, sleeve: 'orbit', colors: ['#0d0221', '#c6ff00', '#ff2e97'], inks: ['#c6ff00', '#ff2e97', '#00e5ff', '#ffffff', '#ffb000'],
  }, [
    ['intro', 'Boot sequence', 4], ['verse', 'Static', 8], ['pre', 'Overclock', 4], ['drop', 'Pixel riot', 8], ['verse-two', 'Glitch city', 8],
    ['pre-two', 'Overclock', 4], ['drop-two', 'Pixel riot', 8], ['bridge', 'Buffer underrun', 8], ['final', 'Full brightness', 12], ['ending', 'Power off', 3],
  ]);
  const hyper = part('hyper', 'Hyper lead', 'analog-lead', 2, 0, { brightness: 7500, attack: 0.004, release: 0.12, detune: 22 });
  const chip = part('chip', 'Chip pluck double', 'pluck', 1.6, 0.16, { brightness: 7000, release: 0.18 });
  const arp = part('arp', 'Glitter arpeggio', 'fm-lead', 1, -0.3, { brightness: 8000, attack: 0.003, release: 0.08 });
  const acid = part('acid', 'Electro acid bass', 'acid-bass', 1.45, 0, { brightness: 2400, release: 0.18 });
  const sub = part('sub', '808 sub', 'bass', 0.8);
  const left = part('guitar-left', 'Power guitar left', 'guitar-crunch', 0.6, -0.7, { drive: 0.9, palmMute: 0.15, brightness: 5000, release: 0.5 });
  const right = part('guitar-right', 'Power guitar right', 'guitar-crunch', 0.58, 0.7, { drive: 0.95, palmMute: 0.15, brightness: 5400, release: 0.5 });
  const pad = part('pad', 'Glitch pad', 'pad', 0.8, 0, { brightness: 2600, attack: 0.3, release: 1, detune: 18 });
  const vocoder = part('vocoder', 'Vocoder phrase', 'sample', 0.95, 0.05);
  vocoder.sample = { asset: 'builtin:let-it-change', effect: 'vocoder', pitch: 'B3' };
  const chops = part('chops', 'Pitched chops', 'sample', 0.68, 0.22);
  chops.sample = { asset: 'builtin:in-the-rhythm', effect: 'chop', semitones: 12, pattern: [0, 1, null, 1, 2, 3, null, 3] };
  const kick = part('kick', 'Kick', 'kick', 0.85);
  const snare = part('snare', 'Snare', 'rock-snare', 0.85, 0.04);
  const clap = part('clap', 'Clap', 'clap', 1.8, -0.04);
  const hat = part('hat', 'Trap hats', 'hi-hat', 1.9, 0.28);
  const open = part('open-hat', 'Open hat', 'open-hat', 1.1, -0.28);
  const crash = part('crash', 'Crash', 'crash', 0.7, 0.16);
  const riser = part('riser', 'Riser', 'noise', 1.5, 0, { brightness: 6000, attack: 3, release: 0.3 });

  const hookRows = [
    ['B4', 0, 0.25, 0.86], ['D5', 0.25, 0.25, 0.84], ['F#5', 0.5, 0.5, 0.9], ['B5', 1, 0.5, 0.96], ['A5', 1.5, 0.25, 0.84], ['F#5', 1.75, 0.25, 0.82], ['A5', 2, 0.5, 0.9], ['F#5', 2.5, 0.25, 0.84], ['E5', 2.75, 0.25, 0.82], ['D5', 3, 0.75, 0.88],
    ['E5', 4, 0.25, 0.86], ['G5', 4.25, 0.25, 0.84], ['B5', 4.5, 0.5, 0.9], ['E6', 5, 0.5, 0.97], ['D6', 5.5, 0.25, 0.86], ['B5', 5.75, 0.25, 0.84], ['A5', 6, 0.5, 0.9], ['G5', 6.5, 0.25, 0.84], ['F#5', 6.75, 0.25, 0.82], ['E5', 7, 0.75, 0.88],
    ['D5', 8, 0.25, 0.86], ['G5', 8.25, 0.25, 0.84], ['B5', 8.5, 0.5, 0.9], ['D6', 9, 0.5, 0.96], ['B5', 9.5, 0.25, 0.84], ['A5', 9.75, 0.25, 0.82], ['B5', 10, 0.5, 0.9], ['G5', 10.5, 0.25, 0.84], ['F#5', 10.75, 0.25, 0.82], ['G5', 11, 0.75, 0.88],
    ['A#5', 12, 0.5, 0.92], ['C#6', 12.5, 0.5, 0.94], ['F#6', 13, 1, 1], ['E6', 14, 0.5, 0.92], ['C#6', 14.5, 0.5, 0.9], ['A#5', 15, 0.75, 0.9],
  ];
  const hook = riff(16, hookRows);
  const hookStack = pattern(16, hook.notes.flatMap(n => [n, { ...n, pitch: n.pitch - 12, velocity: level(n.velocity * 0.75) }]));
  const verseBlips = riff(8, [['F#5', 0.75, 0.2, 0.78], ['B5', 1.25, 0.2, 0.82], ['A5', 2.75, 0.2, 0.78], ['F#5', 3.5, 0.4, 0.8], ['D5', 4.75, 0.2, 0.76], ['E5', 5.25, 0.2, 0.8], ['F#5', 6.5, 0.9, 0.84]]);
  const tones = { Bm: [59, 62, 66], Em: [59, 64, 67], G: [59, 62, 67], 'F#': [58, 61, 66], A: [57, 61, 64] };
  const roots = { Bm: 35, Em: 28, G: 31, 'F#': 30, A: 33 };
  const powerRoot = { Bm: 47, Em: 40, G: 43, 'F#': 42, A: 45 };
  const dropLoop = ['Bm', 'Em', 'G', 'F#'];

  function acidBar(c, b, velocity = 1) {
    const r = roots[c] + 12, shape = c.endsWith('m') ? [0, 12, 0, 12, 0, 10, 12, 15] : [0, 12, 0, 12, 0, 7, 12, 16];
    shape.forEach((interval, e) => hit(acid, r + interval, b + e / 2, 0.3, human([1, 0.7, 0.9, 0.7, 1, 0.7, 0.8, 0.75][e] * 0.9 * velocity)));
  }
  function trap(b, i, { crashIt = false } = {}) {
    for (const t of i % 2 ? [0, 1.75, 2.5] : [0, 0.75, 2.5, 3.5]) hit(kick, 36, b + t, 0.25, human(0.95));
    hit(snare, 38, b + 2, 0.2, human(0.95)); hit(clap, 39, b + 2, 0.2, human(0.9));
    for (let e = 0; e < 8; e++) hit(hat, 42, b + e / 2, 0.06, human(e % 2 ? 0.5 : 0.68));
    const rollAt = i % 2 ? 3 : 1.5;
    for (let k = 1; k < (i % 4 === 3 ? 6 : 3); k++) hit(hat, 42, b + rollAt + k / 6, 0.04, human(0.42 + k * 0.05));
    if (crashIt) hit(crash, 49, b, 1, human(0.85));
  }
  function fullBeat(b, i, { crashIt = false, fill = false } = {}) {
    for (const t of [0, 1.5, 2.5]) hit(kick, 36, b + t, 0.25, human(0.96, 0.03));
    for (const j of [1, 3]) { if (!(fill && j === 3)) { hit(snare, 38, b + j, 0.2, human(0.97, 0.03)); hit(clap, 39, b + j, 0.2, human(0.9)); } }
    for (let e = 0; e < 8; e++) hit(e % 2 ? open : hat, e % 2 ? 46 : 42, b + e / 2, 0.08, human(e % 2 ? 0.5 : 0.62));
    if (fill) roll(snare, 38, b + 2.5, b + 4, 0.125, 0.55, 1, 0.08);
    if (crashIt) hit(crash, 49, b, 1, human(0.92));
  }
  function guitars(c, b, { count = 8, mute = false, velocity = 1 } = {}) {
    for (let e = 0; e < count; e++) {
      const chord = mute ? power(powerRoot[c], false) : power(powerRoot[c]), length = mute ? 0.28 : 0.42, v = human((e % 2 ? 0.8 : 0.95) * velocity);
      strum(left, chord, b + e / 2, length, v, { ms: 6 }); strum(right, chord, b + e / 2 + 0.012, length, v * 0.96, { ms: 6 });
    }
  }
  function glitter(c, b) { [0, 1, 2, 1, 2, 0, 1, 2, 0, 2, 1, 2, 0, 1, 2, 1].forEach((k, x) => hit(arp, tones[c][k] + 24, b + x / 4, 0.12, human(x % 4 === 0 ? 0.62 : 0.45))); }
  const voice = (b, beats = 2.5, velocity = 0.9) => hit(vocoder, 60, b, beats, velocity);

  const intro = at.intro;
  ['Bm', 'Em', 'G', 'F#'].forEach((c, i) => {
    const b = bar(intro, i);
    hit(pad, tones[c], b, 3.8, 0.7); hit(sub, roots[c], b, 3.5, 0.8);
    for (let x = 0; x < 16; x++) hit(hat, 42, b + x / 4, 0.04, human(x % 2 ? 0.35 : 0.5));
    if (i === 3) roll(snare, 38, b + 2, b + 4, 0.125, 0.45, 0.95, 0.08);
  });
  play(hyper, 'hook', hook, intro.beat, { velocity: 0.9 }); play(chip, 'hook', hook, intro.beat, { velocity: 0.8 });
  voice(intro.beat + 0.5, 2.5, 0.7);

  for (const id of ['verse', 'verse-two']) {
    const section = at[id];
    ['Bm', 'Bm', 'G', 'A', 'Bm', 'Bm', 'G', 'A'].forEach((c, i) => {
      const b = bar(section, i);
      acidBar(c, b); hit(sub, roots[c], b, 1.8, 0.85); hit(sub, roots[c], b + 2.5, 1.2, 0.8);
      trap(b, i, { crashIt: i === 0 });
      if (i % 2 === 0) voice(b);
      if (id === 'verse-two') { hit(chops, 60, b, 4, 0.82); hit(pad, tones[c], b, 3.8, 0.45); }
    });
    play(arp, 'verse-blips', verseBlips, section.beat, { repeat: 4, velocity: 0.9 });
  }
  function pre(section) {
    ['G', 'A', 'F#', 'F#'].forEach((c, i) => {
      const b = bar(section, i);
      guitars(c, b, { mute: i < 3, velocity: 0.75 + i * 0.08, count: i === 3 ? 6 : 8 });
      hit(pad, tones[c], b, 3.8, 0.6 + i * 0.1); hit(sub, roots[c], b, 3.5, 0.85);
      for (let j = 0; j < (i === 3 ? 3 : 4); j++) hit(kick, 36, b + j, 0.25, 0.9);
      hit(riser, 60, b, 3.9, 0.3 + i * 0.22);
    });
    const b = section.beat;
    roll(snare, 38, b, b + 8, 0.5, 0.4, 0.65); roll(snare, 38, b + 8, b + 12, 0.25, 0.6, 0.8, 0.1); roll(snare, 38, b + 12, b + 15, 0.125, 0.7, 1, 0.06);
    play(hyper, 'climb', riff(16, [['D5', 0, 0.9, 0.82], ['E5', 1, 0.9, 0.84], ['G5', 2, 1.9, 0.88], ['E5', 4, 0.9, 0.84], ['F#5', 5, 0.9, 0.86], ['A5', 6, 1.9, 0.9], ['A#5', 8, 1.9, 0.92], ['C#6', 10, 1.9, 0.94], ['F#6', 12, 2.6, 1]]), section.beat);
  }
  function drop(section, bars) {
    for (let i = 0; i < bars; i++) {
      const b = bar(section, i), c = dropLoop[i % 4];
      guitars(c, b); glitter(c, b);
      hit(sub, roots[c], b, 1.9, 0.9); hit(sub, roots[c], b + 2.5, 1.3, 0.85);
      fullBeat(b, i, { crashIt: i % 4 === 0, fill: i % 8 === 7 });
      hit(chops, 60, b, 4, 0.8);
    }
    play(hyper, 'hook-stack', hookStack, section.beat, { repeat: bars / 4 });
    play(chip, 'hook', hook, section.beat, { repeat: bars / 4 });
  }
  pre(at.pre); drop(at.drop, 8);
  pre(at['pre-two']); drop(at['drop-two'], 8);

  // Glitch bridge: half-time, the hook at half speed, then the chops stutter faster and faster.
  const bridge = at.bridge;
  dropLoop.concat(dropLoop).forEach((c, i) => {
    const b = bar(bridge, i);
    hit(pad, tones[c], b, 3.8, 0.7); hit(sub, roots[c], b, 3.5, 0.85);
    hit(kick, 36, b, 0.25, 0.9); hit(snare, 38, b + 2, 0.2, 0.9); hit(clap, 39, b + 2, 0.2, 0.85);
    for (let e = 0; e < 8; e++) hit(hat, 42, b + e / 2, 0.06, human(0.45));
    if (i < 4) { if (i % 2 === 0) voice(b, 2.5, 0.85); }
    else { const step = [1, 0.5, 0.25, 0.125][i - 4]; for (let t = 0; t < 4 - 1e-9; t += step) hit(chops, 60, b + t, step, 0.55 + (i - 4) * 0.1); acidBar(c, b, 0.6 + (i - 4) * 0.1); }
  });
  play(chip, 'slow-hook', transformPattern(hook, { timeScale: 2 }), bridge.beat, { velocity: 0.85 });
  hit(riser, 60, bar(bridge, 6), 7.9, 0.8);

  drop(at.final, 8);
  const tag = bar(at.final, 8);
  ['G', 'F#', 'G', 'F#'].forEach((c, i) => {
    const b = tag + i * 4;
    guitars(c, b); glitter(c, b); hit(sub, roots[c], b, 3.6, 0.9);
    fullBeat(b, i, { crashIt: true, fill: i === 3 });
    hit(chops, 60, b, 4, 0.85);
  });
  const tagHook = riff(8, hookRows.filter(([, t]) => t >= 8).map(([p, t, d, v]) => [p, t - 8, d, v]));
  play(hyper, 'hook-tag', pattern(8, tagHook.notes.flatMap(n => [n, { ...n, pitch: n.pitch - 12, velocity: level(n.velocity * 0.75) }])), tag, { repeat: 2 });
  play(chip, 'hook-tag', tagHook, tag, { repeat: 2 });

  // Ending: the hook head glitches on itself, then everything hits one B minor and stops.
  const end = at.ending;
  for (let k = 0; k < 4; k++) for (const [p, t] of [['B4', 0], ['D5', 0.25], ['F#5', 0.5], ['B5', 0.75]]) hit(hyper, p, end.beat + k + t, 0.2, 0.85 + k * 0.03);
  for (let x = 0; x < 16; x++) hit(hat, 42, end.beat + x / 4, 0.04, 0.4 + x * 0.03);
  roll(snare, 38, end.beat + 2, end.beat + 4, 0.125, 0.5, 1, 0.06);
  const last = bar(end, 1);
  strum(left, power(47), last, 3, 1); strum(right, power(47), last + 0.012, 3, 1);
  hit(hyper, ['B4', 'F#5', 'B5'], last, 2.6, 0.92); hit(pad, [59, 62, 66, 73], last, 3, 0.75); hit(sub, 35, last, 3, 0.75);
  hit(kick, 36, last, 0.25, 0.8); hit(crash, 49, last, 1, 0.95); voice(last + 4, 2.5, 0.8);
  return s;
}

// @@tracks

/** Ten original built-in pieces, clearly labeled as examples rather than personalized music. */
export function buildVarietyCollection({ seed = 21 } = {}) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new TypeError('seed must be a uint32 integer.');
  const tracks = [hotwireBoogie, rooftopRiot, northboundLights, neonConfetti, mirrorballShift, goldenHourAvenue, nightBusTwoStep, deepWorkCircuit, rainlineRunner, pixelRiot].map(build => {
    const score = build(seed);
    // Leave room to turn a part up in the studio. Preserve relative balances,
    // compensate the master, and trim for the compressor's reduced input level.
    const scale = 1.25 / Math.max(...score.parts.map(p => p.volume));
    for (const part of score.parts) part.volume *= scale;
    score.master.volume = score.master.volume / scale * 0.9;
    return score;
  });
  return {
    collection: {
      version: 1, id: 'turn-it-up', title: 'Turn It Up', source: 'examples', tracks: tracks.map(t => t.id),
      description: 'Ten example tracks that come with Soundroo: boogie, garage punk and indie guitars, dance-pop, nu-disco, Afro-soul, UK garage, two focus grooves and a hyperpop finale. Ask your AI agent for music of your own.',
    },
    tracks,
  };
}
export default buildVarietyCollection;
