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

Every score uses `version: 1`, a lowercase slug `id`, a title, `bpm`, the total length in quarter-note `beats`, and an array of instrument `parts`. Useful metadata includes `description`, `genre`, `mood`, `key`, an integer `seed`, and named `sections`.

| Field | Meaning |
| --- | --- |
| `bpm` | Tempo from 20 to 400 beats per minute. |
| `beats` | Total score length in quarter-note beats. Leave space for musical release and the ending. |
| `sections` | `{id, name, beat, beats}`; section starts and lengths use beats. |
| `master` | `{volume, reverb}`; volume 0–2, reverb 0–1. |
| `parts` | `{id, name, instrument, volume, pan, color, tone, notes, patterns, clips, sample}`. |
| `notes` | `{pitch, beat, duration, velocity}`. Pitch is a MIDI integer or scientific pitch such as `F#4`; velocity is greater than 0 and at most 1. |
| `patterns` | Named blocks `{name: {beats, notes}}` with timing relative to the block. |
| `clips` | `{pattern, beat, repeat, transpose, velocity}`; repeat and transpose a named pattern at a score position. |
| `tone` | Instrument-specific controls. Discover names and supported ranges with `catalog`. |

The renderer validates timing, identities, ranges, supported controls and expansion limits. Scores support up to ten minutes, 64 parts and 100,000 expanded note events. Named sections help the listener navigate; they do not constrain the musical meter. Fractional beats can express swing, irregular rhythms and human timing.

## Instruments and sound

Run `node bin/soundroo.js catalog --json` for the authoritative instrument names and controls. Instruments include `electric-piano`, `piano`, `pad`, `pluck`, `bass`, `bell`, `marimba`, `analog-lead`, `fm-lead`, `acid-bass`, `organ`, `strings`, `kick`, `snare`, `clap`, `hi-hat`, `shaker`, `noise`, and `sample`.

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

## Library and studio

A library contains `collection.json`, `tracks/<id>/score.json`, saved mix/favorite/feedback state and cached WAV revisions. Its `requests/` folder holds musical briefs written in the studio. Its `assets/` folder holds user-provided voice WAVs. Source scores and renders stay on the computer; Soundroo calls no model or remote music API.

The agent reads pending requests and listening notes on the next turn, composes or revises, and renders. A queued request alone does not awaken an agent. Mark a fulfilled request `status: "done"` with its `trackIds` after successful work. Preserve the request and its timestamps.

The studio's player volume changes listening only. Saved mixer values change the rendered export. WAV is immediately playable. MIDI carries supported note data and program mappings; it omits processed speech/noise and does not preserve synthesized timbre. Stems are dry post-part-mix buses before shared master processing. Portable listening bundles include a local player page, cover, WAV and score; nothing is published automatically.

## Check and listen

Use validation before rendering. Inspect the report's peak, RMS, clipping, silence, invalid samples and sections. RMS is a signal measurement, not a LUFS reading or a music-quality score. Let differences in dynamics serve the music, and investigate extreme unexplained loudness changes between pieces.

An agent without a verified audio-input capability cannot hear a render. Signal checks and score inspection can find technical problems but cannot approve taste. Use the listener's notes for melody, balance, timbre and fatigue. Make targeted revisions while retaining the successful parts of a piece.
