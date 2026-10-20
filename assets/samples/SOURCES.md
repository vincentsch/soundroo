# Sources and processing

Every file here is a mono 16-bit PCM WAV (a plain RIFF header, one `fmt ` chunk, one `data` chunk) named
`<root>-<layer>-<rr>.wav`. The root is the MIDI note of the recorded pitch (for drums, the General MIDI note).
Layer 1 is the softest. `samples.json` lists the roots, the layer velocity limits and the round-robin count; for
strings and brass it also gives the sustain loop as `[startFrame, endFrame]`: playback runs from `startFrame` to
`endFrame - 1` and then jumps back to `startFrame`. The sample at `endFrame` is the same as the one at
`startFrame`, because the material after the loop continues from the loop start, so reading `endFrame` as
inclusive also works, and playing straight past the loop on release has no seam.

All sources are public domain or CC0. Nothing else was used. Total size of the WAV files: 29.02 MB.

## Shared processing

- Stereo sources are averaged to mono (0.5 L + 0.5 R). Multi-mic drums are summed at the levels given below.
- Resampling uses ffmpeg's soxr resampler (28-bit precision). Drums stay at their native 44.1 kHz.
- Start: each file starts 1.5 ms before the onset. The onset is the first sample that rises above the louder of
  (peak - 30 dB for piano, bass and guitars; peak - 36 dB for brass; peak - 40 dB for drums and strings) and
  12 dB over the noise floor before the attack. Any silence or noise before that is cut (`leading_trim_s` in
  `qa.json`). The drum recordings begin right on the hit, so 1.5 ms of silence was added in front of them
  instead (`silence_padding_s`).
- A 1 ms raised-cosine fade-in was applied where the first non-silent sample was above -66 dBFS.
- End: a raised-cosine fade over the last 15% of the file, at most 0.4 s. The last sample is zero.
- Level: within an instrument every file gets the same gain, so the natural dynamics stay, and the loudest file
  peaks at -1 dBFS. Exceptions are noted per instrument (guitars, and the section matching in strings and brass).
- Pitch: every pitched file was measured against its root. Anything more than 15 cents off was corrected by
  resampling before trimming. `qa.json` has the measured value of every file before and after.
- Quantised to 16 bits with TPDF dither.

## piano (60 files, 10.50 MB, 32 kHz)

- Source: Salamander Grand Piano V3, recorded by Alexander Holm (Yamaha C5, two AKG C414 in AB). Samples taken
  from the SFZ edition at https://github.com/sfzinstruments/SalamanderGrandPiano, commit
  `3382bf9496bba2486f5ab0de55a264d1dfc38404` (originally https://archive.org/details/SalamanderGrandPianoV3).
- License: public domain. The author dedicated all of his sample libraries to the public domain on 4 March 2022:
  https://rytmenpinne.wordpress.com/2022/03/04/good-news-everyone/ and
  https://rytmenpinne.wordpress.com/sounds-and-such/salamander-grandpiano/ ("As of 4.3.2022, this is now public
  domain!"). The LICENSE file in the SFZ repository still carries the older CC BY 3.0 text from before that date.
  Only the recordings were used here, not the SFZ mapping.
- Velocity layers: `v6` (the SFZ maps it to velocity 47-50) for layer 1 and `v13` (velocity 97-104) for layer 2.
  As recorded they are about 6-6.5 dB apart and v13 is noticeably brighter in the bass.
- Lengths: 4.0 s up to root 45, 3.0 s for 46-71, 2.0 s for 72-95, 1.2 s from 96. Common gain +5.26 dB.
- Pitch: the Salamander piano is stretch-tuned. The fundamentals of A0, C1 and D#1 were 17-25 cents flat, and
  C7 to C8 were 18-39 cents sharp; C8 was 99.8 cents sharp (its strings sound almost at C#8). These were
  corrected so the fundamental sits on the root. A0, C1 and D#1 still sound slightly sharp after the correction
  because their upper partials are stretched (the YIN estimate reads +10 to +25 cents); the uncorrected notes
  from F#1 to A6 are within 15 cents (A6 is +14.8).

| File | Source file(s) | Pitch fix | Final pitch |
|---|---|---|---|
| `piano/21-1-1.wav` | `Samples/A0v6.flac` | +25.3 c | +0.0 c |
| `piano/21-2-1.wav` | `Samples/A0v13.flac` | +25.4 c | +0.0 c |
| `piano/24-1-1.wav` | `Samples/C1v6.flac` | +24.8 c | +0.0 c |
| `piano/24-2-1.wav` | `Samples/C1v13.flac` | +24.8 c | +0.0 c |
| `piano/27-1-1.wav` | `Samples/D#1v6.flac` | +17.1 c | +0.0 c |
| `piano/27-2-1.wav` | `Samples/D#1v13.flac` | +17.1 c | +0.0 c |
| `piano/30-1-1.wav` | `Samples/F#1v6.flac` |  | -10.3 c |
| `piano/30-2-1.wav` | `Samples/F#1v13.flac` |  | -10.3 c |
| `piano/33-1-1.wav` | `Samples/A1v6.flac` |  | -6.6 c |
| `piano/33-2-1.wav` | `Samples/A1v13.flac` |  | -6.6 c |
| `piano/36-1-1.wav` | `Samples/C2v6.flac` |  | -8.8 c |
| `piano/36-2-1.wav` | `Samples/C2v13.flac` |  | -8.5 c |
| `piano/39-1-1.wav` | `Samples/D#2v6.flac` |  | -7.6 c |
| `piano/39-2-1.wav` | `Samples/D#2v13.flac` |  | -7.6 c |
| `piano/42-1-1.wav` | `Samples/F#2v6.flac` |  | -4.9 c |
| `piano/42-2-1.wav` | `Samples/F#2v13.flac` |  | -5.0 c |
| `piano/45-1-1.wav` | `Samples/A2v6.flac` |  | -3.2 c |
| `piano/45-2-1.wav` | `Samples/A2v13.flac` |  | -3.1 c |
| `piano/48-1-1.wav` | `Samples/C3v6.flac` |  | -4.5 c |
| `piano/48-2-1.wav` | `Samples/C3v13.flac` |  | -4.5 c |
| `piano/51-1-1.wav` | `Samples/D#3v6.flac` |  | -2.7 c |
| `piano/51-2-1.wav` | `Samples/D#3v13.flac` |  | -2.7 c |
| `piano/54-1-1.wav` | `Samples/F#3v6.flac` |  | -4.2 c |
| `piano/54-2-1.wav` | `Samples/F#3v13.flac` |  | -4.1 c |
| `piano/57-1-1.wav` | `Samples/A3v6.flac` |  | -0.1 c |
| `piano/57-2-1.wav` | `Samples/A3v13.flac` |  | -0.2 c |
| `piano/60-1-1.wav` | `Samples/C4v6.flac` |  | -1.0 c |
| `piano/60-2-1.wav` | `Samples/C4v13.flac` |  | -1.1 c |
| `piano/63-1-1.wav` | `Samples/D#4v6.flac` |  | +0.0 c |
| `piano/63-2-1.wav` | `Samples/D#4v13.flac` |  | +0.1 c |
| `piano/66-1-1.wav` | `Samples/F#4v6.flac` |  | -2.7 c |
| `piano/66-2-1.wav` | `Samples/F#4v13.flac` |  | -2.6 c |
| `piano/69-1-1.wav` | `Samples/A4v6.flac` |  | +0.9 c |
| `piano/69-2-1.wav` | `Samples/A4v13.flac` |  | +1.1 c |
| `piano/72-1-1.wav` | `Samples/C5v6.flac` |  | +3.5 c |
| `piano/72-2-1.wav` | `Samples/C5v13.flac` |  | +3.3 c |
| `piano/75-1-1.wav` | `Samples/D#5v6.flac` |  | +3.3 c |
| `piano/75-2-1.wav` | `Samples/D#5v13.flac` |  | +3.1 c |
| `piano/78-1-1.wav` | `Samples/F#5v6.flac` |  | +4.4 c |
| `piano/78-2-1.wav` | `Samples/F#5v13.flac` |  | +4.3 c |
| `piano/81-1-1.wav` | `Samples/A5v6.flac` |  | +6.9 c |
| `piano/81-2-1.wav` | `Samples/A5v13.flac` |  | +6.7 c |
| `piano/84-1-1.wav` | `Samples/C6v6.flac` |  | +8.9 c |
| `piano/84-2-1.wav` | `Samples/C6v13.flac` |  | +8.5 c |
| `piano/87-1-1.wav` | `Samples/D#6v6.flac` |  | +7.3 c |
| `piano/87-2-1.wav` | `Samples/D#6v13.flac` |  | +8.0 c |
| `piano/90-1-1.wav` | `Samples/F#6v6.flac` |  | +11.7 c |
| `piano/90-2-1.wav` | `Samples/F#6v13.flac` |  | +12.1 c |
| `piano/93-1-1.wav` | `Samples/A6v6.flac` |  | +14.8 c |
| `piano/93-2-1.wav` | `Samples/A6v13.flac` |  | +14.5 c |
| `piano/96-1-1.wav` | `Samples/C7v6.flac` | -23.6 c | +0.0 c |
| `piano/96-2-1.wav` | `Samples/C7v13.flac` | -23.1 c | +0.0 c |
| `piano/99-1-1.wav` | `Samples/D#7v6.flac` | -19.0 c | +0.0 c |
| `piano/99-2-1.wav` | `Samples/D#7v13.flac` | -18.3 c | +0.0 c |
| `piano/102-1-1.wav` | `Samples/F#7v6.flac` | -24.2 c | +0.0 c |
| `piano/102-2-1.wav` | `Samples/F#7v13.flac` | -23.7 c | +0.0 c |
| `piano/105-1-1.wav` | `Samples/A7v6.flac` | -38.8 c | +0.3 c |
| `piano/105-2-1.wav` | `Samples/A7v13.flac` | -38.6 c | +0.0 c |
| `piano/108-1-1.wav` | `Samples/C8v6.flac` | -99.8 c | +0.0 c |
| `piano/108-2-1.wav` | `Samples/C8v13.flac` | -99.8 c | +0.0 c |

## Drums: rock-kick, rock-snare, closed-hat, open-hat, tom, crash, ride (44.1 kHz)

- Source: Big Rusty Drums by Karoryfer Lecolds, https://github.com/sfzinstruments/karoryfer.big-rusty-drums,
  commit `f07ce00df34a46b6b08375be56fe116cf15782bc`.
- License: CC0 1.0 (LICENSE file in the repository), https://creativecommons.org/publicdomain/zero/1.0/
- Mic levels come from the default program (`Programs/default/01-full.sfz` `set_cc` values) and the
  `amplitude_ccN` of each mapping: level = amplitude/100 x cc/127. The stereo overhead files are averaged to mono
  first.
- Velocity choice: for each layer except the top one, the source velocity group that contains the point 60% of
  the way through the layer's range; the top layer uses the hardest group.

| Instrument | Source articulation | Mix | Velocity groups used | Length | Common gain | Size |
|---|---|---|---|---|---|---|
| rock-kick (36) | `kick_24/kick`, rr1 and rr2 | kick mic 0.787, overheads 0.40 through a 300 Hz 12 dB/oct high-pass (as the program does for this layer), snare mic 0.08 | vl4, vl8, vl11, vl14 of 14 | 0.8 s | +0.76 dB | 0.56 MB |
| rock-snare (38) | `snare_14/center`, rr1 and rr2 | bottom 0.787 with polarity inverted, top 0.315, overheads 0.472 | vl3, vl6, vl8, vl10 of 10 | 1.0 s | -0.79 dB | 0.71 MB |
| closed-hat (42) | `hihat_14/tc` (tight closed tip hit), rr1 and rr2 | close 0.551, overheads 0.551 | vl3, vl6, vl8 of 8 | 0.45 s | +13.06 dB | 0.24 MB |
| open-hat (46) | `hihat_14/ho` (half open), rr1 | close 0.551, overheads 0.551 | vl2, vl4 of 4 | 1.6 s | +10.91 dB | 0.28 MB |
| tom (41, 45, 48, 50) | `tom_22`, `tom_18`, `tom_15`, `tom_14` center hits, rr1 | close 0.787, overheads 0.551 | 22": vl3, vl7 of 7; 18": vl3, vl8 of 8; 15": vl3, vl7 of 7; 14": vl3, vl6 of 6 | 1.2 s | +3.02 dB | 0.85 MB |
| crash (49) | `crash_17/cr`, rr1 | close 0.220, overheads 0.551 | vl2, vl5 of 5 | 3.5 s | +16.52 dB | 0.62 MB |
| ride (51) | `ride_22/rd` (bow), rr1 | close 0.189, overheads 0.472 | vl4, vl10 of 10 | 2.5 s | +11.83 dB | 0.44 MB |

Notes on the drum choices:

- Kick: in the default program the kick overhead and the kick's snare-mic ("dirt") faders are at 0, so only
  the kick mic plays there. The overheads and snare mic were added as asked, at levels in the range the bundled
  Aria presets use (overhead fader 0.40, snare-mic fader 0.20 of its 40% maximum).
- Snare: the bottom mic is at 100 and the top at 40 in the default program. With the bottom mic inverted the
  100-500 Hz energy of the mix is 1.0-2.0 dB higher than as recorded (checked on every file), so it was inverted.
- Closed hat: General MIDI note 42 in the default program plays the tight-closed `tc` samples.
- Open hat: the default program's fully open `open` hat rings for about 7 s before it is 40 dB down, which is
  very washy for a 1.6 s file. The half-open `ho` hat is 40 dB down after about 1.8 s and was used instead.
- Toms: the snare-mic "dirt" layer of the toms is 0 in the default program and was left out.

| File | Source files (summed) |
|---|---|
| `rock-kick/36-1-1.wav` | `Samples/kick_24/kick/kick/k_vl4_rr1.flac`<br>`Samples/kick_24/kick/oh/k_vl4_rr1.flac`<br>`Samples/kick_24/kick/sn/k_vl4_rr1.flac` |
| `rock-kick/36-1-2.wav` | `Samples/kick_24/kick/kick/k_vl4_rr2.flac`<br>`Samples/kick_24/kick/oh/k_vl4_rr2.flac`<br>`Samples/kick_24/kick/sn/k_vl4_rr2.flac` |
| `rock-kick/36-2-1.wav` | `Samples/kick_24/kick/kick/k_vl8_rr1.flac`<br>`Samples/kick_24/kick/oh/k_vl8_rr1.flac`<br>`Samples/kick_24/kick/sn/k_vl8_rr1.flac` |
| `rock-kick/36-2-2.wav` | `Samples/kick_24/kick/kick/k_vl8_rr2.flac`<br>`Samples/kick_24/kick/oh/k_vl8_rr2.flac`<br>`Samples/kick_24/kick/sn/k_vl8_rr2.flac` |
| `rock-kick/36-3-1.wav` | `Samples/kick_24/kick/kick/k_vl11_rr1.flac`<br>`Samples/kick_24/kick/oh/k_vl11_rr1.flac`<br>`Samples/kick_24/kick/sn/k_vl11_rr1.flac` |
| `rock-kick/36-3-2.wav` | `Samples/kick_24/kick/kick/k_vl11_rr2.flac`<br>`Samples/kick_24/kick/oh/k_vl11_rr2.flac`<br>`Samples/kick_24/kick/sn/k_vl11_rr2.flac` |
| `rock-kick/36-4-1.wav` | `Samples/kick_24/kick/kick/k_vl14_rr1.flac`<br>`Samples/kick_24/kick/oh/k_vl14_rr1.flac`<br>`Samples/kick_24/kick/sn/k_vl14_rr1.flac` |
| `rock-kick/36-4-2.wav` | `Samples/kick_24/kick/kick/k_vl14_rr2.flac`<br>`Samples/kick_24/kick/oh/k_vl14_rr2.flac`<br>`Samples/kick_24/kick/sn/k_vl14_rr2.flac` |
| `rock-snare/38-1-1.wav` | `Samples/snare_14/center/top/sn_center_vl3_rr1.flac`<br>`Samples/snare_14/center/btm/sn_center_vl3_rr1.flac`<br>`Samples/snare_14/center/oh/sn_center_vl3_rr1.flac` |
| `rock-snare/38-1-2.wav` | `Samples/snare_14/center/top/sn_center_vl3_rr2.flac`<br>`Samples/snare_14/center/btm/sn_center_vl3_rr2.flac`<br>`Samples/snare_14/center/oh/sn_center_vl3_rr2.flac` |
| `rock-snare/38-2-1.wav` | `Samples/snare_14/center/top/sn_center_vl6_rr1.flac`<br>`Samples/snare_14/center/btm/sn_center_vl6_rr1.flac`<br>`Samples/snare_14/center/oh/sn_center_vl6_rr1.flac` |
| `rock-snare/38-2-2.wav` | `Samples/snare_14/center/top/sn_center_vl6_rr2.flac`<br>`Samples/snare_14/center/btm/sn_center_vl6_rr2.flac`<br>`Samples/snare_14/center/oh/sn_center_vl6_rr2.flac` |
| `rock-snare/38-3-1.wav` | `Samples/snare_14/center/top/sn_center_vl8_rr1.flac`<br>`Samples/snare_14/center/btm/sn_center_vl8_rr1.flac`<br>`Samples/snare_14/center/oh/sn_center_vl8_rr1.flac` |
| `rock-snare/38-3-2.wav` | `Samples/snare_14/center/top/sn_center_vl8_rr2.flac`<br>`Samples/snare_14/center/btm/sn_center_vl8_rr2.flac`<br>`Samples/snare_14/center/oh/sn_center_vl8_rr2.flac` |
| `rock-snare/38-4-1.wav` | `Samples/snare_14/center/top/sn_center_vl10_rr1.flac`<br>`Samples/snare_14/center/btm/sn_center_vl10_rr1.flac`<br>`Samples/snare_14/center/oh/sn_center_vl10_rr1.flac` |
| `rock-snare/38-4-2.wav` | `Samples/snare_14/center/top/sn_center_vl10_rr2.flac`<br>`Samples/snare_14/center/btm/sn_center_vl10_rr2.flac`<br>`Samples/snare_14/center/oh/sn_center_vl10_rr2.flac` |
| `closed-hat/42-1-1.wav` | `Samples/hihat_14/tc/cl/ht_tc_vl3_rr1.flac`<br>`Samples/hihat_14/tc/oh/ht_tc_vl3_rr1.flac` |
| `closed-hat/42-1-2.wav` | `Samples/hihat_14/tc/cl/ht_tc_vl3_rr2.flac`<br>`Samples/hihat_14/tc/oh/ht_tc_vl3_rr2.flac` |
| `closed-hat/42-2-1.wav` | `Samples/hihat_14/tc/cl/ht_tc_vl6_rr1.flac`<br>`Samples/hihat_14/tc/oh/ht_tc_vl6_rr1.flac` |
| `closed-hat/42-2-2.wav` | `Samples/hihat_14/tc/cl/ht_tc_vl6_rr2.flac`<br>`Samples/hihat_14/tc/oh/ht_tc_vl6_rr2.flac` |
| `closed-hat/42-3-1.wav` | `Samples/hihat_14/tc/cl/ht_tc_vl8_rr1.flac`<br>`Samples/hihat_14/tc/oh/ht_tc_vl8_rr1.flac` |
| `closed-hat/42-3-2.wav` | `Samples/hihat_14/tc/cl/ht_tc_vl8_rr2.flac`<br>`Samples/hihat_14/tc/oh/ht_tc_vl8_rr2.flac` |
| `open-hat/46-1-1.wav` | `Samples/hihat_14/ho/cl/ht_ho_vl2_rr1.flac`<br>`Samples/hihat_14/ho/oh/ht_ho_vl2_rr1.flac` |
| `open-hat/46-2-1.wav` | `Samples/hihat_14/ho/cl/ht_ho_vl4_rr1.flac`<br>`Samples/hihat_14/ho/oh/ht_ho_vl4_rr1.flac` |
| `tom/41-1-1.wav` | `Samples/tom_22/center/cl/t22_vl3_rr1.flac`<br>`Samples/tom_22/center/oh/t22_vl3_rr1.flac` |
| `tom/41-2-1.wav` | `Samples/tom_22/center/cl/t22_vl7_rr1.flac`<br>`Samples/tom_22/center/oh/t22_vl7_rr1.flac` |
| `tom/45-1-1.wav` | `Samples/tom_18/center/cl/t18_vl3_rr1.flac`<br>`Samples/tom_18/center/oh/t18_vl3_rr1.flac` |
| `tom/45-2-1.wav` | `Samples/tom_18/center/cl/t18_vl8_rr1.flac`<br>`Samples/tom_18/center/oh/t18_vl8_rr1.flac` |
| `tom/48-1-1.wav` | `Samples/tom_15/center/cl/t15_vl3_rr1.flac`<br>`Samples/tom_15/center/oh/t15_vl3_rr1.flac` |
| `tom/48-2-1.wav` | `Samples/tom_15/center/cl/t15_vl7_rr1.flac`<br>`Samples/tom_15/center/oh/t15_vl7_rr1.flac` |
| `tom/50-1-1.wav` | `Samples/tom_14/center/cl/t14_vl3_rr1.flac`<br>`Samples/tom_14/center/oh/t14_vl3_rr1.flac` |
| `tom/50-2-1.wav` | `Samples/tom_14/center/cl/t14_vl6_rr1.flac`<br>`Samples/tom_14/center/oh/t14_vl6_rr1.flac` |
| `crash/49-1-1.wav` | `Samples/crash_17/cr/cl/cr_vl2_rr1.flac`<br>`Samples/crash_17/cr/oh/cr_vl2_rr1.flac` |
| `crash/49-2-1.wav` | `Samples/crash_17/cr/cl/cr_vl5_rr1.flac`<br>`Samples/crash_17/cr/oh/cr_vl5_rr1.flac` |
| `ride/51-1-1.wav` | `Samples/ride_22/rd/cl/rd_vl4_rr1.flac`<br>`Samples/ride_22/rd/oh/rd_vl4_rr1.flac` |
| `ride/51-2-1.wav` | `Samples/ride_22/rd/cl/rd_vl10_rr1.flac`<br>`Samples/ride_22/rd/oh/rd_vl10_rr1.flac` |

## electric-bass (28 files, 3.09 MB, 22.05 kHz)

- Source: Fashionbass by Karoryfer Lecolds (a Killer KB-Simmony bass, played and mapped by D. Smolken),
  https://github.com/sfzinstruments/karoryfer.fashionbass, commit `0703973b300a6bacb837602be9b588ab64732a72`.
- License: CC0 1.0 (LICENSE file in the repository), https://creativecommons.org/publicdomain/zero/1.0/
- Files `notes/<note>_mf_rr1.wav` (layer 1) and `notes/<note>_f_rr1.wav` (layer 2), roots 24 to 62. The note names
  use standard octaves (c1 sounds at about 33 Hz, C1 = 32.7 Hz, MIDI 24). The source grid is c1, d1, then every 3 semitones from f1;
  there is no eb1, so the first gap is 2 semitones.
- 44.1 kHz mono float to 22.05 kHz, 2.5 s, common gain +0.48 dB.
- Pitch: c1 was 22 cents (mf) and 32 cents (f) sharp and was corrected. Every other file is within 12.4 cents.

| File | Source file(s) | Pitch fix | Final pitch |
|---|---|---|---|
| `electric-bass/24-1-1.wav` | `notes/c1_mf_rr1.wav` | -22.1 c | +0.2 c |
| `electric-bass/24-2-1.wav` | `notes/c1_f_rr1.wav` | -32.4 c | +0.5 c |
| `electric-bass/26-1-1.wav` | `notes/d1_mf_rr1.wav` |  | +5.3 c |
| `electric-bass/26-2-1.wav` | `notes/d1_f_rr1.wav` |  | -9.8 c |
| `electric-bass/29-1-1.wav` | `notes/f1_mf_rr1.wav` |  | -8.8 c |
| `electric-bass/29-2-1.wav` | `notes/f1_f_rr1.wav` |  | -9.8 c |
| `electric-bass/32-1-1.wav` | `notes/ab1_mf_rr1.wav` |  | -12.4 c |
| `electric-bass/32-2-1.wav` | `notes/ab1_f_rr1.wav` |  | -11.1 c |
| `electric-bass/35-1-1.wav` | `notes/b1_mf_rr1.wav` |  | +4.7 c |
| `electric-bass/35-2-1.wav` | `notes/b1_f_rr1.wav` |  | +1.0 c |
| `electric-bass/38-1-1.wav` | `notes/d2_mf_rr1.wav` |  | +3.7 c |
| `electric-bass/38-2-1.wav` | `notes/d2_f_rr1.wav` |  | +2.8 c |
| `electric-bass/41-1-1.wav` | `notes/f2_mf_rr1.wav` |  | +2.0 c |
| `electric-bass/41-2-1.wav` | `notes/f2_f_rr1.wav` |  | +1.0 c |
| `electric-bass/44-1-1.wav` | `notes/ab2_mf_rr1.wav` |  | +0.9 c |
| `electric-bass/44-2-1.wav` | `notes/ab2_f_rr1.wav` |  | -0.8 c |
| `electric-bass/47-1-1.wav` | `notes/b2_mf_rr1.wav` |  | +1.2 c |
| `electric-bass/47-2-1.wav` | `notes/b2_f_rr1.wav` |  | +0.7 c |
| `electric-bass/50-1-1.wav` | `notes/d3_mf_rr1.wav` |  | -5.3 c |
| `electric-bass/50-2-1.wav` | `notes/d3_f_rr1.wav` |  | -6.2 c |
| `electric-bass/53-1-1.wav` | `notes/f3_mf_rr1.wav` |  | +3.8 c |
| `electric-bass/53-2-1.wav` | `notes/f3_f_rr1.wav` |  | +3.6 c |
| `electric-bass/56-1-1.wav` | `notes/ab3_mf_rr1.wav` |  | -3.6 c |
| `electric-bass/56-2-1.wav` | `notes/ab3_f_rr1.wav` |  | -3.5 c |
| `electric-bass/59-1-1.wav` | `notes/b3_mf_rr1.wav` |  | -0.4 c |
| `electric-bass/59-2-1.wav` | `notes/b3_f_rr1.wav` |  | +1.0 c |
| `electric-bass/62-1-1.wav` | `notes/d4_mf_rr1.wav` |  | -0.2 c |
| `electric-bass/62-2-1.wav` | `notes/d4_f_rr1.wav` |  | -0.6 c |

## guitar-clean (18 files, 2.88 MB, 32 kHz)

- Source: FreePats Electric Guitar FSBS (clean), version 2026-08-07, by the FreePats project
  (http://freepats.zenvoid.org/ElectricGuitar/clean-electric-guitar.html),
  https://github.com/freepats/electric-guitar-FSBS-clean, commit `192cf0d9bf2c4ba6ead8e3524ba3f78818e4fe91`.
  The FLAC files are in the repository, so the release archive was not needed.
- License: CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/
- Files `samples/bridge/<note>_01.flac`: the normal (not soft) layer, first round robin, roots 40 to 85 (E2 to C#6).
- 48 kHz stereo to mono, then 32 kHz, 2.5 s. Every source file is normalized to 0 dBFS, so each note was first
  matched on K-weighted RMS over its first 300 ms (per-note change -2.9 to +3.7 dB), then one common gain of
  -2.76 dB brings the loudest peak to -1 dBFS.

| File | Source file(s) | Pitch fix | Final pitch |
|---|---|---|---|
| `guitar-clean/40-1-1.wav` | `samples/bridge/E2_s1_01.flac` |  | +1.3 c |
| `guitar-clean/41-1-1.wav` | `samples/bridge/F2_s1_01.flac` |  | -2.1 c |
| `guitar-clean/45-1-1.wav` | `samples/bridge/A2_s2_01.flac` |  | +2.9 c |
| `guitar-clean/48-1-1.wav` | `samples/bridge/C3_s2_01.flac` |  | -5.8 c |
| `guitar-clean/50-1-1.wav` | `samples/bridge/D3_s3_01.flac` |  | -2.8 c |
| `guitar-clean/52-1-1.wav` | `samples/bridge/E3_s3_01.flac` |  | +1.9 c |
| `guitar-clean/55-1-1.wav` | `samples/bridge/G3_s4_01.flac` |  | -7.9 c |
| `guitar-clean/59-1-1.wav` | `samples/bridge/B3_s5_01.flac` |  | -1.8 c |
| `guitar-clean/61-1-1.wav` | `samples/bridge/C#4_s5_01.flac` |  | -3.0 c |
| `guitar-clean/64-1-1.wav` | `samples/bridge/E4_s6_01.flac` |  | -1.2 c |
| `guitar-clean/67-1-1.wav` | `samples/bridge/G4_s6_01.flac` |  | -0.2 c |
| `guitar-clean/71-1-1.wav` | `samples/bridge/B4_s6_01.flac` |  | -0.1 c |
| `guitar-clean/72-1-1.wav` | `samples/bridge/C5_s6_01.flac` |  | -1.4 c |
| `guitar-clean/74-1-1.wav` | `samples/bridge/D5_s6_01.flac` |  | +3.3 c |
| `guitar-clean/77-1-1.wav` | `samples/bridge/F5_s6_01.flac` |  | +1.7 c |
| `guitar-clean/80-1-1.wav` | `samples/bridge/G#5_s6_01.flac` |  | -0.4 c |
| `guitar-clean/82-1-1.wav` | `samples/bridge/A#5_s6_01.flac` |  | +2.6 c |
| `guitar-clean/85-1-1.wav` | `samples/bridge/C#6_s6_01.flac` |  | -1.9 c |

## guitar-crunch (18 files, 2.30 MB, 32 kHz)

- Source: FreePats Electric Guitar FSBS (direct), version 2022-09-11, the unprocessed DI recording of the same
  guitar, https://github.com/freepats/electric-guitar-FSBS-direct, commit
  `4c1d54601836c3e1a262b0bb0f3dea0c0a881ad3`. The WAV files are in the repository.
- License: CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/
- Files `samples/bridge/<note>_01.wav` (48 kHz mono), same roots as guitar-clean, 2.0 s. Same per-note RMS match
  (-4.2 to +3.2 dB) and a common gain of -4.06 dB. No distortion was added.
- Some DI notes have up to 48 ms of string and pick noise before the note; it was cut.

| File | Source file(s) | Pitch fix | Final pitch |
|---|---|---|---|
| `guitar-crunch/40-1-1.wav` | `samples/bridge/E2_s1_01.wav` |  | +0.5 c |
| `guitar-crunch/41-1-1.wav` | `samples/bridge/F2_s1_01.wav` |  | -2.3 c |
| `guitar-crunch/45-1-1.wav` | `samples/bridge/A2_s2_01.wav` |  | +3.1 c |
| `guitar-crunch/48-1-1.wav` | `samples/bridge/C3_s2_01.wav` |  | -4.0 c |
| `guitar-crunch/50-1-1.wav` | `samples/bridge/D3_s3_01.wav` |  | -2.3 c |
| `guitar-crunch/52-1-1.wav` | `samples/bridge/E3_s3_01.wav` |  | +1.7 c |
| `guitar-crunch/55-1-1.wav` | `samples/bridge/G3_s4_01.wav` |  | -8.0 c |
| `guitar-crunch/59-1-1.wav` | `samples/bridge/B3_s5_01.wav` |  | -1.9 c |
| `guitar-crunch/61-1-1.wav` | `samples/bridge/C#4_s5_01.wav` |  | -3.2 c |
| `guitar-crunch/64-1-1.wav` | `samples/bridge/E4_s6_01.wav` |  | -1.4 c |
| `guitar-crunch/67-1-1.wav` | `samples/bridge/G4_s6_01.wav` |  | -0.3 c |
| `guitar-crunch/71-1-1.wav` | `samples/bridge/B4_s6_01.wav` |  | -0.2 c |
| `guitar-crunch/72-1-1.wav` | `samples/bridge/C5_s6_01.wav` |  | -1.4 c |
| `guitar-crunch/74-1-1.wav` | `samples/bridge/D5_s6_01.wav` |  | +3.3 c |
| `guitar-crunch/77-1-1.wav` | `samples/bridge/F5_s6_01.wav` |  | +1.7 c |
| `guitar-crunch/80-1-1.wav` | `samples/bridge/G#5_s6_01.wav` |  | -0.3 c |
| `guitar-crunch/82-1-1.wav` | `samples/bridge/A#5_s6_01.wav` |  | +2.4 c |
| `guitar-crunch/85-1-1.wav` | `samples/bridge/C#6_s6_01.wav` |  | -2.1 c |

## strings (16 files, 3.71 MB, 32 kHz, looped)

- Source: VSCO 2 Community Edition by Versilian Studios (Sam Gossner) and Ivy Audio (Simon Dalzell), sample
  editing by Elan Hickler (Soundemote), https://github.com/sgossner/VSCO-2-CE, commit
  `440300901dfe9275fd84e0b7763af1f8443ae62e`. Homepage: http://vis.versilstudios.net/vsco-community.html
- License: CC0 1.0 (LICENSE file in the repository), https://creativecommons.org/publicdomain/zero/1.0/. The
  readme asks for credit to Versilian Studios / Sam Gossner and Ivy Audio / Simon Dalzell, given here.
- VSCO note names are one octave low. Every file was measured: for example `susvib_C1` sounds at 65.4 Hz (C2,
  root 36) and `ViolaEns_susvib_G2` at 196 Hz (G3, root 55).
- Cello section `susvib` at the louder `v3` for roots 36-53, viola section `susvib` `v2` for 55-65, violin section
  `susVib` `v2` for 69-86. Steps are at most 4 semitones. The highest ensemble sustain in VSCO is D6 (86), so notes
  above 86 have to be pitched up from it (10 semitones at 96).
- The slow lead-in is trimmed at the first bow sound (onset rule above, -40 dB). Files are 2.6 to 4.7 s long.
- Sections were recorded at different gains, so they were matched where they meet (K-weighted RMS inside the
  loop of the two notes on each side of the split): viola +4.10 dB and
  violin +7.42 dB relative to cello. Inside a section the natural
  levels are kept. Common gain +4.39 dB.
- Loops: chosen automatically inside the steady sustain (after the attack, at least 1.6 s long, the most even
  level over the loop, matching level and pitch at both ends, and a near-zero correlation between the two
  crossfaded parts). The 250 ms before the loop start is crossfaded into the last 250 ms of the loop with an
  equal-power (sine/cosine) curve, and the file continues after the loop end with the material that follows the
  loop start. Each file was rendered looped to 10 s; at every junction the sample step and the 50 ms level step
  are within the note's own variation inside the loop (`loop_render_10s` in `qa.json`). Loop positions:
  36-1-1: 0.55-2.15 s, 40-1-1: 1.37-3.08 s, 43-1-1: 0.55-2.15 s, 47-1-1: 2.11-4.22 s, 50-1-1: 0.59-2.45 s, 53-1-1: 1.73-3.53 s, 55-1-1: 1.35-3.15 s, 59-1-1: 1.11-2.82 s, 62-1-1: 2.35-3.95 s, 65-1-1: 1.23-3.38 s, 69-1-1: 0.87-2.57 s, 72-1-1: 2.09-3.89 s, 76-1-1: 2.15-3.76 s, 79-1-1: 1.39-2.98 s, 83-1-1: 0.79-2.44 s, 86-1-1: 1.89-3.49 s.

| File | Source file(s) | Pitch fix | Final pitch |
|---|---|---|---|
| `strings/36-1-1.wav` | `Strings/Cello Section/susvib/susvib_C1_v3_1.wav` |  | -0.2 c |
| `strings/40-1-1.wav` | `Strings/Cello Section/susvib/susvib_E1_v3_1.wav` |  | -4.8 c |
| `strings/43-1-1.wav` | `Strings/Cello Section/susvib/susvib_G1_v3_1.wav` |  | +0.2 c |
| `strings/47-1-1.wav` | `Strings/Cello Section/susvib/susvib_B1_v3_1.wav` |  | -0.3 c |
| `strings/50-1-1.wav` | `Strings/Cello Section/susvib/susvib_D2_v3_1.wav` |  | -0.4 c |
| `strings/53-1-1.wav` | `Strings/Cello Section/susvib/susvib_F2_v3_1.wav` |  | +0.1 c |
| `strings/55-1-1.wav` | `Strings/Viola Section/susvib/ViolaEns_susvib_G2_v2_1.wav` |  | +0.8 c |
| `strings/59-1-1.wav` | `Strings/Viola Section/susvib/ViolaEns_susvib_B2_v2_1.wav` |  | +0.9 c |
| `strings/62-1-1.wav` | `Strings/Viola Section/susvib/ViolaEns_susvib_D3_v2_1.wav` |  | -2.1 c |
| `strings/65-1-1.wav` | `Strings/Viola Section/susvib/ViolaEns_susvib_F3_v2_1.wav` |  | +0.1 c |
| `strings/69-1-1.wav` | `Strings/Violin Section/susVib/VlnEns_susVib_A3_v2.wav` |  | +0.1 c |
| `strings/72-1-1.wav` | `Strings/Violin Section/susVib/VlnEns_susVib_C4_v2.wav` |  | +0.8 c |
| `strings/76-1-1.wav` | `Strings/Violin Section/susVib/VlnEns_susVib_E4_v2.wav` |  | +0.4 c |
| `strings/79-1-1.wav` | `Strings/Violin Section/susVib/VlnEns_susVib_G4_v2.wav` |  | -0.6 c |
| `strings/83-1-1.wav` | `Strings/Violin Section/susVib/VlnEns_susVib_B4_v2.wav` |  | +1.5 c |
| `strings/86-1-1.wav` | `Strings/Violin Section/susVib/VlnEns_susVib_D5_v2.wav` |  | +1.9 c |

## brass (14 files, 2.84 MB, 32 kHz, looped)

- Source and license: VSCO 2 Community Edition as above (CC0 1.0).
- Tenor trombone `sus` at the loudest `v3` for roots 39, 41, 46, 50, 53. Trumpet `sus` `v3` for roots 60-81. The
  tenor trombone set has no notes between F2 and A#2 or between F3 and C4, so two notes come from VSCO's
  "OldTrombone" folder (a 1950s Olds Super tenor trombone, an unreleased test set in the same CC0 repository),
  at its loudest `v5`: A2 (root 45) and A3 (root 57). Their brightness is close to the neighbouring tenor
  trombone notes. With them the steps are at most 4 semitones from 39 to 81.
- Same octave naming issue as the strings; every file was measured.
- Level matching (K-weighted RMS inside the loop): the Olds A2 was matched to the average of its tenor trombone
  neighbours (41 and 46), and the two lowest trumpet notes (60, 63) to the two trombone notes below the split
  (53, 57). Result: Olds trombone -11.25 dB and trumpet
  -12.23 dB relative to the tenor trombone (both were recorded much
  hotter). Common gain +15.05 dB.
- Files are 2.6 to 4.0 s long. Loops as for strings with a 200 ms crossfade, at least 1.6 s: 39-1-1: 1.17-2.88 s, 41-1-1: 0.51-2.45 s, 45-1-1: 1.17-2.78 s, 46-1-1: 1.87-3.47 s, 50-1-1: 1.37-3.03 s, 53-1-1: 0.87-2.52 s, 57-1-1: 0.81-2.65 s, 60-1-1: 0.97-2.62 s, 63-1-1: 0.51-2.11 s, 67-1-1: 0.99-2.58 s, 70-1-1: 0.69-2.30 s, 74-1-1: 1.43-3.33 s, 77-1-1: 0.41-2.10 s, 81-1-1: 0.85-2.50 s.
- The A5 trumpet (root 81) drifts about 6 cents within its sustain; the loop crossfade smooths it.

| File | Source file(s) | Pitch fix | Final pitch |
|---|---|---|---|
| `brass/39-1-1.wav` | `Brass/Tenor Trombone/sus/tenortbn_sus_D#1_v3_1.wav` |  | -0.1 c |
| `brass/41-1-1.wav` | `Brass/Tenor Trombone/sus/tenortbn_sus_F1_v3_1.wav` |  | -0.1 c |
| `brass/45-1-1.wav` | `Brass/OldTrombone/Sustain/Trombone_Sustain_A1_v5_1.wav` |  | +0.3 c |
| `brass/46-1-1.wav` | `Brass/Tenor Trombone/sus/tenortbn_sus_A#1_v3_1.wav` |  | +0.2 c |
| `brass/50-1-1.wav` | `Brass/Tenor Trombone/sus/tenortbn_sus_D2_v3_1.wav` |  | +0.0 c |
| `brass/53-1-1.wav` | `Brass/Tenor Trombone/sus/tenortbn_sus_F2_v3_1.wav` |  | -0.1 c |
| `brass/57-1-1.wav` | `Brass/OldTrombone/Sustain/Trombone_Sustain_A2_v5_1.wav` |  | +0.2 c |
| `brass/60-1-1.wav` | `Brass/Trumpet/sus/Sum_SHTrumpet_sus_C3_v3_rr1.wav` |  | -2.0 c |
| `brass/63-1-1.wav` | `Brass/Trumpet/sus/Sum_SHTrumpet_sus_D#3_v3_rr1.wav` |  | -0.5 c |
| `brass/67-1-1.wav` | `Brass/Trumpet/sus/Sum_SHTrumpet_sus_G3_v3_rr1.wav` |  | +3.7 c |
| `brass/70-1-1.wav` | `Brass/Trumpet/sus/Sum_SHTrumpet_sus_A#3_v3_rr1.wav` |  | +1.2 c |
| `brass/74-1-1.wav` | `Brass/Trumpet/sus/Sum_SHTrumpet_sus_D4_v3_rr1.wav` |  | +0.7 c |
| `brass/77-1-1.wav` | `Brass/Trumpet/sus/Sum_SHTrumpet_sus_F4_v3_rr1.wav` |  | -2.0 c |
| `brass/81-1-1.wav` | `Brass/Trumpet/sus/Sum_SHTrumpet_sus_A4_v3_rr1.wav` |  | +4.2 c |
