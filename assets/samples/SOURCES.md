# Sources and processing

The recorded instruments play from seven sample packs, 3.87 GB together. A pack is one file holding
an instrument's recordings as ordinary PCM WAV files one after another (a plain RIFF header, one `fmt ` chunk,
one `data` chunk each), written by `scripts/samples/build.py` in a fixed order, so the same sources always give
the same bytes. `samples.json` maps notes to recordings (an SFZ-like map; see the docstring of
`scripts/samples/build.py`), records where each recording's audio starts in its pack, its peak and how its tail
decays, and gives every pack's size, SHA-256 and download address. The packs are published as assets of the
`samples-2026-11` release of this repository; the toolkit downloads the ones a track needs and checks them
against the SHA-256 here.

Nothing was cut down to save space: every recording keeps its own sample rate, channels (stereo where the source
is stereo), bit depth or 24 bits where processing changed the values, velocity layers, alternative takes and full
length. Engines 0.6.0 to 0.7.0 used mono excerpts of the same libraries at 22-32 kHz with two layers.

All sources are public domain or CC0. Nothing else was used.

## piano (641 files, 1961.0 MB, 48 kHz, stereo, 24-bit)

- Source: Salamander Grand Piano V3, recorded by Alexander Holm (Yamaha C5, two AKG C414 in AB about 12 cm above
  the strings), in the SFZ edition at https://github.com/sfzinstruments/SalamanderGrandPiano, commit
  `3382bf9496bba2486f5ab0de55a264d1dfc38404` (originally https://archive.org/details/SalamanderGrandPianoV3).
- License: public domain. The author dedicated all of his sample libraries to the public domain on 4 March 2022:
  https://rytmenpinne.wordpress.com/2022/03/04/good-news-everyone/ and
  https://rytmenpinne.wordpress.com/sounds-and-such/salamander-grandpiano/ ("As of 4.3.2022, this is now public
  domain!"). The LICENSE file in the SFZ repository still carries the older CC BY 3.0 text from before that date.
- Built by `scripts/samples/piano.py`. Pack SHA-256 `e16534fa7ce1ee93ce0980a70a25298bd7571ac0048aaafa96760e26e96b8303`.
- Every recording is copied bit for bit from the FLAC sources (checked against them): 480 notes (30 pitches in
  minor thirds from A0 to C8, 16 velocity layers each), 88 key-release (hammer and damper) sounds, 69 string
  resonance sounds that sound when a key is released, and four pedal sounds.
- Mapping and behaviour follow the SFZ program (`Salamander Grand Piano V3.sfz` and its `Data/` files): the velocity
  ranges of the 16 layers; the "Retuned" tuning by Markus Fiedler (cents per region); amp_veltrack 27% (the layers
  carry the dynamics); a 1 s damper release, while notes from F#6 up have no dampers and ring out naturally; a key
  struck again fades its earlier sound over 0.5 s; release sounds at -37 dB (hammer, 82% velocity tracking, 2 dB
  quieter per second the key was held) and the string resonances at their program levels and decay rates; pedal
  sounds at -20 dB (down) and -19 dB (up). The release sounds play when the damper falls, that is when both the
  key and the sustain pedal are up.

## electric-bass (361 files, 251.5 MB, 44.1 kHz, mono, 24-bit)

- Source: Fashionbass by Karoryfer Lecolds (a Killer KB-Simmony bass, played and mapped by D. Smolken, recorded
  direct with the neck pickup), https://github.com/sfzinstruments/karoryfer.fashionbass, commit
  `0703973b300a6bacb837602be9b588ab64732a72`.
- License: CC0 1.0 (LICENSE file in the repository), https://creativecommons.org/publicdomain/zero/1.0/
- Built by `scripts/samples/bass.py`. Pack SHA-256 `2849069b1dbdd98b907559719e7611a4f6373de1f4fad8e37a49219bdd20d1d4`.
- Mapped exactly as `fashionbass.sfz`: 19 pitches from G♭0 to A4, five velocity layers (pp to ff, with the program's
  linear level curve up to each layer's top velocity) and three takes each, plus the string release sounds (four
  takes, -8 dB, 5 dB quieter per second held). The muted-string and fingering noises the program puts on keys 84
  and up are not used. The 32-bit float sources are stored at 24 bits, unchanged otherwise.

## guitar-clean (120 files, 668.7 MB, 48 kHz, stereo, 24-bit) and guitar-crunch (120 files, 327.2 MB, 48 kHz, mono, 24-bit)

- Source: FreePats Electric Guitar FSBS by the FreePats project (a Fender guitar, bridge pickup):
  clean version 2026-08-07, https://github.com/freepats/electric-guitar-FSBS-clean, commit
  `192cf0d9bf2c4ba6ead8e3524ba3f78818e4fe91` (amp and effects, stereo), and the unprocessed direct recording,
  version 2022-09-11, https://github.com/freepats/electric-guitar-FSBS-direct, commit
  `4c1d54601836c3e1a262b0bb0f3dea0c0a881ad3` (mono), which the engine overdrives for `guitar-crunch`.
- License: CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/
- Built by `scripts/samples/guitars.py`. Pack SHA-256 clean `1b136ee646714fb2335875423ae7d8d84a9cb2fd6b2cea75f54c80beac476dc1`, crunch
  `0485429dc33d2a6bd78ab6f6aad58f8122edcd04544b6f7fcb2174fa46e4da80`.
- Mapped as their SFZ files: 19 pitches from C2 to C#6, a soft layer up to velocity 92 and a normal one above, four
  takes each, full length. Every source file is normalized to full scale, which hides how loud each note was
  played, so each file is matched on K-weighted loudness (ITU-R BS.1770) over its first 300 ms to the median of
  all files, then one common gain brings the loudest peak to -1 dBFS; velocity then shapes the level along the
  SFZ default curve.

## drums pack: rock-kick, rock-snare, closed-hat, open-hat, tom, crash, ride (306 files, 375.0 MB, 44.1 kHz, stereo, 24-bit)

- Source: Big Rusty Drums by Karoryfer Lecolds, https://github.com/sfzinstruments/karoryfer.big-rusty-drums,
  commit `f07ce00df34a46b6b08375be56fe116cf15782bc`.
- License: CC0 1.0 (LICENSE file in the repository), https://creativecommons.org/publicdomain/zero/1.0/
- Built by `scripts/samples/drums.py`. Pack `drums.pack`, SHA-256
  `30ac145fd4b7041ec7cec9f99d69e8f46f19d3219335c08d568685d477993e1b`, 375,015,864 bytes.
- Every velocity layer and every round robin of the articulation is used, at full length (no trimming, no
  fades, no per-file normalization). The source files are 16-bit 44.1 kHz FLAC; after mixing the microphones
  each hit is written as 24-bit stereo at 44.1 kHz, so no requantization to 16 bits happens.
- Microphone mix, as the default program (`Programs/default/01-full.sfz`) sets it up: level =
  `amplitude_ccN`/100 x `set_ccN`/127. Overhead pairs stay stereo and unpanned (the program's overhead pan
  curves are centred on each piece's default position, so at the default settings they are not moved). Close
  microphones are mono and panned where the program pans them: `pan_ccN=100` on the program's bipolar curve 9
  (0 at cc 63, -1 at 0, +1 at 127). Panning is equal power with unity gain per channel at the centre (L =
  √2·cos θ, R = √2·sin θ, θ = (pan + 1)·π/4, the engine's own pan law), so the mid of a centred close mic
  equals its mono level and the mono sum of each hit matches the October mono mix.
- Velocity groups (`lovel`/`hivel`) and round robins (`seq_position`) come from each articulation's close-mic
  mapping file in `Programs/mappings/`. Inside every group the program sets `amp_velcurve_<hivel>=1`: the level
  rises linearly with velocity up to the group's top velocity. The instrument specs say so with
  `"layerVelocity": "linear"` (gain = velocity / hivel of the region) and `veltrack` 0, so a player that does
  not apply it still plays every layer at its recorded level.
- One common gain per instrument brings its loudest file to -1 dBFS; relative levels between layers, round
  robins and (for the toms) drums are as recorded.

| Instrument (GM key) | Articulation, mapping | Microphones and levels | Close-mic pan | Velocity groups x round robins | Files, size, length | Common gain |
|---|---|---|---|---|---|---|
| rock-kick (36) | `kick_24/kick`, `kick_24/k_kick.sfz` | kick mic 0.787 (cc70 100); overheads 0.40 through the program's 300 Hz 2-pole high-pass; snare mic 0.08 | centre | 14 x 4 | 56, 25.2 MB, 1.70 s | +0.05 dB |
| rock-snare (38) | `snare_14/center`, `snare_14/sn_center_btm.sfz` | bottom 0.787 (cc80 100) with polarity inverted; top 0.315 (cc81 40); overheads 0.472 (cc82 60) | cc88 63: centre | 10 x 4 | 40, 20.4 MB, 1.93 s | -1.10 dB |
| closed-hat (42) | `hihat_14/tc` (tight closed), `hihat_14/ht_tc_cl.sfz` | close 0.551 (amplitude 70 x cc15 100); overheads 0.551 (70 x cc16 100) | cc17 63: centre | 8 x 4 | 32, 9.7 MB, 1.14 s | +6.34 dB |
| open-hat (46) | `hihat_14/ho` (half open), `hihat_14/ht_ho_cl.sfz` | close 0.551; overheads 0.551 | cc17 63: centre | 4 x 4 | 16, 16.1 MB, 3.79 s | +4.07 dB |
| tom (41, 45, 48, 50) | `tom_22`, `tom_18`, `tom_15`, `tom_14` center hits, `tom_NN/tom_NN_cl.sfz` | close 0.787 (cc30/34/38/42 100); overheads 0.551 (cc31/35/39/43 70) | 22": cc32 107 → +0.6875; 18": cc36 87 → +0.375; 15": cc40 40 → -0.365; 14": cc44 20 → -0.683 | 22": 7 x 4; 18": 8 x 4; 15": 7 x 4; 14": 6 x 4 | 112, 74.5 MB, 2.27-2.98 s | +0.62 dB |
| crash (49) | `crash_17/cr`, `crash_17/cr_cl.sfz` | close 0.220 (amplitude 70 x cc100 40); overheads 0.551 (70 x cc101 100) | cc102 30 → -0.524 | 5 x 4 | 20, 83.1 MB, 13.8-17.2 s | +9.16 dB |
| ride (51) | `ride_22/rd` (bow), `ride_22/rd_cl.sfz` | close 0.189 (amplitude 60 x cc104 40); overheads 0.472 (60 x cc105 100) | cc106 97 → +0.531 | 10 x 3 | 30, 146.2 MB, 18.4 s | +7.33 dB |

Notes on the choices (unchanged from the October build):

- Kick: in the default program the kick overhead (cc71) and snare-mic "dirt" (cc72) faders are at 0, so only the
  kick mic plays there. The overheads and snare mic are mixed in at levels in the range the bundled Aria
  presets use (overhead fader 0.40, snare-mic fader 0.20 of its 40% maximum), the overheads through the 300 Hz
  2-pole high-pass the program applies to that layer.
- Snare: with the bottom mic inverted the 100-500 Hz energy of the mix is 1.0-2.0 dB higher than as recorded.
- Closed hat: General MIDI note 42 in the default program plays the tight-closed `tc` samples.
- Open hat: the default program's fully open `open` hat rings for about 7 s before it is 40 dB down; the
  half-open `ho` hat is used instead. Its pedal-position volume curve (`amplitude_cc4`) is not applied.
- Toms: the snare-mic "dirt" layer of the toms is 0 in the default program and is left out. The instrument maps
  MIDI 35-60 to the nearest drum (35-43 → 22", 44-46 → 18", 47-49 → 15", 50-60 → 14"; a tie goes to the lower
  drum as in earlier engines), with the drum's GM key as the recorded pitch and `maxShift` 3.
- All instruments are one-shot (they ring out whatever the note length); every piece except the toms is
  unpitched.
- Not applied from the program: amplitude envelopes (`ampeg_hold`/`decay`/`sustain` are 100% sustain at the
  default settings, so they change nothing), choke groups (`group`/`off_by`), the non-kick low cut (cc77 0) and
  the master limiter effect.

## strings (33 files, 126.2 MB, 44.1 kHz stereo, 24-bit, looped)

- Source: VSCO 2 Community Edition by Versilian Studios (Sam Gossner) and Ivy Audio (Simon Dalzell), sample
  editing by Elan Hickler (Soundemote), https://github.com/sgossner/VSCO-2-CE, commit
  `440300901dfe9275fd84e0b7763af1f8443ae62e`. Homepage: http://vis.versilstudios.net/vsco-community.html
- License: CC0 1.0 (LICENSE file in the repository), https://creativecommons.org/publicdomain/zero/1.0/. The
  readme asks for credit to Versilian Studios / Sam Gossner and Ivy Audio / Simon Dalzell, given here.
- Built by `scripts/samples/vsco.py` (`build_strings`). Pack SHA-256 `f213ba7083e17670a4a14dc300f15cfdecc4049f0eba663637f7c805e5eb93f3`.
- The same notes as before: cello section `susvib` for roots 36-53, viola section `susvib` for 55-65, violin section
  `susVib` for 69-86 (steps of at most 4 semitones; notes above 86 are pitched up from D6). Every dynamic layer VSCO
  has for these articulations is used: cello `v1` and `v3`, viola `v1` and `v2`, violin `v1` and `v2`. The cello's
  E1 `v1` has a second take (`_2`), used as a round robin; no other note has one. VSCO ships no SFZ for these, so
  the layers split MIDI velocity evenly: 1-64 soft, 65-127 loud. A key plays the nearest root (ties go to the lower).
- Stereo as recorded, at the files' own 44.1 kHz and full length (6-15 s; before, 2.6-4.7 s mono at 32 kHz).
  Cello and viola are 24-bit sources, violin 16-bit; all are stored at 24 bits because loops and gains change the
  values.
- VSCO note names are one octave low (`susvib_C1` sounds at C2, root 36). Every file was measured (YIN, median
  over the steady sustain) and its deviation is corrected by the region's `tune` instead of resampling; the
  largest was 3.8 cents. Re-measured from the pack, every region plays within 1.9 cents of its key.
- Lead-in: cut 1.5 ms before the first bow sound (the louder of peak - 40 dB and 12 dB over the noise before it),
  with a 1 ms fade-in when the cut lands on sound. The natural release after the sustain stays; the last 10 ms of
  each file fade out.
- Loops: chosen automatically inside the steady sustain (0.25 s after the level reaches within 6 dB of the
  steady level, up to 0.25 s before it falls away, searching the first 12 s), at least 1.6 s, scored on the most
  even 50 ms level over the loop, matching level at both ends, matching pitch at both ends and a near-zero
  correlation of the two crossfaded parts on both channels, with a small preference for longer loops (they now run
  1.6-10.8 s). The 250 ms before the loop start is crossfaded into the last 250 ms of the loop with an equal-power
  (sine/cosine) curve, and the file continues after the loop end with the material that follows the loop start.
  Each file was played looped to at least two junctions: the sample step at every junction is at most 0.66 of the
  note's own 99.9th-percentile step inside the loop; where the 50 ms level step at a junction exceeded the largest
  step between neighbouring windows inside the loop (three files), the original recording has the same step at
  the loop start (vibrato and bow movement).
- Level: sections were recorded at different gains, so they were matched where they meet (K-weighted power inside
  the loop of the loudest layer of the two notes on each side of the split): viola +6.58 dB relative to
  cello, violin +9.42 dB. Each section's gain applies to all its layers, so the natural dynamics
  between layers stay. Common gain +0.26 dB brings the loudest file to -1 dBFS.
- Instrument spec: regions model, `veltrack` 0.3, `release` 0.8 s.

| Recording | Source file | Velocity | Range | Tune | Lead-in cut | Loop |
|---|---|---|---|---|---|---|
| `strings-36-cello-v1-1` | `Strings/Cello Section/susvib/susvib_C1_v1_1.wav` | 1-64 | 0-38 | +0.3 c | 73 ms | 3.04-4.82 s |
| `strings-36-cello-v3-1` | `Strings/Cello Section/susvib/susvib_C1_v3_1.wav` | 65-127 | 0-38 | +0.2 c | 31 ms | 3.93-9.07 s |
| `strings-40-cello-v1-1` | `Strings/Cello Section/susvib/susvib_E1_v1_1.wav` | 1-64 | 39-41 | +3.8 c | 20 ms | 0.92-6.83 s |
| `strings-40-cello-v1-2` | `Strings/Cello Section/susvib/susvib_E1_v1_2.wav` | 1-64 | 39-41 | +0.7 c | 89 ms | 3.76-5.66 s |
| `strings-40-cello-v3-1` | `Strings/Cello Section/susvib/susvib_E1_v3_1.wav` | 65-127 | 39-41 | +3.5 c | 18 ms | 0.71-9.54 s |
| `strings-43-cello-v1-1` | `Strings/Cello Section/susvib/susvib_G1_v1_1.wav` | 1-64 | 42-45 | +0.5 c | 106 ms | 1.82-3.88 s |
| `strings-43-cello-v3-1` | `Strings/Cello Section/susvib/susvib_G1_v3_1.wav` | 65-127 | 42-45 | -0.4 c | 23 ms | 0.63-2.67 s |
| `strings-47-cello-v1-1` | `Strings/Cello Section/susvib/susvib_B1_v1_1.wav` | 1-64 | 46-48 | -0.1 c | 50 ms | 2.63-7.61 s |
| `strings-47-cello-v3-1` | `Strings/Cello Section/susvib/susvib_B1_v3_1.wav` | 65-127 | 46-48 | +0.1 c | 27 ms | 2.03-10.37 s |
| `strings-50-cello-v1-1` | `Strings/Cello Section/susvib/susvib_D2_v1_1.wav` | 1-64 | 49-51 | -1.6 c | 24 ms | 2.55-4.25 s |
| `strings-50-cello-v3-1` | `Strings/Cello Section/susvib/susvib_D2_v3_1.wav` | 65-127 | 49-51 | +0.3 c | 28 ms | 0.51-2.25 s |
| `strings-53-cello-v1-1` | `Strings/Cello Section/susvib/susvib_F2_v1_1.wav` | 1-64 | 52-54 | -0.0 c | 78 ms | 2.60-4.26 s |
| `strings-53-cello-v3-1` | `Strings/Cello Section/susvib/susvib_F2_v3_1.wav` | 65-127 | 52-54 | -0.9 c | 29 ms | 3.42-5.38 s |
| `strings-55-viola-v1-1` | `Strings/Viola Section/susvib/ViolaEns_susvib_G2_v1_1.wav` | 1-64 | 55-57 | -0.3 c | 29 ms | 3.01-4.72 s |
| `strings-55-viola-v2-1` | `Strings/Viola Section/susvib/ViolaEns_susvib_G2_v2_1.wav` | 65-127 | 55-57 | -0.4 c | 35 ms | 1.13-2.73 s |
| `strings-59-viola-v1-1` | `Strings/Viola Section/susvib/ViolaEns_susvib_B2_v1_1.wav` | 1-64 | 58-60 | -0.5 c | 31 ms | 0.96-3.36 s |
| `strings-59-viola-v2-1` | `Strings/Viola Section/susvib/ViolaEns_susvib_B2_v2_1.wav` | 65-127 | 58-60 | -0.2 c | 19 ms | 7.05-8.89 s |
| `strings-62-viola-v1-1` | `Strings/Viola Section/susvib/ViolaEns_susvib_D3_v1_1.wav` | 1-64 | 61-63 | -1.1 c | 28 ms | 5.09-9.60 s |
| `strings-62-viola-v2-1` | `Strings/Viola Section/susvib/ViolaEns_susvib_D3_v2_1.wav` | 65-127 | 61-63 | +1.1 c | 18 ms | 6.80-8.45 s |
| `strings-65-viola-v1-1` | `Strings/Viola Section/susvib/ViolaEns_susvib_F3_v1_1.wav` | 1-64 | 64-67 | -0.1 c | 31 ms | 3.58-5.53 s |
| `strings-65-viola-v2-1` | `Strings/Viola Section/susvib/ViolaEns_susvib_F3_v2_1.wav` | 65-127 | 64-67 | -0.8 c | 27 ms | 0.58-11.36 s |
| `strings-69-violin-v1-1` | `Strings/Violin Section/susVib/VlnEns_susVib_A3_v1.wav` | 1-64 | 68-70 | +0.2 c | 107 ms | 3.57-6.09 s |
| `strings-69-violin-v2-1` | `Strings/Violin Section/susVib/VlnEns_susVib_A3_v2.wav` | 65-127 | 68-70 | -0.3 c | 17 ms | 0.75-2.65 s |
| `strings-72-violin-v1-1` | `Strings/Violin Section/susVib/VlnEns_susVib_C4_v1.wav` | 1-64 | 71-74 | -0.3 c | 35 ms | 3.26-5.76 s |
| `strings-72-violin-v2-1` | `Strings/Violin Section/susVib/VlnEns_susVib_C4_v2.wav` | 65-127 | 71-74 | -0.1 c | 22 ms | 3.38-5.09 s |
| `strings-76-violin-v1-1` | `Strings/Violin Section/susVib/VlnEns_susVib_E4_v1.wav` | 1-64 | 75-77 | +0.1 c | 21 ms | 3.74-5.43 s |
| `strings-76-violin-v2-1` | `Strings/Violin Section/susVib/VlnEns_susVib_E4_v2.wav` | 65-127 | 75-77 | -0.1 c | 30 ms | 0.72-8.14 s |
| `strings-79-violin-v1-1` | `Strings/Violin Section/susVib/VlnEns_susVib_G4_v1.wav` | 1-64 | 78-81 | -0.2 c | 51 ms | 2.43-4.08 s |
| `strings-79-violin-v2-1` | `Strings/Violin Section/susVib/VlnEns_susVib_G4_v2.wav` | 65-127 | 78-81 | -0.4 c | 24 ms | 1.06-11.03 s |
| `strings-83-violin-v1-1` | `Strings/Violin Section/susVib/VlnEns_susVib_B4_v1.wav` | 1-64 | 82-84 | -0.0 c | 26 ms | 2.28-4.27 s |
| `strings-83-violin-v2-1` | `Strings/Violin Section/susVib/VlnEns_susVib_B4_v2.wav` | 65-127 | 82-84 | -0.5 c | 27 ms | 6.53-8.13 s |
| `strings-86-violin-v1-1` | `Strings/Violin Section/susVib/VlnEns_susVib_D5_v1.wav` | 1-64 | 85-127 | -0.8 c | 44 ms | 1.43-6.09 s |
| `strings-86-violin-v2-1` | `Strings/Violin Section/susVib/VlnEns_susVib_D5_v2.wav` | 65-127 | 85-127 | -1.2 c | 69 ms | 6.38-8.01 s |

## brass (45 files, 157.0 MB, 44.1 kHz stereo, 24-bit, looped)

- Source and license: VSCO 2 Community Edition as above (CC0 1.0). Built by `scripts/samples/vsco.py`
  (`build_brass`). Pack SHA-256 `149a34d83a39aa25499cd2b967cb45c1901cd71e74b2be5ed3e782b674e7d8a7`.
- The same notes as before: tenor trombone `sus` for roots 39, 41, 46, 50, 53; trumpet `sus` for 60-81; and the two
  fill-ins from VSCO's "OldTrombone" folder (a 1950s Olds Super tenor trombone, an unreleased test set in the same
  CC0 repository): A2 (root 45) and A3 (root 57). Now with every layer: tenor trombone `v1`-`v3`, trumpet `v1` and
  `v3`, Olds `v1`-`v5`. Round robins: Olds A1 has two takes of `v1` and three of `v5`; Olds A2 two each of `v1`,
  `v4` and `v5`. Velocity splits evenly per source: trombone 1-42/43-85/86-127, trumpet 1-64/65-127, Olds
  1-25/26-51/52-76/77-102/103-127.
- Stereo, 44.1 kHz, full length (2.8-25.8 s). Tenor trombone and trumpet are 16-bit sources, Olds 24-bit; all are
  stored at 24 bits. Same octave naming and measurement as the strings; the largest deviation was 5.9 cents,
  corrected by `tune`; every region plays within 3.8 cents of its key.
- Lead-in cut at the first breath sound (peak - 36 dB rule as above); loops as for the strings with a 200 ms
  crossfade. One short recording, Olds A2 `v5` take 2 (3.0 s), has no 1.6 s stretch inside the usual 0.25 s
  margins; its loop uses 0.1 s margins (still at least 1.6 s). Junction sample steps are at most 0.73 of the
  note's own 99.9th-percentile step; the two junctions with a level step above the loop's inner window steps match
  the original recording's step at the loop start.
- Level matching (K-weighted power inside the loop of the loudest layers): the Olds A2 against the average of its
  tenor trombone neighbours (41 and 46): Olds -14.91 dB; the two lowest trumpet notes (60, 63) against
  the two trombone notes below the split (53 tenor, 57 Olds): trumpet -14.69 dB, both relative to the tenor
  trombone (both were recorded much hotter). Each source's gain applies to all its layers. Common gain
  +14.83 dB.
- Instrument spec: regions model, `veltrack` 0.3, `release` 0.2 s.

| Recording | Source file | Velocity | Range | Tune | Lead-in cut | Loop |
|---|---|---|---|---|---|---|
| `brass-39-trombone-v1-1` | `Brass/Tenor Trombone/sus/tenortbn_sus_D#1_v1_1.wav` | 1-42 | 0-40 | +0.1 c | 18 ms | 5.84-9.03 s |
| `brass-39-trombone-v2-1` | `Brass/Tenor Trombone/sus/tenortbn_sus_D#1_v2_1.wav` | 43-85 | 0-40 | -0.1 c | 42 ms | 1.99-3.81 s |
| `brass-39-trombone-v3-1` | `Brass/Tenor Trombone/sus/tenortbn_sus_D#1_v3_1.wav` | 86-127 | 0-40 | +0.1 c | 15 ms | 0.63-2.90 s |
| `brass-41-trombone-v1-1` | `Brass/Tenor Trombone/sus/tenortbn_sus_F1_v1_1.wav` | 1-42 | 41-43 | +0.0 c | 15 ms | 2.22-3.91 s |
| `brass-41-trombone-v2-1` | `Brass/Tenor Trombone/sus/tenortbn_sus_F1_v2_1.wav` | 43-85 | 41-43 | -0.1 c | 13 ms | 1.24-5.21 s |
| `brass-41-trombone-v3-1` | `Brass/Tenor Trombone/sus/tenortbn_sus_F1_v3_1.wav` | 86-127 | 41-43 | +0.0 c | 33 ms | 2.66-4.84 s |
| `brass-45-olds-v1-1` | `Brass/OldTrombone/Sustain/Trombone_Sustain_A1_v1_1.wav` | 1-25 | 44-45 | -0.5 c | 19 ms | 2.26-4.78 s |
| `brass-45-olds-v1-2` | `Brass/OldTrombone/Sustain/Trombone_Sustain_A1_v1_2.wav` | 1-25 | 44-45 | +0.1 c | 34 ms | 2.74-7.30 s |
| `brass-45-olds-v2-1` | `Brass/OldTrombone/Sustain/Trombone_Sustain_A1_v2_1.wav` | 26-51 | 44-45 | +0.0 c | 33 ms | 3.14-5.18 s |
| `brass-45-olds-v3-1` | `Brass/OldTrombone/Sustain/Trombone_Sustain_A1_v3_1.wav` | 52-76 | 44-45 | -0.5 c | 26 ms | 0.49-6.82 s |
| `brass-45-olds-v4-1` | `Brass/OldTrombone/Sustain/Trombone_Sustain_A1_v4_1.wav` | 77-102 | 44-45 | -0.3 c | 28 ms | 1.03-2.80 s |
| `brass-45-olds-v5-1` | `Brass/OldTrombone/Sustain/Trombone_Sustain_A1_v5_1.wav` | 103-127 | 44-45 | -0.3 c | 28 ms | 0.93-2.56 s |
| `brass-45-olds-v5-2` | `Brass/OldTrombone/Sustain/Trombone_Sustain_A1_v5_2.wav` | 103-127 | 44-45 | +0.3 c | 36 ms | 0.71-2.64 s |
| `brass-45-olds-v5-3` | `Brass/OldTrombone/Sustain/Trombone_Sustain_A1_v5_3.wav` | 103-127 | 44-45 | +0.1 c | 23 ms | 0.60-2.23 s |
| `brass-46-trombone-v1-1` | `Brass/Tenor Trombone/sus/tenortbn_sus_A#1_v1_1.wav` | 1-42 | 46-48 | -0.1 c | 31 ms | 10.14-11.93 s |
| `brass-46-trombone-v2-1` | `Brass/Tenor Trombone/sus/tenortbn_sus_A#1_v2_1.wav` | 43-85 | 46-48 | +0.0 c | 22 ms | 3.18-8.76 s |
| `brass-46-trombone-v3-1` | `Brass/Tenor Trombone/sus/tenortbn_sus_A#1_v3_1.wav` | 86-127 | 46-48 | -0.1 c | 23 ms | 2.61-4.32 s |
| `brass-50-trombone-v1-1` | `Brass/Tenor Trombone/sus/tenortbn_sus_D2_v1_1.wav` | 1-42 | 49-51 | -0.4 c | 47 ms | 1.31-2.95 s |
| `brass-50-trombone-v2-1` | `Brass/Tenor Trombone/sus/tenortbn_sus_D2_v2_1.wav` | 43-85 | 49-51 | -0.1 c | 36 ms | 0.70-6.72 s |
| `brass-50-trombone-v3-1` | `Brass/Tenor Trombone/sus/tenortbn_sus_D2_v3_1.wav` | 86-127 | 49-51 | -0.1 c | 18 ms | 0.52-5.43 s |
| `brass-53-trombone-v1-1` | `Brass/Tenor Trombone/sus/tenortbn_sus_F2_v1_1.wav` | 1-42 | 52-55 | -0.2 c | 39 ms | 2.11-3.71 s |
| `brass-53-trombone-v2-1` | `Brass/Tenor Trombone/sus/tenortbn_sus_F2_v2_1.wav` | 43-85 | 52-55 | -0.1 c | 24 ms | 0.58-6.80 s |
| `brass-53-trombone-v3-1` | `Brass/Tenor Trombone/sus/tenortbn_sus_F2_v3_1.wav` | 86-127 | 52-55 | +0.1 c | 18 ms | 2.73-4.57 s |
| `brass-57-olds-v1-1` | `Brass/OldTrombone/Sustain/Trombone_Sustain_A2_v1_1.wav` | 1-25 | 56-58 | -0.2 c | 21 ms | 2.79-4.41 s |
| `brass-57-olds-v1-2` | `Brass/OldTrombone/Sustain/Trombone_Sustain_A2_v1_2.wav` | 1-25 | 56-58 | +0.1 c | 29 ms | 0.65-6.11 s |
| `brass-57-olds-v2-1` | `Brass/OldTrombone/Sustain/Trombone_Sustain_A2_v2_1.wav` | 26-51 | 56-58 | +0.0 c | 16 ms | 1.28-4.56 s |
| `brass-57-olds-v3-1` | `Brass/OldTrombone/Sustain/Trombone_Sustain_A2_v3_1.wav` | 52-76 | 56-58 | -0.1 c | 30 ms | 2.42-4.10 s |
| `brass-57-olds-v4-1` | `Brass/OldTrombone/Sustain/Trombone_Sustain_A2_v4_1.wav` | 77-102 | 56-58 | +0.2 c | 31 ms | 1.44-3.18 s |
| `brass-57-olds-v4-2` | `Brass/OldTrombone/Sustain/Trombone_Sustain_A2_v4_2.wav` | 77-102 | 56-58 | +0.1 c | 19 ms | 0.60-2.22 s |
| `brass-57-olds-v5-1` | `Brass/OldTrombone/Sustain/Trombone_Sustain_A2_v5_1.wav` | 103-127 | 56-58 | +0.1 c | 24 ms | 0.83-2.49 s |
| `brass-57-olds-v5-2` | `Brass/OldTrombone/Sustain/Trombone_Sustain_A2_v5_2.wav` | 103-127 | 56-58 | -0.1 c | 27 ms | 0.49-2.18 s |
| `brass-60-trumpet-v1-1` | `Brass/Trumpet/sus/Sum_SHTrumpet_sus_C3_v1_rr1.wav` | 1-64 | 59-61 | +0.9 c | 22 ms | 0.84-10.79 s |
| `brass-60-trumpet-v3-1` | `Brass/Trumpet/sus/Sum_SHTrumpet_sus_C3_v3_rr1.wav` | 65-127 | 59-61 | +0.4 c | 12 ms | 2.98-4.82 s |
| `brass-63-trumpet-v1-1` | `Brass/Trumpet/sus/Sum_SHTrumpet_sus_D#3_v1_rr1.wav` | 1-64 | 62-65 | -1.8 c | 20 ms | 3.92-12.25 s |
| `brass-63-trumpet-v3-1` | `Brass/Trumpet/sus/Sum_SHTrumpet_sus_D#3_v3_rr1.wav` | 65-127 | 62-65 | +0.2 c | 18 ms | 0.78-7.65 s |
| `brass-67-trumpet-v1-1` | `Brass/Trumpet/sus/Sum_SHTrumpet_sus_G3_v1_rr1.wav` | 1-64 | 66-68 | -5.9 c | 22 ms | 3.37-12.19 s |
| `brass-67-trumpet-v3-1` | `Brass/Trumpet/sus/Sum_SHTrumpet_sus_G3_v3_rr1.wav` | 65-127 | 66-68 | -3.0 c | 20 ms | 1.35-7.62 s |
| `brass-70-trumpet-v1-1` | `Brass/Trumpet/sus/Sum_SHTrumpet_sus_A#3_v1_rr1.wav` | 1-64 | 69-72 | -0.1 c | 20 ms | 7.77-11.32 s |
| `brass-70-trumpet-v3-1` | `Brass/Trumpet/sus/Sum_SHTrumpet_sus_A#3_v3_rr1.wav` | 65-127 | 69-72 | -1.3 c | 17 ms | 0.60-6.19 s |
| `brass-74-trumpet-v1-1` | `Brass/Trumpet/sus/Sum_SHTrumpet_sus_D4_v1_rr1.wav` | 1-64 | 73-75 | +0.8 c | 19 ms | 3.54-12.19 s |
| `brass-74-trumpet-v3-1` | `Brass/Trumpet/sus/Sum_SHTrumpet_sus_D4_v3_rr1.wav` | 65-127 | 73-75 | -1.0 c | 38 ms | 0.52-4.64 s |
| `brass-77-trumpet-v1-1` | `Brass/Trumpet/sus/Sum_SHTrumpet_sus_F4_v1_rr1.wav` | 1-64 | 76-79 | +0.5 c | 19 ms | 0.79-12.22 s |
| `brass-77-trumpet-v3-1` | `Brass/Trumpet/sus/Sum_SHTrumpet_sus_F4_v3_rr1.wav` | 65-127 | 76-79 | -0.2 c | 24 ms | 1.37-5.24 s |
| `brass-81-trumpet-v1-1` | `Brass/Trumpet/sus/Sum_SHTrumpet_sus_A4_v1_rr1.wav` | 1-64 | 80-127 | +0.8 c | 26 ms | 4.21-6.09 s |
| `brass-81-trumpet-v3-1` | `Brass/Trumpet/sus/Sum_SHTrumpet_sus_A4_v3_rr1.wav` | 65-127 | 80-127 | -3.8 c | 23 ms | 4.21-6.17 s |
