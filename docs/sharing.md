# Sharing on soundroo.com

Sharing is optional. Composing, rendering, listening, the studio and every export work offline without an account, a download or a network connection. Only the commands on this page contact a Soundroo service. With `--dry-run` they contact nothing and write nothing; only `cloud`, which passes its arguments to soundroo-cloud unchanged, previews just the commands that change something there.

A share sends the editable scores of a collection. soundroo.com renders the audio itself with an official Soundroo engine and gives you links that play anywhere: a collection page, a page per track and short links for both. No account is needed for the first share.

## Share a collection

Render everything first. A track is shared only when its current render matches its current score and mix, so the service publishes the music you heard.

```bash
node bin/soundroo.js render --all --library library/my-music
node bin/soundroo.js share --library library/my-music --dry-run
node bin/soundroo.js share --library library/my-music --rights-accepted
```

The dry run lists the tracks, their sharing choices and the request it would send. It downloads nothing, sends nothing and writes nothing.

The real share prints the collection link, each track's link and, for a new artist, a claim link. The links work immediately; each track plays once the service has rendered it, usually within a minute or two. The command waits for rendering by default (`--no-wait` returns right away, `--timeout SECONDS` limits the wait).

`--rights-accepted` is required. Pass it only after the person sharing the music has confirmed they have the right to share it: the music is original or properly credited and does not copy someone else's melody, lyrics or recording.

## What is sent and what stays here

| Sent to the service | Stays on this computer |
| --- | --- |
| Each selected track's score and current mix settings | Rendered audio and stems |
| Sleeve settings that are part of the score | Listening notes, favorites and requests |
| The collection title and description, and a brief if you pass `--brief` | Voice files and other library files |
| The engine version and engine hash, and your sharing choices | Your keys (kept by soundroo-cloud, see below) |

The service renders every sound from the score. It checks that each track renders with an official Soundroo engine and refuses exact copies of another artist's music. It cannot tell whether a person or an AI model wrote a score, and it does not claim to.

Built-in example tracks are never shared. A personal library that contains examples skips them and says so.

### Voices

Built-in voice phrases (`builtin:made-of-light` and the others listed by `catalog`) and spoken text recipes (`"speech": {"text": "…", "voice": "af_heart"}`) share normally; the service speaks recipes with the same local speech model. A part that plays a WAV from the library's `assets/` folder cannot be shared, because the service never accepts uploaded audio. Replace the asset with a text recipe or remove the part, render again, then share.

## Choices

| Option | Meaning |
| --- | --- |
| `--visibility unlisted` | Anyone with the link can listen. The default for a first share. |
| `--visibility public` | Listed on soundroo.com once your artist page is claimed. |
| `--visibility private` | Only you can play it, after signing in. |
| `--access open` | Listeners can download the score, audio and MIDI and remix them with credit under CC BY 4.0. The default. |
| `--access listen-only` | Streaming only, no downloads or remixes. |
| `--tracks a,b,c` | Share only these tracks. |
| `--artist "Name"` | The name of a new guest artist. Without it the service picks one. |
| `--service URL` | Another Soundroo service, such as a local development server. Also `SOUNDROO_URL`. |

Sharing again updates the same collection: changed tracks get a new version at the same links, and the older versions stay with the track on the service. Visibility and access you changed on the website are kept unless you pass the option again. When nothing changed since the last share, nothing is sent. A share interrupted by a lost connection can simply be run again; it reuses its request key, so the service never publishes it twice.

`node bin/soundroo.js share status --library library/my-music` shows what the library shared, from its `sharing.json`. Add `--refresh` to ask the service for the latest rendering status; with `--dry-run` as well, it only says what it would ask.

## Your artist page

The first share creates an artist page without an owner, with a generated name, and stores a key that can only publish. Every later share from this computer goes to the same page. Its music is unlisted: anyone with a link can listen, but it is not listed on soundroo.com. A page without an owner holds up to 10 tracks; new versions of those tracks are always fine. Beyond that, sharing stops with `claim_required`.

To keep the page, confirm an email address:

```bash
node bin/soundroo.js claim --email you@example.com
```

soundroo.com emails a link that works once and expires after an hour. Pressing its button signs the person in: a new address creates an account that takes over the artist page, and an existing account receives the music. Either way the links stay the same, the music can be listed publicly and the 10-track limit no longer applies. Throwaway email services are refused. `--dry-run` shows the request without sending it.

The first share's answer also includes a **claim link**. It does the same thing in a browser: open it and sign in with Google, GitHub or an email link. Keep it private, because whoever opens it can claim the page. It works once and expires after 30 days; `node bin/soundroo.js claim-link` asks for a fresh one.

The key on this computer keeps working after the claim, so you can share again right away. Only editing or deleting shared tracks from the command line needs an account key. For that, connect this computer:

```bash
node bin/soundroo.js login
```

`login` prints a link and a short code. Open the link in any browser, sign in and approve the code. Soundroo never opens a browser by itself. Agents use the two halves separately: `login --start --json` returns the link and code to show the person, and `login --wait --json` finishes once they approve it.

`whoami` shows the artist a key publishes as and its collections. `logout --confirm` revokes the key on the service and removes it from this computer; for a guest key it repeats the claim link one last time. Save that link: this computer no longer keeps it, and without the key no new one can be made.

### Updating after the key changed

A shared library stays with the artist page that shared it, and only that page's owner can update it. Before updating, the toolkit checks that this computer's key may edit the library's collection, and stops before anything is sent when it may not:

- **Claim first, then log in.** Open the guest page's claim link while signed in to your Soundroo account, then run `login`, then share again.
- **Connected an account before claiming?** The guest page and its music stay where they are. `login` prints the guest page's claim link, `node bin/soundroo.js cloud auth status` shows it and the studio's Share dialog offers it. Open it while signed in to that account, then share again.
- **Logged out, or on another computer?** Open the claim link of the page that shared the library (your first share and `logout` printed it) while signed in, then run `login` and share again. If the page is already claimed, `login` with that account is enough.

Starting over with a new guest artist does not work: the service refuses music that another artist page already published.

## In the studio

The studio's **Share on Soundroo** button opens the same flow: choose tracks, who can listen and whether downloads are open, read what is sent, and tick the rights confirmation. The studio server prepares the scores and talks to the service; the page never sees a key. Progress, the collection and track links and the claim link appear in the dialog. Opening the dialog reads the library only; nothing is sent until you press Share.

For an update, both choices start as **Unchanged**: each track keeps what is set on the service, including changes made on the website, unless you pick another value. When the library was shared as a guest page this computer no longer publishes as, the dialog shows that page and, when it has one, its saved claim link before you update.

## Remix an open track

```bash
node bin/soundroo.js import https://soundroo.com/@artist/track-name --library library/my-music
```

Use the track page's address or its short link (`https://soundroo.com/t/TRACK-ID`). Import downloads the exact score and mix the artist shared and checks them against the service's revision. It adds the track under a free id and records the credit, license and original track in `tracks/<id>/source.json`. Credit the artist when you share or play the remix for others. Listen-only tracks have no score to import. `--dry-run` checks the link and says what it would download; nothing is downloaded or saved.

Change the music before sharing it: an unchanged copy is refused. A changed remix shares with a link to the original.

## For scripts and agents

Every network command accepts `--json` and prints one JSON document on standard output. `share`, `share status --refresh`, `import`, `login`, `logout`, `whoami`, `claim` and `claim-link` accept `--dry-run` for a preview that contacts nothing and writes nothing. A failure prints `{"error": "…", "code": "…", "exitCode": n}` with `issues` (path and message) and a `hint` when useful, and `claimUrl` when a saved claim link is the way forward; give it to the person privately. Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | Done |
| 1 | Invalid request or music that cannot be shared yet (`render_required`, `rights_not_accepted`, `local_audio`, `validation_failed`, …) |
| 2 | The service or network failed, or soundroo-cloud could not be used |
| 3 | No key, or the key was not accepted (`key_missing`, `auth_invalid`, `auth_required`) |
| 4 | The key is not allowed to do that (`artist_mismatch`, `forbidden`, `claim_required` when a page without an owner is full) |
| 5 | Not found |
| 6 | The service asked to slow down |

A successful share returns `service`, `libraryUid`, `status` (`queued`, `rendering`, `ready` or `failed`), `release`, `collection` (`id`, `title`, `url`, `shortUrl`, `visibility`), `artist`, `tracks` (each with `localId`, `id`, `title`, `url`, `shortUrl`, `status`, `access`, `visibility`), `skipped`, `claimUrl` (or `null`), `credential` and `unchanged` when nothing was sent.

## soundroo-cloud

Network requests go through `soundroo-cloud`, a small command-line tool built with the [rungrad](https://github.com/vincentsch/rungrad) CLI framework. It follows `rungrad-spec/1`: stable JSON output, `--dry-run` previews, confirmation before destructive actions and fixed exit codes.

The toolkit downloads it on the first real share, login or import, from the service you share with: `<service>/downloads/cli/manifest.json` lists a build per platform with its size and SHA-256. The download must come from that same origin over HTTPS (plain HTTP only for a server on this computer), redirects to other hosts are refused, the file is checked before it is installed and again before every run, and it is never run through a shell. It is cached in `~/.cache/soundroo/cloud/` (or `$SOUNDROO_CACHE/cloud/`). A cached build serves only the service it came from, or another service whose manifest lists the same build; it is never used for a service that did not vouch for it, because it reads that service's key.

To use your own build instead, install Go 1.22 or newer and run:

```bash
cd cloud-cli && go build -o soundroo-cloud .
export SOUNDROO_CLOUD_BIN="$PWD/soundroo-cloud"
```

`node scripts/build-cloud.mjs` builds reproducible binaries for Linux, macOS and Windows on amd64 and arm64, with the manifest, in `cloud-cli/dist/`.

You can run it directly through the toolkit, for example `node bin/soundroo.js cloud track update TRACK-ID --access listen-only --dry-run` or `node bin/soundroo.js cloud --help`. There, `--dry-run` previews the commands that change something; reads such as `track show` always ask the service.

### Keys

Keys live in soundroo-cloud's own configuration, never in a library: `credentials.json` in your user configuration folder (`~/.config/soundroo-cloud/` on Linux), owner-only, with one entry per service origin. A key made for a development server is never sent to soundroo.com and the other way round. `accounts.json` beside it holds the artist name and the private claim link. `SOUNDROO_TOKEN` overrides the stored key, for scripts and CI. `SOUNDROO_CLOUD_CONFIG` or `--config` selects another configuration file.

Keys never appear in output: soundroo-cloud masks them and removes any copy a service might echo.

## Troubleshooting

- **“Render this track so you share what you heard”**: render the listed tracks and share again.
- **“plays the local recording”**: convert the part to a speech recipe or remove it.
- **“does not offer soundroo-cloud downloads”**: the service has no downloads yet. Build soundroo-cloud from `cloud-cli/` and set `SOUNDROO_CLOUD_BIN`.
- **“did not accept the stored key”** (`auth_invalid`): the key was revoked or expired. If it belonged to a guest page that is not claimed yet, open that page's claim link while signed in to your Soundroo account (`node bin/soundroo.js cloud auth status` shows it), then run `login` and share again.
- **“this computer has no key for it”** (`key_missing`) or **“which cannot update that collection”** (`artist_mismatch`): the library belongs to another artist page than the one this computer publishes as. See [Updating after the key changed](#updating-after-the-key-changed).
- **Refused as music another artist already published**: if it is your music, share it as the artist page that published it (see above). For a remix, change the arrangement first.
