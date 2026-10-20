# Headless engine

`src/headless.js` is Soundroo's engine without the music library, studio or CLI. A server, worker or test passes score JSON and receives validation issues, WAV bytes and render reports, MIDI, record sleeves and identities. It needs Node 22 or newer and no npm packages. Only speech recipes load the optional local Kokoro runtime.

The CLI and studio render through the same functions, so a headless render of a library score and mix produces the same WAV bytes, report and revision as `render` writes into `tracks/<id>/renders/`.

```js
import * as soundroo from './src/headless.js';

const check = soundroo.validate(score);
if (!check.valid) return { error: check.issues };            // [{path, message}]
await soundroo.prepareSpeech(score, { cacheDir });           // only scores with speech recipes
const { wav, report, revision } = await soundroo.render(score, { mix, speech: { cacheDir, synthesize: false } });
const midi = soundroo.midi(score);                           // Buffer
const svg = soundroo.sleeve(score, { index: 0, artwork });   // string
const fingerprint = soundroo.fingerprint(score);             // 'fp1:…'
```

## Exports

| Export | Result |
| --- | --- |
| `engineInfo()` | `{version, hash, scoreVersions, fingerprint, limits, speech: {model, dtype, weights, sha256, voices}}` |
| `engineHash()` | 64 hex characters identifying the rendering and validation source. |
| `engineManifest()` | `[{path, sha256, size}]`, the files behind the engine hash. |
| `LIMITS` | Hard limits for scores, pattern strings, speech, samples and sample rates. |
| `validate(score)` | `{valid, issues: [{path, message}]}`. Never throws. |
| `compile(score)` | The expanded score every render uses. Throws `ScoreValidationError` with `.issues`. |
| `render(score, options)` | `{revision, duration, sampleRate, wav, report, parts, stems?}`. |
| `revision(score, {mix, sampleRate, projectDir})` | 24 hex characters identifying one render's source. |
| `fingerprint(score)` | `fp1:` and 64 hex characters identifying the music. |
| `midi(score)` | Standard MIDI file bytes. |
| `sleeve(score, {index, artwork})` | The 800×800 SVG sleeve the studio shows. |
| `validateArtwork(artwork)` | `{valid, issues}` for `{style, colors, seed}`. |
| `speechRecipes(score, {cacheDir})` | `[{key, text, voice, file, cached}]` for each distinct recipe. |
| `prepareSpeech(score, options)` | Speaks uncached recipes and returns them with `synthesized`. |

`compile` returns version 1 shaped JSON for both score versions: defaults filled, clips and pattern strings expanded into sorted notes, patterns and clips removed. A version 2 score without speech therefore compiles into a score older engines can also render.

## Rendering

`render(score, options)` accepts:

| Option | Meaning |
| --- | --- |
| `mix` | `{parts: {id: {volume, pan, mute, solo}}, master: {volume}}`, as saved by the studio. |
| `sampleRate` | 8,000–96,000 Hz. Default 44,100. |
| `from`, `to` | Seconds on the score timeline for an excerpt. Synthesis and effects still run from the start. |
| `stems` | Adds `stems: {partId: wav}`: dry buses after part mix, before master processing. |
| `projectDir` | Library folder for `assets/` WAVs. Network scores should not use local WAVs. |
| `speech` | `{cacheDir, synthesize, modelDir, offline, log}` for speech recipes. |
| `progress`, `signal` | Progress callback and AbortSignal, as in `renderScore`. |

`wav` is a 16-bit stereo PCM WAV `Buffer`. The report contains duration, sample rate, peak and RMS (linear and dBFS), clipped and non-finite sample counts, silent fraction, a 360-point peak waveform, section times, `loudness` (integrated LUFS after mastering), `loudnessGainDb`, `limitedFraction` (share of the track the limiter turns down by more than 3 dB), warnings, arrangement `suggestions`, `revision` and `source`. Signal measurements diagnose problems; they do not judge music.

Errors:

- An invalid score throws `ScoreValidationError` with `.issues`, the same list `validate` returns.
- Invalid options throw `TypeError` or `RangeError` naming the option or mix part.
- Cancellation through `signal` or a `false` progress result throws `AbortError`.
- Audio with non-finite or full-scale samples throws an error carrying `.report`.
- A speech recipe missing from the cache with `synthesize: false` throws, naming the words and voice.

## Identities

**Engine hash.** SHA-256 over a manifest of `src/identity.js`, `src/score.js`, `src/notation.js`, `src/render.js`, `src/catalog.js`, `src/speech.js`, `src/headless.js`, every `src/audio/*.js` and the built-in `assets/voices/*.wav`. Each JavaScript file is read with LF line endings. The toolkit version, CLI, studio, library, sleeve, network and documentation files do not count, so a release that changes only those keeps its engine hash. `engineManifest()` lists the files to compare when a server copies an engine release.

**Revision.** The first 24 hex characters of SHA-256 over canonical JSON of `{engine, mix, sampleRate, score}`, plus the bytes of any referenced `assets/` WAV. Canonical JSON sorts object keys at every level, so key order and whitespace do not matter, but every value does. The score's title, `origin` or a saved mix all change the revision. Built-in phrases count through the engine hash. A speech recipe counts by its words and voice, not by its synthesized samples, so a server computes the same revision as the computer that rendered locally. Pass scores and mixes as parsed JSON objects; an empty object must stay `{}`, not become `[]`.

**Fingerprint.** `fp1:` and SHA-256 of the compiled music: tempo, and for each sounding part its instrument, effective tone controls including defaults, sample treatment and sorted note events rounded to a millionth. It ignores metadata, ids, names, colors, sections, seed, score length, part order, part volume and pan, master volume and reverb, artwork and the mix. Parts at zero volume or without notes are left out. It also ignores values the instrument never reads: drum and sample pitch, tom pitch beyond its 35–60 range, duration on struck and plucked sounds, and sample settings an effect does not use. A score written in version 2 notation shares its fingerprint with the same notes in version 1. Fingerprints identify exact musical copies only; any changed note produces a different fingerprint. The `fp1` prefix changes if the definition ever does.

## Speech recipes

A sample part can carry `sample.speech: {text, voice}` instead of `sample.asset`. The words are trimmed and their whitespace collapsed; `voice` defaults to `af_heart` and must be one of the 28 Kokoro voices in `getCatalog().speechVoices`. A score holds at most 16 distinct recipes of at most 200 characters each. Engines before 0.4.0 refuse these parts because they have no asset.

Every recipe uses Kokoro-82M v1.0 with 8-bit ONNX weights on the CPU (`engineInfo().speech`, including the SHA-256 of `onnx/model_quantized.onnx`). Install the runtime with `npm install --no-save --package-lock=false kokoro-js@1.2.1 @huggingface/transformers@3.8.1`. The model downloads to `$SOUNDROO_CACHE/models` (default `~/.cache/soundroo/models`) on first use; `offline: true` or `SOUNDROO_OFFLINE=1` uses only files already there. Each spoken phrase is cached once as a 32-bit float mono WAV named by its recipe key in `$SOUNDROO_CACHE/speech`, and every render reads that file, so a recipe sounds the same in each render that uses the cache. Speaking a recipe again reproduced the same samples on the machine where this was tested; other processors or runtime versions may differ slightly. That does not change the revision.

A server can list `speechRecipes(score)` to check the words, call `prepareSpeech` with its own `cacheDir`, then render with `speech: {cacheDir, synthesize: false}`. Each recipe's `file` is the phrase audio to offer with an open score. An importer that writes phrase audio to the same place lets a computer without Kokoro render the score. Speech recipes produce spoken word, rhythmic and processed textures, not natural singing.

## Limits

| Limit | Value |
| --- | --- |
| Score length | 600 seconds |
| Parts | 64 |
| Expanded note events | 100,000, and the same for source notes including pattern definitions |
| Patterns per part / clips per part | 128 / 4,096 |
| Characters per `line` or `steps` string | 16,384 |
| Speech recipes per score / characters per recipe | 16 / 200 |
| Sample WAVs | 32 MB, 60 seconds, 1–8 channels, 8–192 kHz |
| Render sample rate | 8,000–96,000 Hz |

`LIMITS` and `getCatalog().limits` expose these values.

## Determinism

The renderer never uses `Math.random`; seeds and part ids derive all randomness. The same score, mix, sample rate and engine render the same samples on a machine. Different processors and Node versions can change floating-point results slightly, so compare revisions rather than audio bytes across machines.
