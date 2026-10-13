# Soundroo

**Music made with your coding agent.**

Describe a collection. Your agent composes the music, renders it locally and opens a studio where you can listen, keep favorites and shape the result. Every note stays editable.

## Make your music

Give this prompt to Claude Code, Codex or another coding agent with local shell access:

```text
Make me a collection of ten original music tracks about [your idea].
Use Soundroo: clone https://github.com/vincentsch/soundroo,
read its AGENTS.md and follow the steps.
Give the pieces distinct melodies and arrangements, then open the local
studio so I can listen. Keep the scores so we can change the music later.
```

Try an idea like a rainy city after midnight, a sunlit electronic record, quiet piano and mallets, or a collection of strange little musical worlds. The agent is the composer; Soundroo provides the instruments, rendering and listening studio. It does not call a model or music service behind the scenes. Your coding agent is a separate tool with its own requirements and prices.

## Listen first

![Soundroo's local listening studio showing Signal Garden](docs/studio.jpg)

The studio gives your music a home: original record sleeves, a collection view, track lists, favorites, a queue and a persistent player. Open a track to see its sections, leave notes at particular moments or compare rendered versions. A full-screen listening view responds to the playing audio. Search, shuffle, repeat, keyboard controls and light/dark themes are built in.

When you want to go deeper, open the mixer. Change instrument levels, pan, mute and solo, then save the mix as a new rendered version. Or simply tell your agent, “Keep the melody, make the drums softer, and give the middle section more room.” Your feedback and musical requests stay in the local library.

## Hear the examples

You need **Node.js 22 or newer**. The core works without installing any packages, music software, speech model or GPU.

```bash
git clone https://github.com/vincentsch/soundroo.git
cd soundroo
node bin/soundroo.js start
```

Open the local URL printed in the terminal. The first start prepares **The Open Window**, ten original example pieces across house, downtempo, ambient, synthwave, piano, broken beat, dub, kosmische, mallets and voice electronica. They are complete editable compositions with contrasting sections and endings, rather than ten randomized loops. The studio labels them as examples. They show the instrument palette; your agent creates a personal collection from your own brief.

The usual studio address is `http://127.0.0.1:4317`, so browser preferences and your listening position survive restarts. If that port is occupied, Soundroo prints another local address. Use `--port NUMBER` to choose one.

The repository is private, so cloning currently requires access.

## Words can become instruments

Soundroo can turn short spoken phrases into rhythmic chops, tape effects, granular textures and vocoder hooks. The example voice pieces work immediately with bundled short phrases. For your own words, the optional [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) speech model runs on your computer.

```bash
npm install --no-save --package-lock=false kokoro-js@1.2.1 @huggingface/transformers@3.8.1
node bin/soundroo.js voice create "We are made of light" --out library/assets/phrase.wav
node bin/soundroo.js voice process library/assets/phrase.wav --effect vocoder --pitch 60 --out library/assets/robot.wav
```

The first speech generation downloads the model once. Instrumental music and effects on existing speech need no model download. These are processed speech and musical textures; Kokoro is not a natural singing model.

## Keep the music

Download a rendered WAV, editable score, MIDI, instrument stems or a portable listening bundle from the studio. The bundle opens as a local web page with its audio and cover beside it. It uploads nothing.

MIDI keeps notes and timing with instrument mappings, rather than the exact synthesized sounds or spoken samples. Stems contain instrument buses before shared master processing and may not sum exactly to the mastered mix.

## Compose and extend

Soundroo uses ordinary JSON scores and small JavaScript composition helpers. Named patterns and clips let an agent develop a motif without rewriting each note. Its local instruments include electric piano, plucks, pads, bass, bells, mallets, analog and FM leads, percussion, acoustic-style approximations and processed speech. [The composing guide](docs/composing.md) includes a runnable example and the score format. [AGENTS.md](AGENTS.md) gives the complete agent workflow.

Useful commands:

```bash
node bin/soundroo.js --help
node bin/soundroo.js doctor
node bin/soundroo.js catalog --json
node bin/soundroo.js init library/my-music --title "After Hours"
node bin/soundroo.js validate my-track.json --json
node bin/soundroo.js add my-track.json --library library/my-music
node bin/soundroo.js render --all --library library/my-music --json
node bin/soundroo.js start library/my-music
```

Rendering checks find malformed scores, clipping, invalid samples and unexpected silence. They cannot judge musical taste. The default sound palette emphasizes electronic and synthesized instruments; piano and strings are approximations. Listen and revise the parts that matter to you.

## License

MIT. Copyright (c) 2026 Vincent Schmalbach. Dependency and optional speech-model licenses are in [Third party notices](THIRD_PARTY_NOTICES.md).
