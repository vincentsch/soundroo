# Grooves

A good groove makes a track feel alive before the melody starts. These are starting points in compact notation (version 2 `steps`). Each string covers one bar of four beats with sixteen steps: `X` loud, `x` normal, `o` soft, `.` rest. Copy a groove, then change it: move a kick, add a ghost note, drop the hats for a bar. Rhythm patterns like these are common building blocks, so using them is fine. Write your own melodies.

```json
"patterns": { "groove": { "beats": 4, "steps": "X...X...X...X..." } },
"clips": [{ "pattern": "groove", "beat": 0, "repeat": 16 }]
```

## Drum patterns

Live-band styles (rock, funk, soul, pop) sound best on the recorded acoustic kit: `rock-kick`, `rock-snare`, `closed-hat`, `open-hat`, `ride`, `tom` and `crash`. Dance, hip-hop and electronic styles use the drum-machine kit: `kick`, `snare`, `clap`, `hi-hat` and `shaker`.

| Style | Tempo | Kick | Snare or clap | Hats |
| --- | --- | --- | --- | --- |
| House, disco, dance-pop | 118 to 128 | `X...X...X...X...` | clap `....X.......X...` | open hat `..x...x...x...x.`, shaker `xoxoxoxoxoxoxoxo` |
| Rock, pop-punk | 120 to 175 | `rock-kick` `X.......X.X.....` | `rock-snare` `....X.......X...` | `x.x.x.x.x.x.x.x.` or `ride` |
| Funk | 96 to 118 | `X..x..X...X..x..` | `....X..o.o..X..o` | `XxoxXxoxXxoxXxox` |
| Breakbeat | 120 to 140 | `X.X.......X..x..` | `....X..x.x..X..x` | `x.x.x.x.x.x.x.xx` |
| Hip-hop, boom bap | 85 to 95 | `X......XX.....x.` | `....X.......X...` | `x.x.x.x.x.x.x.x.` |
| UK garage, two-step | 130 to 136 | `X.......X.x.....` | `....X.......X...` | `..x..xx...x..x.x` |
| Drum and bass | 170 to 176 | `X.........X.....` | `....X.......X...` | `x.x.x.x.x.x.x.x.` |
| Trap | 130 to 150 (half time) | `X......X..X.....` | clap `........X.......` | 8 beats: `x.x.x.x.x.xxx.x.xxxxx.x.x.x.xxxx` |
| Reggaeton, dembow | 90 to 100 | `X...X...X...X...` | `...X..X....X..X.` | `x.x.x.x.x.x.x.x.` |

Fills tell the listener that something new is coming. Put one in the last bar before a chorus or drop: a snare run like `....X..o.oX.XxXX`, toms walking down, or a kick that doubles up (`X.X.X.X.XXXXXXXX`). A crash on the first beat of the next section lands it.

## Bass that moves

The bass and the kick make the groove together. Let the bass hit with the kick, then answer in the gaps. A few shapes that work:

- Octave bounce for disco and house: `C2/.5 C3/.5` repeated, with the root changing per chord.
- Syncopated funk riff: `E2/.5 -/.25 E3/.25 -/.5 E2/.25 G2/.25 -/.5 A2/.5 B2/.25 -/.25 D3/.5`.
- Rock eighths that follow the guitar: `A1/.5 A1 A1 A1 A1 A1 G1 G1`.
- Boogie walk: `A1/.5 C#2 E2 F#2 G2 F#2 E2 C#2`.

One long note per chord is fine in a breakdown. In a chorus it sounds empty.

## Chords in rhythm

Play chords as short stabs, offbeat skanks or strums instead of long pads. Two examples: offbeat stabs `-/.5 [D4 F4 A4]/.5 -/.5 [D4 F4 A4]/.5` for house and dub, and muted sixteenth scratches on `guitar-clean` with `palmMute` for funk. Keep a pad underneath only when the track needs air.

## Energy across the track

Plan where the energy goes before you write notes. A short intro of four to eight bars, a groove section, a build with a fill or a riser (`noise`), a chorus or drop where everything plays and the hook moves up, a break where the drums or bass drop out, a final chorus, and a real ending. Change something every eight bars: add the open hat, double the hats, bring in the guitar, move the hook an octave up.
