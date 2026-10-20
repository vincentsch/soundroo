// Presets are synthesized, or played from the recordings in assets/samples (see
// assets/samples/SOURCES.md): piano, strings, brass, guitars, electric bass and
// the acoustic drum kit.
const control = (min, max, value, description) => ({ min, max, default: value, description });
const brightness = control(200, 12000, 3200, 'Low-pass cutoff in Hz.');
const release = control(0.02, 4, 0.4, 'Release or decay time in seconds.');
const attack = control(0.001, 3, 0.02, 'Attack time in seconds.');
const detune = control(0, 30, 8, 'Oscillator spread in cents.');
const definitions = [
  ['electric-piano', 'Electric piano', 'FM tine with a soft body and attack bark.', 4, { brightness }],
  ['piano', 'Grand piano', 'Recorded grand piano with soft and strong layers.', 0, { brightness: { ...brightness, default: 12000 }, release }],
  ['pad', 'Warm pad', 'Filtered detuned saws with a slow swell.', 89, { brightness: { ...brightness, default: 1800 }, attack: { ...attack, default: 0.7 }, release: { ...release, default: 1.6 }, detune }],
  ['pluck', 'Plucked synth', 'A bright attack through a closing resonant filter.', 81, { brightness, release: { ...release, default: 0.3 } }],
  ['bass', 'Round bass', 'Sine and triangle with a firm low end.', 38, {}],
  ['bell', 'Bell', 'Inharmonic ringing partials.', 10, { release: { ...release, default: 2.2 } }],
  ['marimba', 'Marimba', 'Short wooden fundamental and inharmonic strike.', 12, {}],
  ['analog-lead', 'Analog lead', 'Detuned saw lead with a rounded filter.', 81, { brightness: { ...brightness, default: 4200 }, attack, release, detune }],
  ['fm-lead', 'FM lead', 'Glass-like two-operator FM with a falling modulation index.', 80, { brightness, attack, release }],
  ['acid-bass', 'Acid bass', 'Resonant saw pluck with a closing filter.', 38, { brightness: { ...brightness, default: 1800 }, release: { ...release, default: 0.2 } }],
  ['organ', 'Organ', 'Sustained additive drawbar-like harmonics.', 16, { brightness, attack: { ...attack, default: 0.006 }, release: { ...release, default: 0.12 } }],
  ['strings', 'String section', 'Recorded violin, viola and cello sections with vibrato; long notes hold steadily.', 48, { brightness: { ...brightness, default: 9000 }, attack: { ...attack, default: 0.08 }, release: { ...release, default: 0.8 }, detune: { ...detune, default: 10, description: 'Doubles the section with a second take this many cents apart; 0 plays one take.' } }],
  ['brass', 'Brass section', 'Recorded trumpet (from C4 up) and trombone (below), doubled into a small section. Good for stabs and swells.', 61, { brightness: { ...brightness, default: 9000 }, attack: { ...attack, default: 0.01 }, release: { ...release, default: 0.2 }, detune: { ...detune, default: 10, description: 'Doubles the section with a second take this many cents apart; 0 plays one take.' } }],
  ['kick', 'Electronic kick', 'Drum-machine kick: a sine pitch drop. For a real drum kit use rock-kick.', 0, {}],
  ['snare', 'Electronic snare', 'Drum-machine snare: filtered noise and a short tone. For a real drum kit use rock-snare.', 0, {}],
  ['clap', 'Clap', 'A cluster of noise strikes.', 0, {}],
  ['hi-hat', 'Electronic hi-hat', 'Drum-machine hi-hat: short high-pass noise. For a real drum kit use closed-hat.', 0, {}],
  ['shaker', 'Shaker', 'Soft high-pass noise grains.', 0, {}],
  ['noise', 'Noise texture', 'A held, filtered pink-noise envelope.', 0, { brightness: { ...brightness, default: 1600 }, attack: { ...attack, default: 0.4 }, release: { ...release, default: 0.8 } }],
  ['sample', 'Speech / sample', 'Local WAV playback, spoken textures and vocoder effects; not natural singing.', 0, {}],
  ['guitar-clean', 'Clean electric guitar', 'Recorded clean electric guitar, one note per pitch; play chords as several notes.', 27, { brightness: { ...brightness, default: 9000 }, release: { ...release, default: 1.2 }, palmMute: control(0, 1, 0, 'Shorten and damp the string for palm-muted articulation.') }],
  ['guitar-crunch', 'Crunch guitar', 'Recorded guitar through overdrive and a cabinet filter. Power chords (root and fifth, often an octave too) sound biggest.', 29, { brightness: { ...brightness, default: 5500 }, release: { ...release, default: 0.65 }, palmMute: control(0, 1, 0.2, 'Shorten and damp the string.'), drive: control(0, 1, 0.7, 'Overdrive amount before the part fader.') }],
  ['electric-bass', 'Electric bass', 'Recorded fingered electric bass with soft and strong layers.', 33, { brightness: { ...brightness, default: 5000 }, release: { ...release, default: 0.25 }, palmMute: control(0, 1, 0, 'Shorten and damp the string.') }],
  ['rock-kick', 'Acoustic kick', 'Recorded kick drum of the acoustic kit (rock-kick, rock-snare, closed-hat, open-hat, tom, ride, crash).', 0, {}],
  ['rock-snare', 'Acoustic snare', 'Recorded snare drum of the acoustic kit.', 0, {}],
  ['closed-hat', 'Closed hi-hat', 'Recorded closed hi-hat of the acoustic kit.', 0, {}],
  ['tom', 'Toms', 'Recorded toms of the acoustic kit; the pitch picks the drum: 41 floor tom, 45 low, 48 middle, 50 high.', 0, {}],
  ['crash', 'Crash cymbal', 'Recorded crash cymbal.', 0, {}],
  ['ride', 'Ride cymbal', 'Recorded ride cymbal, played on the bow.', 0, {}],
  ['open-hat', 'Open hi-hat', 'Recorded open hi-hat.', 0, {}],
  ['chip-lead', 'Chip lead', 'Pulse wave like an 8-bit game console. Duty 0.125 sounds thin, 0.25 classic, 0.5 like a hollow square.', 80, { duty: control(0.05, 0.5, 0.25, 'Pulse width: 0.125 thin, 0.25 classic, 0.5 square.'), attack: { ...attack, default: 0.002 }, release: { ...release, default: 0.06 } }],
  ['chip-bass', 'Chip bass', 'Triangle wave bass like an 8-bit game console.', 38, { release: { ...release, default: 0.04 } }],
];
export const SAMPLE_ASSETS = ['made-of-light', 'stay-a-little', 'in-the-rhythm', 'city-never-sleeps', 'let-it-change', 'slow-down'];
export const SAMPLE_EFFECTS = ['dry', 'tape', 'granular', 'vocoder', 'chop'];
// English voices of the optional local Kokoro-82M speech model.
export const SPEECH_VOICES = ['af_heart', 'af_alloy', 'af_aoede', 'af_bella', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky', 'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx', 'am_puck', 'am_santa', 'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily', 'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis'];
export const DEFAULT_SPEECH_VOICE = 'af_heart';
export const SCORE_LIMITS = Object.freeze({ maxSeconds: 600, maxParts: 64, maxEvents: 100000, maxPatterns: 128, maxClips: 4096, maxNotationCharacters: 16384, maxSpeechRecipes: 16, maxSpeechCharacters: 200 });
const instruments = definitions.map(([id, name, description, program, controls]) => ({ id, name, description, program, drums: ['kick', 'snare', 'clap', 'hi-hat', 'shaker', 'rock-kick', 'rock-snare', 'closed-hat', 'tom', 'crash', 'ride', 'open-hat'].includes(id), controls }));
export function getCatalog() {
  return structuredClone({ version: 1, instruments, sampleAssets: SAMPLE_ASSETS.map(id => `builtin:${id}`), sampleEffects: SAMPLE_EFFECTS, speechVoices: SPEECH_VOICES, limits: SCORE_LIMITS, mix: { volume: { min: 0, max: 2, default: 1 }, pan: { min: -1, max: 1, default: 0 }, mute: false, solo: false }, master: { volume: { min: 0, max: 2, default: 0.8 }, reverb: { min: 0, max: 1, default: 0.2 } } });
}
