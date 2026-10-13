---
name: soundroo
description: Compose, render and present original music with the Soundroo toolkit in this repository, and share it on soundroo.com only when the user explicitly asks. Use for music collections, revisions from listening notes, remixes of open tracks and publishing links.
---

# Soundroo

Soundroo turns a musical brief into a collection of original, editable tracks
and a local listening studio. Follow `AGENTS.md`; this skill summarizes the
workflow and the optional sharing commands.

## Make the music

1. Check the runtime: `node bin/soundroo.js doctor`. Instrumental music needs
   only Node 22+.
2. Read `docs/composing.md` and `docs/musical-directions.md`. Discover
   instruments with `node bin/soundroo.js catalog`.
3. Create a new library: `node bin/soundroo.js init library/NAME --title "Title"`.
   Never overwrite existing libraries.
4. Compose ten original tracks unless the brief says otherwise. Give each its
   own hook within the first eight bars, a shape (opening, development, build,
   chorus or drop, contrast, deliberate ending) and its own harmony, rhythm,
   register and instruments. For an open brief, include guitar-led rock, modern
   pop and dance or funk alongside a few focused grooves. Do not copy
   recognizable melodies; artist references describe broad qualities only.
5. Validate and add each score: `node bin/soundroo.js validate FILE --json`,
   then `node bin/soundroo.js add FILE --library library/NAME`.
6. Render everything: `node bin/soundroo.js render --all --library library/NAME --json`.
   Check clipping, silence, `limitedFraction` and level differences, and fix
   them. Diagnostics do not judge taste; if you cannot listen, say so and use
   the user's listening notes.
7. Start the studio in a retained session:
   `node bin/soundroo.js start library/NAME --json`. Return the exact URL and
   the library folder. Do not force autoplay.

Revisions: read `tracks/<id>/feedback.json` and `requests/`, keep what the user
liked, replace scores with `add --replace` and render again.

## Share only when asked

Sharing on soundroo.com is optional. Never publish as part of making music.
Publish only when the user explicitly asks to share or publish; read
`docs/sharing.md` first.

1. Render the tracks, then preview:
   `node bin/soundroo.js share --library library/NAME --dry-run --json`.
   Summarize what will be sent and the choices (`--visibility`, `--access`).
2. Ask the user to confirm they have the right to share this music. Pass
   `--rights-accepted` only after they confirm.
3. Publish: `node bin/soundroo.js share --library library/NAME --rights-accepted --json`.
   Return the collection and track links. Give the claim link to the user and
   explain that whoever opens it can claim the artist page.

Rules:

- Never share the built-in example collections or example tracks as the user's music.
- Do not describe shared music as verified human or AI work. The service checks
  only that scores render with an official engine.
- Local `assets/` WAVs cannot be shared. Convert the part to a speech recipe or
  remove it, render again, then share.
- Keys stay in soundroo-cloud's configuration. Never print, request, store or
  paste them. `SOUNDROO_TOKEN` is for the user's own scripts.
- `login --start --json` returns a link and code for the user to open; then
  `login --wait --json`. Never open a browser for the user.
- Edit or delete shared music (`node bin/soundroo.js cloud track update|delete ...`)
  only for a specific request from the user; preview with `--dry-run` first.
- Exit codes: 0 done, 1 fix the request or the music, 2 service or network,
  3 key missing or rejected, 4 not allowed, 5 not found, 6 slow down.

## Remix an open track

`node bin/soundroo.js import https://soundroo.com/t/ID --library library/NAME --json`
adds the exact shared score with its credit in `tracks/<id>/source.json`.
Change the music before sharing the remix, and credit the original artist.
