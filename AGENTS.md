# Soundroo

Soundroo is a music creation toolkit for coding agents with a finished local listening studio. Original standalone music and artistic collections are the primary use. Games, videos and app sounds are additional uses, never the default positioning.

## Product contract

- Give a shell-capable coding agent this repository and a musical brief. The agent makes a collection of ten original compositions, renders and checks them, then starts the local studio and returns its URL.
- The user listens, plays favorites, compares revisions and exports music. Mixing and deeper controls are optional. The main experience is a beautiful music library with actual playable tracks.
- Core rendering is local JavaScript on Node 22+, without accounts, API keys, Python, ffmpeg or model weights. Speech synthesis is optional; plain instrumental playback must work independently.
- Keep every composition editable and keep its source. Never present fixed starter compositions as music personalized for a user. A built-in example collection is clearly labeled.
- Compose original motifs and develop them. Do not recreate recognizable copyrighted melodies. Named artist references describe broad musical qualities, not an instruction to copy a tune.
- Voice experiments process speech as spoken word, rhythmic chops, textures or vocoder effects. Do not claim natural singing from a speech model.

## Make a collection

When someone gives you this repository, create their music and deliver the studio. Make ten original tracks by default unless their brief specifies another count. Choose a coherent creative direction from the brief; if it is open-ended, surprise them with a varied artistic collection. Do not ask them to learn a score format, choose engineering options or install a music application.

1. Check Node 22+ with `node bin/soundroo.js doctor`. Instrumental music, the studio and existing speech effects need no npm installation. Read `docs/composing.md`, discover instruments with `node bin/soundroo.js catalog`, and study the original arrangements in `examples/collection.js` for structure rather than copying their melodies.
2. Create a new personal library with `node bin/soundroo.js init library/my-music --title "Collection name"`. Keep existing libraries intact. The default `start` collection is a clearly labeled demonstration; it is not personalized music.
3. Write a composition script and editable JSON scores inside that library. Use the helpers in `src/compose.js`: `note`, `chordPitches`, `chordNotes`, `pattern`, `transformPattern`, `arrangePattern`, `arpeggiate`, and `makeSections`. The score contract and a complete runnable example are in `docs/composing.md`.
4. Give each piece an original motif and a musical shape: an opening, development, a contrast or breakdown, a return and a deliberate ending. Change harmony, rhythm, register, instrumentation and dynamics between tracks. A new seed or tempo on the same four-bar loop is not a collection. Use sensible note ranges and leave space between parts. Favor distinct electronic, ambient, piano, mallet, bass and percussion textures the instruments do well.
5. Save each score and run `node bin/soundroo.js validate path/to/score.json --json`, then `node bin/soundroo.js add path/to/score.json --library library/my-music`. Use `--replace` for a revision; previous rendered versions remain available. Rendering and diagnostics do not establish musical taste. If you cannot actually listen, say so when asked and use the user's listening notes for musical decisions.
6. Render all tracks with `node bin/soundroo.js render --all --library library/my-music --json`. Check the reports for invalid samples, clipping, silence and extreme level differences. Inspect `limitedFraction` and its warning: lower excessive levels instead of accepting a flattened mix. Inspect the arrangement and endings. Preserve the melody and unaffected sections when a user requests a targeted change.
7. Start `node bin/soundroo.js start library/my-music --json` in a retained session. Return the exact local URL printed by the command and the library folder. Keep the server running while the user listens. Do not force autoplay. The studio is their listening library, not a setup wizard.

## Listening notes and new briefs

The studio saves notes in `tracks/<id>/feedback.json` and musical requests in `requests/`. Read them on the next user request. A saved brief does not start a model automatically. Use `node bin/soundroo.js requests --library PATH --json`, process pending requests, and mark their JSON status `done` with the resulting track IDs after successful rendering. Preserve the original request and timestamps. Favorites, mix state and voice files stay in the user's library.

Mix changes in the studio render a new version. If you edit notes, preserve `mix.json` unless the user asks for a new mix. The user's player volume is a listening preference; it does not change exports. WAV downloads contain the rendered mix. MIDI contains note data and instrument mappings; sampled speech/noise and the synthesized timbre are not preserved in MIDI. Stems omit shared master processing and need not sum to the mastered WAV.

## Voice and sound art

`assets/voices/` contains short spoken phrases for experiments. A sample part can use `builtin:made-of-light` and the other phrases listed by `catalog`, or a WAV under the library's `assets/` folder. Effects are `dry`, `tape`, `granular`, `vocoder`, and `chop`.

For the user's own words, install the optional local runtime from the Soundroo folder with `npm install --no-save --package-lock=false kokoro-js@1.2.1 @huggingface/transformers@3.8.1`, then run `node bin/soundroo.js voice create "Their words" --voice af_heart --out library/my-music/assets/phrase.wav`. The first use downloads a local speech model. Speech creation is optional; do not hold an instrumental collection on that download. Use speech as rhythm, texture, spoken word or a vocoder hook. Never promise natural singing from Kokoro.

`node bin/soundroo.js voice process input.wav --effect vocoder --pitch 60 --out output.wav` works without the speech model. Tape pitch also changes duration. Granular processing is an audible texture, not a transparent studio pitch shifter. Use voice phrases sparingly and develop the music around them.

## Development


Use small topical commits. Run `npm run check` and `npm test` after relevant changes. Verify complete renders and browser playback, persistence and exports for changes affecting those flows. Keep dependencies minimal and use ordinary Node/browser mechanisms. The application must not silently invoke models or send musical data to remote services. Fix observed real failures; reviews end when no material defect remains.
