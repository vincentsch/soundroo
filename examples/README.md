# Original example collections

`variety.js` exports `buildVarietyCollection({seed=21}={})`, returning collection metadata and ten editable scores for **Turn It Up**, the default examples on a fresh start. It opens with rock-and-roll, pop-punk and indie guitars, then explores dance-pop, disco/funk, Afro-pop, garage, two work grooves and electroclash. The seed changes performance detail and sleeves, not the composed motifs. Each piece has its own hook, contrasting sections and ending. Render the collection with `node bin/soundroo.js demo library/turn-it-up`.

Both collections are labeled `source: "examples"`; neither generates personalized music or invokes a model or online service.

`streetlight-funk.json` (116 BPM funk) and `pixel-grand-prix.json` (152 BPM 8-bit racing theme with the `chip-lead` and `chip-bass` instruments) are complete lively tracks in score version 2, labeled `origin: "example"`.

`paper-satellites.json` is a single built-in example in score version 2, labeled `origin: "example"`. Its drums are `steps` strings and its bass, chords, hook and countermelody are `line` strings, so about 5 KB of JSON expands into roughly 1,300 notes and 81 seconds of music. It demonstrates the notation; it is not personalized music.

## The Open Window

`collection.js` exports `buildExampleCollection({seed=1,durationScale=1})`, returning collection metadata and ten editable version-1 scores. “The Open Window” is a built-in demonstration, explicitly labeled `source: "examples"`. These compositions are not personalized user music. Each has its own original motifs, instrumentation, harmonic movement, sections and ending. No model or online service is invoked.

```js
import { buildExampleCollection } from './examples/collection.js';
import { compileScore, validateScore } from './src/score.js';
import { getCatalog } from './src/catalog.js';
import { renderScore } from './src/render.js';

const { collection, tracks } = buildExampleCollection();
for (const score of tracks) {
  const { audio, report } = await renderScore(score);
  // Consume or save this audio before rendering the next track.
}
```

Scores use quarter-note beats, scientific pitches such as `Bb3` or MIDI integers, and normalized velocity `(0,1]`. Tempo is 20–400 BPM, length at most ten minutes, with at most 64 parts and 100,000 expanded events. `validateScore` returns `{valid,issues:[{path,message}]}`; `compileScore` throws an error with the same issues or returns normalized parts with expanded, sorted notes. Compilation is idempotent and leaves the source untouched. Patterns are `{beats,notes}` maps on a part; clips reference a pattern with `beat`, integer `repeat`, semitone `transpose` and a velocity multiplier. Notes and clips must fit their containing timeline.

Discover instrument IDs, descriptions, MIDI programs, supported `part.tone` controls and ranges through `getCatalog().instruments`. Piano and strings are synthesis approximations. The toolkit favors electronic timbres. Unsupported tone controls fail validation rather than being silently recorded. `src/compose.js` exports `note`, `chordPitches`, `chordNotes`, `pattern`, `transformPattern`, `arrangePattern`, `arpeggiate` and `makeSections`. Use these for new original music; the example factory is not a personalization engine.

For example, start a new personal score from a fresh motif, then develop its rhythm, harmony and timbre rather than renaming an example:

```js
import { note, pattern, arrangePattern, chordPitches, chordNotes } from './src/compose.js';
const melody = { id: 'melody', name: 'New motif', instrument: 'marimba', notes: [] };
const motif = pattern(4, [note('F4', 0, 0.6), note('A4', 1.25, 0.5), note('G4', 2.5, 1)]);
arrangePattern(melody, 'question', motif, { beat: 0, repeat: 2 });
arrangePattern(melody, 'question', motif, { beat: 8, repeat: 2, transpose: 7, velocity: 0.8 });
const harmony = { id: 'harmony', name: 'Harmony', instrument: 'electric-piano', pan: -0.2,
  notes: [
    ...chordNotes(chordPitches('F3', 'maj7'), 0, 7, 0.5),
    ...chordNotes(chordPitches('C3', 'add9'), 8, 7, 0.5),
  ] };
const personalScore = { version: 1, id: 'window-study', title: 'Window Study',
  bpm: 90, beats: 16, seed: 8, parts: [melody, harmony] };
```

`renderScore(score,{sampleRate=44100,mix={},projectDir,stems=false,from=0,to,progress,signal})` is asynchronous. It returns `{audio,report,parts,expandedScore,stems?}`. Audio has stereo Float32 channels and the buffer interface used by `src/audio/wav.js`. `from` and `to` are seconds on the whole score timeline. Excerpts advance synthesis and effects from the start to preserve timing and tails, while allocating only the requested output window. Sample rates of 8–96 kHz are supported. The report includes signal measurements, a waveform, section times, technical warnings and the fraction of samples caught by the −1 dB safety ceiling. The measurements diagnose signal health; they do not establish artistic quality.

Mix overrides use `{parts:{"part-id":{volume,pan,mute,solo}},master:{volume}}`; part and master volume are absolute linear gains 0–2 and pan is −1 to 1. Solo restricts playback to soloed parts, and mute wins over solo. Seeds do not change when parts are muted. Optional stems are dry stereo buses after part mixing, before shared reverb, compression, master volume and safety limiting. They do not reconstruct the mastered render exactly and retain their original floating-point levels. Muted stems are silent.

PCM output occupies eight bytes per stereo frame; requesting stems adds one such buffer per part. Long scores with many stems therefore need proportionally more memory. Ordinary renders keep only one track's output and block-sized working buses. The renderer reads no speech assets when sample parts are absent or muted.

Progress receives `{phase,progress,fraction,seconds,duration}` (`progress` and `fraction` are the same 0–1 value). Return `false`, throw from the callback, or abort an optional AbortSignal to cancel. Rendering yields to Node regularly, allowing a local server to remain responsive. An aborted render rejects with `name: "AbortError"`; it never returns partial audio.

Sample parts require `sample:{asset,effect}` and ordinary note events that trigger the phrase; note duration bounds playback and applies short fades. Speech assets are `builtin:made-of-light`, `stay-a-little`, `in-the-rhythm`, `city-never-sleeps`, `let-it-change`, and `slow-down` (each with the `builtin:` prefix). Local assets are WAV paths under the project's `assets/` directory, loaded using `projectDir`. WAVs are bounded to 32 MB, 60 seconds, 1–8 channels and 8–192 kHz. Samples are mixed down to mono before panning. Effects are `dry`, `tape` (pitch changes speed), `granular` (pitch/stretch texture), `vocoder` (carrier `pitch`) and `chop` (eighth-note slice `pattern`, indices 0–3 with null/−1 rests). Semitone offsets are −24 to 24, stretch 0.25–4. Instrumental pieces do not read speech assets. These processes manipulate spoken word, not natural singing.

Default durations are roughly 75–123 seconds. `durationScale` changes each section's bar count while retaining the tempo and note grid; small scales are useful for previews, with some long motifs omitted when they no longer fit. The default is the complete musical arrangement. Render tracks sequentially and release their PCM buffers rather than collecting ten buffers in memory.
