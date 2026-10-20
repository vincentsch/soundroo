# Compose with Soundroo

Soundroo renders editable scores. Your coding agent makes the musical choices and writes the compositions. The studio is a place to listen, compare and shape them.

Create an empty personal library first:

```bash
node bin/soundroo.js init library/my-music --title "After Hours"
```

Keep the scores and any script that writes them in that library. Add each score with the CLI, render and start the studio. Each new request deserves its own motifs, harmony, rhythms and instruments; changing the seed of an example does not make new music. Read [Musical directions](musical-directions.md) before you write: unless someone asks for calm music, Soundroo tracks are lively and rhythm-led.

## A complete example

[`examples/streetlight-funk.json`](../examples/streetlight-funk.json) is a whole track in about 6 KB: a 116 BPM funk groove with a syncopated kick, ghost-note snare, sixteenth hats, a bass riff that jumps octaves, muted guitar scratches, electric piano stabs and a synth hook from bar five. It has a count-in, a groove section, a build with a snare roll, a chorus where the hook moves up, a break without kick and snare, a longer last chorus and an ending. Read it for the shape, then write your own music. [Grooves](grooves.md) has drum and bass patterns for other styles.

For other styles, start from the closest working example. `node bin/soundroo.js example` lists them with genre and tempo: rock and roll, garage pop-punk, indie guitars, dance-pop, nu-disco, Afro-pop, UK garage, deep house, liquid drum and bass, hyperpop, funk and 8-bit game music. `node bin/soundroo.js example rooftop-riot` prints one score. Look at how its drums and bass enter, where the hook comes and how the sections change, then write new music. soundroo.com refuses unchanged copies of the examples.

Write a score as JSON, or write a small script that builds it, and keep it in the library:

```bash
node bin/soundroo.js validate library/my-music/my-track.json --json
node bin/soundroo.js add library/my-music/my-track.json --library library/my-music
node bin/soundroo.js render my-track --library library/my-music --json
node bin/soundroo.js start library/my-music
```

A script helps when a track repeats ideas with changes. `src/compose.js` has helpers for that: `note`, `chordPitches`, `chordNotes`, `pattern`, `transformPattern`, `arrangePattern`, `arpeggiate` and `makeSections`. Import them from the library folder with `import { pattern, arrangePattern } from '../../src/compose.js';` and write the finished score with `fs.writeFileSync`. [`examples/variety.js`](../examples/variety.js) builds the ten Turn It Up tracks this way.

For a revision, change the score or its script, use `add --replace`, then render again. Previous rendered versions stay in the studio. Keep the person's `mix.json` when you change notes, unless they asked for a new mix.

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

Part volume defaults to 1 and master volume to 0.8. The mix controls use the same defaults as the renderer. Part volumes set the balance; the master then brings every track to the same loudness (see [Check and listen](#check-and-listen)).

## Instruments and sound

Run `node bin/soundroo.js catalog --json` for the authoritative instrument names and controls. Instruments include `electric-piano`, `piano`, `pad`, `pluck`, `bass`, `bell`, `marimba`, `analog-lead`, `fm-lead`, `acid-bass`, `organ`, `strings`, `kick`, `snare`, `clap`, `hi-hat`, `shaker`, `noise`, and `sample`.

For guitar-led music, use `guitar-clean`, `guitar-crunch` and `electric-bass`. These use seeded fractional-delay plucked strings; crunch guitar adds overdrive and cabinet filtering before its mix fader. They are synthesized instruments, not guitar recordings. `brightness`, `release`, `palmMute` and, for crunch, `drive` shape the articulation. Use short palm-muted notes for riffs and alternating bass; release the mute for sustained choruses. Strum chord notes a few milliseconds apart. Guitar notes typically sit between E2 and E6; bass generally sits an octave lower. Keep riffs and lead hooks out of each other's way. Crunch overdrive compresses velocity accents; use clean guitar or part balance for more pronounced dynamics.

`rock-kick`, `rock-snare`, `tom`, `crash`, `ride` and `open-hat` add a more assertive drum palette. Synthesized tom pitch follows the note. MIDI preserves standard tom pitches 41, 43, 45, 47, 48 and 50; other pitches map to the nearest GM tom to avoid selecting cymbals. Use the standard pitches for portable fills. Rock needs purposeful backbeats and fills, while modern pop needs a clear lead hook, bass motion and chorus lift. More guidance and example directions are in [Musical directions](musical-directions.md).

For video game music, `chip-lead` is a pulse wave like the sound chips in 8-bit consoles. Its `duty` sets the pulse width: 0.125 is thin and nasal, 0.25 the classic lead, 0.5 a hollow square. `chip-bass` is a triangle bass. Use them with `kick`, `snare` and `hi-hat`, fast sixteenth-note arpeggios and little reverb. [`examples/pixel-grand-prix.json`](../examples/pixel-grand-prix.json) is a complete 8-bit racing theme.

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

Use validation before rendering. Every render is mastered: a high-pass below 30 Hz, the same loudness for every track (about -14 LUFS, the level streaming services play at; the report's `loudness`) and a limiter that keeps peaks at -1 dBFS. Part volumes set the balance between parts. A master volume below the default 0.8 makes the whole track quieter; a higher one changes nothing. `limitedFraction` is the share of the track the limiter turns down by more than 3 dB; a track with sharp peaks is first played a little quieter, and if that is not enough the report warns that loud moments sound squashed. Lower the loudest parts then, usually drums or bass.

The report's `suggestions` point at arrangement problems listeners notice: drums and bass that only come in after bar eight, the same four bars repeated unchanged for 24 bars or more, sections that all use the same parts, and a long silent ending. Fix them unless the person asked for exactly that.

An agent without a verified audio-input capability cannot hear a render. Signal checks and score inspection can find technical problems but cannot approve taste. Use the listener's notes for melody, balance, timbre and fatigue. Make targeted revisions while retaining the successful parts of a piece.
