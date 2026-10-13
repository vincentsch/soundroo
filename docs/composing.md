# Compose with Soundroo

Soundroo renders editable scores. Your coding agent makes the musical choices and writes the compositions. The studio is a place to listen, compare and shape them.

Create an empty personal library first:

```bash
node bin/soundroo.js init library/my-music --title "After Hours"
```

Keep the composition script and scores in that library. Add each score with the CLI, render the collection and start the studio. A new musical brief normally deserves original motifs, harmony, rhythms and instrumentation; changing the seed on the example collection does not personalize it.

## A complete example

Save this as `library/my-music/compose.mjs` from the Soundroo source folder:

```js
import fs from 'node:fs';
import {
  note, pattern, transformPattern, arrangePattern,
  chordPitches, chordNotes, makeSections,
} from '../../src/compose.js';

const sections = makeSections([
  ['opening', 'The room', 4],
  ['theme', 'A small light', 8],
  ['contrast', 'Outside', 4],
  ['return', 'Home again', 8],
  ['ending', 'Let it settle', 4],
]);
const score = {
  version: 1,
  id: 'quiet-hours',
  title: 'Quiet Hours',
  description: 'A soft electric-piano motif that opens into a brighter answer.',
  genre: 'Downtempo',
  mood: 'Warm, reflective',
  key: 'C minor',
  bpm: 90,
  beats: sections.at(-1).beat + sections.at(-1).beats,
  seed: 42,
  master: { volume: 0.9, reverb: 0.25 },
  sections,
  parts: [
    { id: 'keys', name: 'Electric piano', instrument: 'electric-piano', volume: 1, pan: -0.12, notes: [], tone: { brightness: 3200 } },
    { id: 'bass', name: 'Round bass', instrument: 'bass', volume: 0.75, pan: 0, notes: [] },
    { id: 'bells', name: 'Distant bells', instrument: 'bell', volume: 0.55, pan: 0.35, notes: [], tone: { release: 1.7 } },
  ],
};
const [keys, bass, bells] = score.parts;
const motif = pattern(8, [
  note('G4', 0, 0.7, 0.65), note('Eb5', 1.5, 0.6, 0.55),
  note('D5', 3, 0.8, 0.6), note('C5', 4.5, 1.2, 0.65),
  note('G4', 6.5, 0.7, 0.5),
]);
const progression = [['C3', 'min7'], ['Ab2', 'maj7'], ['Eb3', 'maj7'], ['G2', 'sus4']];
for (const section of sections) {
  const ending = section.id === 'ending';
  if (!ending) {
    const source = section.id === 'contrast'
      ? transformPattern(motif, { transpose: 7, velocity: 0.8 }) : motif;
    arrangePattern(keys, section.id === 'contrast' ? 'answer' : 'theme', source, {
      beat: section.beat,
      repeat: section.beats / source.beats,
      velocity: section.id === 'opening' ? 0.65 : 1,
    });
  }
  for (let offset = 0; offset < section.beats; offset += 4) {
    const [root, quality] = ending ? ['C3', 'min7'] : progression[(offset / 4) % 4];
    const pitches = chordPitches(root, quality);
    keys.notes.push(...chordNotes(pitches, section.beat + offset, 2.8, ending ? 0.3 : 0.35, { strum: 0.012 }));
    if (section.id !== 'opening') bass.notes.push(note(pitches[0] - 12, section.beat + offset, 2.7, 0.5));
    if (section.id === 'return' && offset % 8 === 0) bells.notes.push(note('G5', section.beat + offset + 2, 0.5, 0.35));
  }
}
fs.writeFileSync(new URL('quiet-hours.json', import.meta.url), JSON.stringify(score, null, 2) + '\n');
```

Then:

```bash
node library/my-music/compose.mjs
node bin/soundroo.js validate library/my-music/quiet-hours.json --json
node bin/soundroo.js add library/my-music/quiet-hours.json --library library/my-music
node bin/soundroo.js render quiet-hours --library library/my-music --json
node bin/soundroo.js start library/my-music
```

For a revision, change the score or its source script, use `add --replace`, then render again. Previous rendered versions stay in the studio. Preserve a user's `mix.json` when changing notes unless they asked for a new mix.

## Score format

Every score uses `version: 1`, or `version: 2` for the compact pattern strings below, a lowercase slug `id`, a title, `bpm`, the total length in quarter-note `beats`, and an array of instrument `parts`. Useful metadata includes `description`, `genre`, `mood`, `key`, an integer `seed`, and named `sections`.

| Field | Meaning |
| --- | --- |
| `bpm` | Tempo from 20 to 400 beats per minute. |
| `beats` | Total score length in quarter-note beats. Leave space for musical release and the ending. |
| `sections` | `{id, name, beat, beats}`; section starts and lengths use beats. |
| `master` | `{volume, reverb}`; volume 0–2, reverb 0–1. |
| `parts` | `{id, name, instrument, volume, pan, color, tone, notes, patterns, clips, sample}`. |
| `notes` | `{pitch, beat, duration, velocity}`. Pitch is a MIDI integer or scientific pitch such as `F#4`; velocity is greater than 0 and at most 1. |
| `patterns` | Named blocks `{name: {beats, notes}}` with timing relative to the block. Version 2 adds `line`, `steps` and `pitch`. |
| `clips` | `{pattern, beat, repeat, transpose, velocity}`; repeat and transpose a named pattern at a score position. |
| `tone` | Instrument-specific controls. Discover names and supported ranges with `catalog`. |
| `artwork` | Optional sleeve metadata: `{style, colors: [background, ink, accent], seed}`. Colors use six-digit hex. |

The renderer validates timing, identities, ranges, supported controls and expansion limits. Scores support up to ten minutes, 64 parts and 100,000 expanded note events.

## Compact notation (version 2)

A version 2 score can write a pattern's notes as strings. They compile into ordinary notes, so everything else stays the same: patterns are placed with clips, and the studio, MIDI and stems see normal note events. A score with `version: 1` rejects these strings rather than ignoring them, and engines before 0.4.0 refuse version 2.

```json
"patterns": {
  "beat": { "beats": 4, "steps": "X...x...|X...x.o." },
  "pedal": { "beats": 2, "steps": "x.x.", "pitch": "C2" },
  "hook": { "beats": 8, "line": "G4/.5 Eb5 [C4 Eb4 G4]/2@.6 -/1 C5/1/3 D5 Eb5 F5/2" }
}
```

`steps` spreads its symbols evenly over the pattern's `beats`: sixteen symbols in four beats are sixteenth notes. `X` plays at velocity 0.95, `x` at 0.75 and `o` at 0.4; `.` rests; `|` and spaces only help reading. Each hit lasts one step at the pattern's `pitch`, which defaults to C4 and matters for pitched instruments and toms.

`line` plays tokens one after another from the pattern's start. `pitch/duration@velocity` gives a note with its duration in beats and an optional velocity. A duration can be a decimal such as `.5` or a fraction such as `1/3` for triplets. It stays in effect until the next duration; the first defaults to one beat. Velocity applies to its own token and defaults to 0.7. `[C4 Eb4 G4]` sounds a chord, `-` rests, pitches are scientific names or MIDI numbers, and `|` and spaces separate tokens. A pattern can combine `notes`, `line` and `steps`; the line must fit within the pattern's `beats`.

Validation names the string and the token or character at fault. A string holds at most 16,384 characters. [`examples/paper-satellites.json`](../examples/paper-satellites.json) is a complete version 2 example in about 5 KB. Named sections help the listener navigate; they do not constrain the musical meter. Fractional beats can express swing, irregular rhythms and human timing.

Sleeve styles are `orbit`, `strata`, `window`, `wave`, `sun`, `petal`, `ripple`, `monolith`, `weave`, and `constellation`. Give a collection varied sleeves and a coherent palette, or omit artwork and let the studio assign distinct designs by track position. These are original generated SVGs; no image service is required.

Part volume defaults to 1 and master volume to 0.8. The mix controls use the same defaults as the renderer. Render reports include `limitedFraction`: the fraction of samples flattened at the safety ceiling. If its warning appears, lower levels and render again; zero out-of-range samples alone does not mean the mix avoided limiting.

## Instruments and sound

Run `node bin/soundroo.js catalog --json` for the authoritative instrument names and controls. Instruments include `electric-piano`, `piano`, `pad`, `pluck`, `bass`, `bell`, `marimba`, `analog-lead`, `fm-lead`, `acid-bass`, `organ`, `strings`, `kick`, `snare`, `clap`, `hi-hat`, `shaker`, `noise`, and `sample`.

For guitar-led music, use `guitar-clean`, `guitar-crunch` and `electric-bass`. These use seeded fractional-delay plucked strings; crunch guitar adds overdrive and cabinet filtering before its mix fader. They are synthesized instruments, not guitar recordings. `brightness`, `release`, `palmMute` and, for crunch, `drive` shape the articulation. Use short palm-muted notes for riffs and alternating bass; release the mute for sustained choruses. Strum chord notes a few milliseconds apart. Guitar notes typically sit between E2 and E6; bass generally sits an octave lower. Keep riffs and lead hooks out of each other's way. Crunch overdrive compresses velocity accents; use clean guitar or part balance for more pronounced dynamics.

`rock-kick`, `rock-snare`, `tom`, `crash`, `ride` and `open-hat` add a more assertive drum palette. Synthesized tom pitch follows the note. MIDI preserves standard tom pitches 41, 43, 45, 47, 48 and 50; other pitches map to the nearest GM tom to avoid selecting cymbals. Use the standard pitches for portable fills. Rock needs purposeful backbeats and fills, while modern pop needs a clear lead hook, bass motion and chorus lift. More guidance and example directions are in [Musical directions](musical-directions.md).

Piano and strings are synthesis approximations. Their advantage is portable, editable sound with no instrument-bank download; do not describe them as recordings of acoustic instruments. Electronic timbres, mallets, textures and processed speech are part of the native palette.

Each piece should have a musical identity. Vary motif, harmony, rhythm, dynamics, density, register and arrangement. Use named pattern variations and a contrasting section. Avoid stacking every instrument at full level or using a lead continuously. A deliberate ending needs room for releases; simply truncating the final note can make a valid score sound unfinished.

## Speech as musical material

A `sample` part uses a local WAV or built-in spoken phrase:

```json
{
  "id": "spoken-hook",
  "name": "Spoken hook",
  "instrument": "sample",
  "volume": 0.45,
  "pan": 0.15,
  "sample": {
    "asset": "builtin:made-of-light",
    "effect": "vocoder",
    "pitch": 60
  },
  "notes": [{"pitch": 60, "beat": 32, "duration": 4, "velocity": 0.65}]
}
```

The sample's treatment is fixed for that part. Separate sample parts can use different carrier pitches or effects. `duration` limits playback of each sample event. Treatments are `dry`, `tape`, `granular`, `vocoder` and `chop`. Speech is not singing; it can supply a phrase, a rhythm, a texture or a robotic hook. A new spoken phrase can be generated with the optional local voice command in the README.

A speech recipe puts the words in the score instead of a WAV:

```json
"sample": { "speech": { "text": "Carry the lantern home.", "voice": "am_michael" }, "effect": "vocoder", "pitch": 63 }
```

The first render speaks each recipe with the optional local Kokoro model and caches the phrase, so later renders reuse the same audio. Recipes need the speech runtime from the README; instrumental parts never do. A recipe holds up to 200 characters, a score up to 16 different recipes, and `voice` is one of the 28 voices in `catalog` (default `af_heart`). Use `asset` or `speech`, not both.

## Library and studio

A library contains `collection.json`, `tracks/<id>/score.json`, saved mix/favorite/feedback state and cached WAV revisions. Its `requests/` folder holds musical briefs written in the studio. Its `assets/` folder holds user-provided voice WAVs. Source scores and renders stay on the computer; Soundroo calls no model or remote music API.

The agent reads pending requests and listening notes on the next turn, composes or revises, and renders. A queued request alone does not awaken an agent. Mark a fulfilled request `status: "done"` with its `trackIds` after successful work. Preserve the request and its timestamps.

The studio's player volume changes listening only. Saved mixer values change the rendered export. WAV is immediately playable. MIDI carries supported note data and program mappings; it omits processed speech/noise and does not preserve synthesized timbre. Stems are dry post-part-mix buses before shared master processing. Portable listening bundles include a local player page, cover, WAV and score; nothing is published automatically.

## Check and listen

Use validation before rendering. Inspect the report's peak, RMS, clipping, silence, invalid samples and sections. RMS is a signal measurement, not a LUFS reading or a music-quality score. Let differences in dynamics serve the music, and investigate extreme unexplained loudness changes between pieces.

An agent without a verified audio-input capability cannot hear a render. Signal checks and score inspection can find technical problems but cannot approve taste. Use the listener's notes for melody, balance, timbre and fatigue. Make targeted revisions while retaining the successful parts of a piece.
