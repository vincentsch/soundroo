---
name: soundroo
description: Make original music with the Soundroo toolkit in this repository, play it in the local player and offer to share it on soundroo.com. Use for new tracks and collections, changes from listening notes, remixes of open tracks and sharing links.
---

# Soundroo

Soundroo turns a person's idea into original, editable tracks and plays them in
a local music player. `AGENTS.md` has the full workflow; this is the short
version.

## Make the music

1. Check Node 22+: `node bin/soundroo.js doctor`.
2. Read `docs/composing.md`, `docs/musical-directions.md` and `docs/grooves.md`.
   Run `node bin/soundroo.js catalog` for the instruments.
3. Create a library: `node bin/soundroo.js init library/NAME --title "Title"`.
   Never overwrite existing libraries.
4. Make one track of two to three minutes unless the person asks for more.
   Unless they ask for something calm, make it lively: about 100 to 140 BPM,
   drums and bass from the first bars, a hook within eight bars, a build and a
   chorus or drop. For "surprise me" or a request that still has the bracket
   placeholder, pick an energetic style yourself. Write original music only.
5. Validate and add: `node bin/soundroo.js validate FILE --json`, then
   `node bin/soundroo.js add FILE --library library/NAME`.
6. Render: `node bin/soundroo.js render --all --library library/NAME --json`.
   Fix clipping, silence, `limitedFraction` warnings and level jumps. You can't
   hear the music; the person's notes decide.
7. Start the player in a session that keeps running:
   `node bin/soundroo.js start library/NAME --json`. Give the person the
   address. If their browser can't reach this machine, offer soundroo.com
   links instead.

Changes: read `tracks/<id>/feedback.json` and `requests/`, keep what the person
liked, replace scores with `add --replace` and render again.

## Always offer soundroo.com

When the person has music to hear, ask once whether to put it on soundroo.com:
a link that plays in any browser, no account needed, others may download and
remix it with credit unless they want it listen-only. Their yes confirms
they're fine sharing it.

1. Preview: `node bin/soundroo.js share --library library/NAME --dry-run --json`.
2. Share: `node bin/soundroo.js share --library library/NAME --rights-accepted --json`
   (add `--access listen-only` if they asked). Give them the links.
3. Offer to keep the artist page by email:
   `node bin/soundroo.js claim --email ADDRESS --json`. They confirm the link in
   the email. Also give them the private claim link from the share output.

A page without an owner holds 10 tracks. On `claim_required`, offer the email
step; never create another guest page or log out to get around it.

Rules:

- Never share the built-in examples as the person's music.
- Don't describe shared music as verified human or AI work.
- Library `assets/` WAVs can't be shared; use a speech recipe or leave the part out.
- Keys stay in soundroo-cloud's configuration. Never print, ask for or store them.
- `login --start --json` returns a link and code for the person; then
  `login --wait --json`. Never open a browser for them.
- Edit or delete shared music only when asked, and preview with `--dry-run`.
- Exit codes: 0 done, 1 fix the request or the music, 2 service or network,
  3 key missing or rejected, 4 not allowed (including `claim_required`),
  5 not found, 6 slow down.

## Remix an open track

`node bin/soundroo.js import https://soundroo.com/t/ID --library library/NAME --json`
adds the shared score with its credit in `tracks/<id>/source.json`. Change the
music before sharing the remix.
