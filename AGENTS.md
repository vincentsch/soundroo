# Soundroo

Soundroo is a music creation toolkit for coding agents with a finished local listening studio. Original standalone music and artistic collections are the primary use. Games, videos and app sounds are additional uses, never the default positioning.

## Product contract

- Give a shell-capable coding agent this repository and a musical brief. The agent makes a collection of ten original compositions, renders and checks them, then starts the local studio and returns its URL.
- The user listens, plays favorites, compares revisions and exports music. Mixing and deeper controls are optional. The main experience is a beautiful music library with actual playable tracks.
- Core rendering is local JavaScript on Node 22+, without accounts, API keys, Python, ffmpeg or model weights. Speech synthesis is optional; plain instrumental playback must work independently.
- Keep every composition editable and keep its source. Never present fixed starter compositions as music personalized for a user. A built-in example collection is clearly labeled.
- Compose original motifs and develop them. Do not recreate recognizable copyrighted melodies. Named artist references describe broad musical qualities, not an instruction to copy a tune.
- Voice experiments process speech as spoken word, rhythmic chops, textures or vocoder effects. Do not claim natural singing from a speech model.

## Development


Use small topical commits. Run meaningful checks for scores, rendering, project persistence, HTTP/API behavior, browser playback and exports. Keep dependencies minimal and use existing ordinary mechanisms. Feature scope is the finished product; avoid turning routine engineering into extra policy or operational subsystems. Fix observed real failures. Reviews end when no material defect remains.



This guide will gain the composer workflow and API reference as implementation is completed.
