# Soundroo for AI agents

This file tells you, the AI agent, how to make music with Soundroo. The person gives you an idea, maybe only a few words. You compose the music as an editable score. Soundroo renders it into audio on this computer and opens a small music player in the browser, where the person listens.

Soundroo needs Node.js 22 or newer and nothing else: no account, no API key, no music software, no model download. Speech is optional.

The documentation for people is at https://soundroo.com/docs.

## Before you start

Maybe the person pasted the prompt from soundroo.com or the README, and you are not in a Soundroo folder yet. Then clone it into the current folder first. If they named another place, use that.

```bash
git clone https://github.com/vincentsch/soundroo.git
cd soundroo
node bin/soundroo.js doctor
```

`doctor` checks Node. If Node is missing or older than 22, tell the person and help them install Node 22 (for example from https://nodejs.org or with nvm). Nothing else needs installing.

If you can't run commands on a real computer at all (for example in a chat app), stop and send the person to https://soundroo.com/connect. That page explains the Soundroo connector for ChatGPT and Claude.

## What to make

Read the person's words and decide the normal things yourself: style, tempo, instruments, length, title. Ask only when the request contradicts itself or you can't go on without an answer.

- **One track first.** Unless they ask for more ("an album", "five tracks", "a collection"), make one track of about two to three minutes. A first track they can hear in a few minutes beats ten tracks they wait for. After they've listened, offer more.
- **"Surprise me", or the brackets are still there.** If the request still contains the placeholder in square brackets, or says "surprise me" or nothing specific, pick a lively style yourself. Choose something with energy, like funk, house, rock, synthwave, disco or drum and bass.
- **Lively by default.** Unless they ask for something calm, the music is rhythm-led and fun: about 100 to 140 BPM, drums and bass from the first bars, a hook within the first eight bars, chords in rhythm, a build and a chorus or drop. [docs/musical-directions.md](docs/musical-directions.md) explains this, and [docs/grooves.md](docs/grooves.md) has drum and bass patterns for each style. Calm, ambient and focus music are fine when someone asks for them. Don't fall back to soft piano, slow pads and long quiet intros.
- **A collection.** When they ask for several tracks, give each its own hook, groove, key, tempo and instruments. A new seed or tempo on the same loop is not a new track. For an open request, mix styles: rock, pop, dance, funk, and maybe one focused groove.
- **Original music only.** Write new motifs and develop them. Never recreate a melody someone would recognize. An artist name in a request describes a broad sound, not a tune to copy.
- **No singing.** Soundroo is instrumental, with optional spoken words as rhythmic chops, textures or a vocoder hook. If someone wants vocals, say that Soundroo speaks words but can't sing, and offer a spoken or vocoder part.

## Making a track, step by step

1. **Learn the format.** Read [docs/composing.md](docs/composing.md) and [docs/musical-directions.md](docs/musical-directions.md). Run `node bin/soundroo.js catalog` for the instruments and their settings. Run `node bin/soundroo.js example` to list the example tracks by genre, then print the one closest to the request (`node bin/soundroo.js example hotwire-boogie`) and study how it opens, builds and ends. Write your own music; soundroo.com refuses copies of the examples.

2. **Create a library.** One library per collection, under `library/`:

   ```bash
   node bin/soundroo.js init library/<name> --title "Collection title"
   ```

   Never overwrite or delete an existing library. The built-in example collection (Turn It Up) is a demonstration, not the person's music.

3. **Write the score.** Use version 2 scores with compact `steps` and `line` patterns placed with `clips`, or write a small script in the library that builds the score with the helpers in `src/compose.js`. Plan the sections and where the energy goes before writing notes. Keep the score and any script in the library so the music stays editable.

4. **Check and add it.**

   ```bash
   node bin/soundroo.js validate library/<name>/<track>.json --json
   node bin/soundroo.js add library/<name>/<track>.json --library library/<name>
   ```

   Use `--replace` to revise a track. Earlier rendered versions stay available.

5. **Render it.**

   ```bash
   node bin/soundroo.js render --all --library library/<name> --json
   ```

   Read the report. Fix every warning. Act on the `suggestions` too (drums that come in late, four bars that repeat unchanged for too long, sections that all sound the same, a long silent ending) unless the person asked for exactly that. Every render is mastered to the same loudness, so don't raise the master volume to make it louder. These checks find technical and arrangement problems; they can't tell you whether it sounds good. You can't hear the music, so don't claim it sounds great.

6. **Open the player.** Start the studio in a session that keeps running, and don't stop it while the person listens:

   ```bash
   node bin/soundroo.js start library/<name> --json
   ```

   It prints a local address, usually `http://127.0.0.1:4317`. Don't force autoplay.

7. **Tell the person.** Give them the address, the track title and one or two plain sentences about what you made (style, tempo, what to listen for). Say they can leave notes in the player or tell you what to change. Then ask the sharing question below in the same message.

## Always offer soundroo.com

When the person has music to listen to, ask once whether to put it on soundroo.com. Use your own words, along these lines:

> Want me to put it on soundroo.com too? You'd get a link that plays in any browser, to send to friends. No account needed. Anyone with the link can listen, and others can download and remix it with credit unless you'd like it listen-only. Only say yes if you're fine sharing it.

Their yes also confirms they're fine sharing the music. Don't ask twice, and don't push if they say no.

When they say yes:

1. Render everything you share, then preview with `node bin/soundroo.js share --library library/<name> --dry-run --json`.
2. Share: `node bin/soundroo.js share --library library/<name> --rights-accepted --json`. Add `--access listen-only` if they wanted that. The first share downloads soundroo-cloud, a small helper that does the network part, and creates an artist page without an owner. Its music is unlisted: it plays for anyone with the link.
3. Give them the collection link and the track links. The tracks play once soundroo.com has rendered them, usually within a minute or two.
4. Offer to keep the page: "If you give me your email address, I'll send you a link. Confirm it and the artist page is yours, so you can list your music on Soundroo and share more than 10 tracks." If they give one, run `node bin/soundroo.js claim --email <address> --json` and tell them to open the email and press the button. It works once and expires in an hour.
5. The share output also has a private claim link. Give it to the person and say that whoever opens it can take over the artist page, so they should keep it to themselves.
6. Once they've confirmed the email, their music can be listed on soundroo.com. If they want that, run the share command again with `--visibility public`. The key on this computer keeps working after the claim, so sharing needs no login.

An artist page without an owner holds up to 10 tracks. If sharing fails with `claim_required`, explain that and offer the email step. Never create another guest page or log out to get around it. Throwaway email addresses (Mailinator and the like) are refused.

Never share the built-in example collections or present them as the person's music. Never present music as verified human or AI work; soundroo.com only checks that a score renders with an official engine.

## When the person can't open the player

If you run somewhere the person's browser can't reach, like a cloud sandbox, a remote container or a server over SSH, a `127.0.0.1` address is useless to them. Say so, and offer to put the music on soundroo.com instead (same question as above), or point them to the rendered WAV file in `library/<name>/tracks/<id>/renders/` if they can download files from you. If your environment forwards ports, give the forwarded address.

## Listening notes and revisions

The player saves notes in `tracks/<id>/feedback.json` and new requests in `requests/`. Read them when the person comes back. `node bin/soundroo.js requests --library library/<name> --json` lists open requests. After you finish one, set its status to `done` with the resulting track ids. Keep the original request and its timestamps.

When they ask for a change, change only what they asked for and keep what they liked: the melody, the groove, the sections that work. Render again; the earlier version stays in the player for comparison. Keep their `mix.json` unless they ask for a new mix. After a change to shared music, ask whether to share the update; sharing again updates the same links.

## More music

After the first track, offer more: more tracks in the same style, a contrasting one, or a whole collection. Add new tracks to the same library so they share a player and a collection page.

## Words and voices

A `sample` part plays short spoken phrases. Built-in phrases like `builtin:made-of-light` work right away (see `catalog`). For the person's own words, a score can name them in a speech recipe, `"sample": { "speech": { "text": "...", "voice": "af_heart" }, "effect": "vocoder", "pitch": 60 }`. That needs the optional local voice model, installed once from the Soundroo folder:

```bash
npm install --no-save --package-lock=false kokoro-js@1.2.1 @huggingface/transformers@3.8.1
```

The first spoken render downloads the model. Don't make an instrumental track wait for it. Effects are `dry`, `tape`, `granular`, `vocoder` and `chop`. Use speech as rhythm, texture or a robot hook. Never promise singing.

A part can't share a WAV from the library's `assets/` folder on soundroo.com. Use a speech recipe instead, or leave that part out of the shared version.

## Remixing an open track

```bash
node bin/soundroo.js import https://soundroo.com/t/<id> --library library/<name> --json
```

This adds the exact shared score with its credit in `tracks/<id>/source.json`. Change the music before sharing the remix; an unchanged copy is refused. A shared remix links back to the original.

## Accounts and keys

- Keys live in soundroo-cloud's own configuration, never in a library. Never print, ask for or store them.
- `node bin/soundroo.js login --start --json` returns a link and a code for the person to open; finish with `login --wait --json`. Never open a browser for them. Sharing never needs it, not even after a claim. Log in only to edit or delete shared tracks from the command line, or to share as an existing account from another computer.
- Edit or delete shared music only when the person asks for that change. Preview with `--dry-run` first.
- [docs/sharing.md](docs/sharing.md) has every sharing command, option and exit code.

## Headless use

`src/headless.js` validates, renders and identifies scores for servers and other tools without the studio. See [docs/headless.md](docs/headless.md).

## Development

These notes are for people changing Soundroo itself. Use small topical commits. Run `npm run check` and `npm test` after changes, and check full renders, playback in the browser, saving and exports when you touch those. Keep dependencies minimal. Soundroo never calls a model or sends music anywhere on its own; only the sharing commands use the network, and only when the person asks.
