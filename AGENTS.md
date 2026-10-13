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

1. Check Node 22+ with `node bin/soundroo.js doctor`. Instrumental music, the studio and existing speech effects need no npm installation. Read `docs/composing.md` (including compact version 2 patterns and optional spoken-text recipes), discover instruments with `node bin/soundroo.js catalog`, and study the varied arrangements in `examples/variety.js` or the softer `examples/collection.js` for structure rather than copying their melodies.
2. Create a new personal library with `node bin/soundroo.js init library/my-music --title "Collection name"`. Keep existing libraries intact. The default `start` collection is a clearly labeled demonstration; it is not personalized music.
3. Write a composition script and editable JSON scores inside that library. Use the helpers in `src/compose.js`: `note`, `chordPitches`, `chordNotes`, `pattern`, `transformPattern`, `arrangePattern`, `arpeggiate`, and `makeSections`. The score contract and a complete runnable example are in `docs/composing.md`.
4. Give each piece an original hook and a musical shape: a quick opening, verse/development, prechorus/build, chorus/drop, a contrast and a deliberate ending. Let the hook arrive within the first eight bars. Change harmony, rhythm, register, instrumentation and dynamics between tracks. A new seed or tempo on the same four-bar loop is not a collection. For an open-ended brief, include guitar-led rock, modern pop and rhythm-led dance/funk alongside a few focused work grooves. Do not default a whole collection to soft piano, mallets and pads. Use the guitar/bass and rock drum presets for rock, with riffs, backbeats, fills and contrasting choruses. Treat focus music as one intentional mode, not the default for all music. See docs/musical-directions.md.
5. Save each score and run `node bin/soundroo.js validate path/to/score.json --json`, then `node bin/soundroo.js add path/to/score.json --library library/my-music`. Use `--replace` for a revision; previous rendered versions remain available. Rendering and diagnostics do not establish musical taste. If you cannot actually listen, say so when asked and use the user's listening notes for musical decisions.
6. Render all tracks with `node bin/soundroo.js render --all --library library/my-music --json`. Check the reports for invalid samples, clipping, silence and extreme level differences. Inspect `limitedFraction` and its warning: lower excessive levels instead of accepting a flattened mix. Inspect the arrangement and endings. Preserve the melody and unaffected sections when a user requests a targeted change.
7. Start `node bin/soundroo.js start library/my-music --json` in a retained session. Return the exact local URL printed by the command and the library folder. Keep the server running while the user listens. Do not force autoplay. The studio is their listening library, not a setup wizard.

## Listening notes and new briefs

The studio saves notes in `tracks/<id>/feedback.json` and musical requests in `requests/`. Read them on the next user request. A saved brief does not start a model automatically. Use `node bin/soundroo.js requests --library PATH --json`, process pending requests, and mark their JSON status `done` with the resulting track IDs after successful rendering. Preserve the original request and timestamps. Favorites, mix state and voice files stay in the user's library.

Mix changes in the studio render a new version. If you edit notes, preserve `mix.json` unless the user asks for a new mix. The user's player volume is a listening preference; it does not change exports. WAV downloads contain the rendered mix. MIDI contains note data and instrument mappings; sampled speech/noise and the synthesized timbre are not preserved in MIDI. Stems omit shared master processing and need not sum to the mastered WAV.

## Sharing, only when asked

Sharing on soundroo.com is optional and never part of making a collection. Publish only when the user explicitly asks you to share or publish. Read `docs/sharing.md` first.

1. Render every track to share, then preview with `node bin/soundroo.js share --library PATH --dry-run --json`. Tell the user what will be sent and its choices (`--visibility`, `--access`).
2. Ask the user to confirm they have the right to share this music. Pass `--rights-accepted` only after they confirm; never assume it.
3. Run `node bin/soundroo.js share --library PATH --rights-accepted --json` and return the collection and track links. Give the claim link to the user privately and say that whoever opens it can claim the artist page.

Never share the built-in example collections or examples as the user's music, and never present tracks as verified human or AI work: the service only checks that scores render with an official engine. Local `assets/` WAVs cannot be shared; convert them to speech recipes or leave the part out. Keys stay in soundroo-cloud's own configuration; never print, request or store them. Login prints a link for the user to open; never open a browser for them. Do not delete or edit shared music unless the user asks for that specific change.

## Headless and compact composition

`src/headless.js` exposes the same validation, rendering, MIDI and sleeve functions as the CLI. See `docs/headless.md`. Its engine hash identifies rendering/validation/identity source, independently of network/UI code. Version 2 scores accept compact `steps` and `line` strings in patterns; they compile to ordinary notes. `examples/paper-satellites.json` demonstrates a complete compact piece. Existing version 1 scores remain supported.

Speech recipes use `sample.speech: {text, voice}` instead of a local WAV asset. The optional local Kokoro runtime speaks each recipe once and caches it. Recipe output is processed speech, not natural singing. Core instrumental creation remains Node-only.

## Voice and sound art

`assets/voices/` contains short spoken phrases for experiments. A sample part can use `builtin:made-of-light` and the other phrases listed by `catalog`, or a WAV under the library's `assets/` folder. Effects are `dry`, `tape`, `granular`, `vocoder`, and `chop`.

For the user's own words, install the optional local runtime from the Soundroo folder with `npm install --no-save --package-lock=false kokoro-js@1.2.1 @huggingface/transformers@3.8.1`, then run `node bin/soundroo.js voice create "Their words" --voice af_heart --out library/my-music/assets/phrase.wav`. The first use downloads a local speech model. Speech creation is optional; do not hold an instrumental collection on that download. Use speech as rhythm, texture, spoken word or a vocoder hook. Never promise natural singing from Kokoro.

`node bin/soundroo.js voice process input.wav --effect vocoder --pitch 60 --out output.wav` works without the speech model. Tape pitch also changes duration. Granular processing is an audible texture, not a transparent studio pitch shifter. Use voice phrases sparingly and develop the music around them.

## Development


Use small topical commits. Run `npm run check` and `npm test` after relevant changes. Verify complete renders and browser playback, persistence and exports for changes affecting those flows. Keep dependencies minimal and use ordinary Node/browser mechanisms. The application must not silently invoke models or send musical data to remote services. Fix observed real failures; reviews end when no material defect remains.
