// These presets describe local synthesis, including honest acoustic approximations.
const control = (min, max, value, description) => ({ min, max, default: value, description });
const brightness = control(200, 12000, 3200, 'Low-pass cutoff in Hz.');
const release = control(0.02, 4, 0.4, 'Release or decay time in seconds.');
const attack = control(0.001, 3, 0.02, 'Attack time in seconds.');
const detune = control(0, 30, 8, 'Oscillator spread in cents.');
const definitions = [
  ['electric-piano', 'Electric piano', 'FM tine with a soft body and attack bark.', 4, { brightness }],
  ['piano', 'Piano approximation', 'Decaying harmonic synthesis; not a sampled acoustic piano.', 0, { brightness, release }],
  ['pad', 'Warm pad', 'Filtered detuned saws with a slow swell.', 89, { brightness: { ...brightness, default: 1800 }, attack: { ...attack, default: 0.7 }, release: { ...release, default: 1.6 }, detune }],
  ['pluck', 'Plucked synth', 'A bright attack through a closing resonant filter.', 81, { brightness, release: { ...release, default: 0.3 } }],
  ['bass', 'Round bass', 'Sine and triangle with a firm low end.', 38, {}],
  ['bell', 'Bell', 'Inharmonic ringing partials.', 10, { release: { ...release, default: 2.2 } }],
  ['marimba', 'Marimba', 'Short wooden fundamental and inharmonic strike.', 12, {}],
  ['analog-lead', 'Analog lead', 'Detuned saw lead with a rounded filter.', 81, { brightness: { ...brightness, default: 4200 }, attack, release, detune }],
  ['fm-lead', 'FM lead', 'Glass-like two-operator FM with a falling modulation index.', 80, { brightness, attack, release }],
  ['acid-bass', 'Acid bass', 'Resonant saw pluck with a closing filter.', 38, { brightness: { ...brightness, default: 1800 }, release: { ...release, default: 0.2 } }],
  ['organ', 'Organ', 'Sustained additive drawbar-like harmonics.', 16, { brightness, attack: { ...attack, default: 0.006 }, release: { ...release, default: 0.12 } }],
  ['strings', 'Strings approximation', 'Slow ensemble-like filtered saws; not acoustic strings.', 48, { brightness: { ...brightness, default: 2600 }, attack: { ...attack, default: 0.35 }, release: { ...release, default: 1 }, detune: { ...detune, default: 12 } }],
  ['kick', 'Kick', 'Sine pitch-drop drum.', 0, {}],
  ['snare', 'Snare', 'Filtered noise and a short tonal body.', 0, {}],
  ['clap', 'Clap', 'A cluster of noise strikes.', 0, {}],
  ['hi-hat', 'Hi-hat', 'Short high-pass noise.', 0, {}],
  ['shaker', 'Shaker', 'Soft high-pass noise grains.', 0, {}],
  ['noise', 'Noise texture', 'A held, filtered pink-noise envelope.', 0, { brightness: { ...brightness, default: 1600 }, attack: { ...attack, default: 0.4 }, release: { ...release, default: 0.8 } }],
  ['sample', 'Speech / sample', 'Local WAV playback, spoken textures and vocoder effects; not natural singing.', 0, {}],
];
export const SAMPLE_ASSETS = ['made-of-light', 'stay-a-little', 'in-the-rhythm', 'city-never-sleeps', 'let-it-change', 'slow-down'];
export const SAMPLE_EFFECTS = ['dry', 'tape', 'granular', 'vocoder', 'chop'];
export const SCORE_LIMITS = Object.freeze({ maxSeconds: 600, maxParts: 64, maxEvents: 100000, maxPatterns: 128, maxClips: 4096 });
const instruments = definitions.map(([id, name, description, program, controls]) => ({ id, name, description, program, drums: ['kick', 'snare', 'clap', 'hi-hat', 'shaker'].includes(id), controls }));
export function getCatalog() {
  return structuredClone({ version: 1, instruments, sampleAssets: SAMPLE_ASSETS.map(id => `builtin:${id}`), sampleEffects: SAMPLE_EFFECTS, limits: SCORE_LIMITS, mix: { volume: { min: 0, max: 2, default: 1 }, pan: { min: -1, max: 1, default: 0 }, mute: false, solo: false }, master: { volume: { min: 0, max: 2, default: 0.8 }, reverb: { min: 0, max: 1, default: 0.2 } } });
}
