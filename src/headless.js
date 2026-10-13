// Soundroo's engine without the library, studio or CLI. A server or worker
// passes score JSON and receives validation issues, WAV bytes and reports,
// MIDI, record sleeves and identities. It runs on Node 22+ without npm
// packages; only speech recipes load the optional local Kokoro runtime.
//
//   import * as soundroo from './src/headless.js';
//   const { valid, issues } = soundroo.validate(score);
//   const { wav, report, revision } = await soundroo.render(score, { mix });
//
// docs/headless.md describes every export and the identity rules.
import fs from 'node:fs';
import { validateScore, compileScore, SCORE_VERSIONS } from './score.js';
import { renderScore, RENDER_LIMITS } from './render.js';
import { encodeWav } from './audio/wav.js';
import { encodeMidi } from './audio/midi.js';
import { coverSvg, SLEEVE_STYLES } from './artwork.js';
import { getCatalog, SCORE_LIMITS, SPEECH_VOICES } from './catalog.js';
import { engineHash, engineManifest, sourceIdentity, musicFingerprint } from './identity.js';
import { SPEECH_MODEL, speechRecipes as recipesOf, speechFile, synthesizeSpeech, defaultSpeechDir } from './speech.js';
import { VERSION } from './version.js';

export { engineHash, engineManifest };
export const FINGERPRINT_VERSION = 'fp1';
export const LIMITS = Object.freeze({ ...SCORE_LIMITS, ...RENDER_LIMITS });
const programs = new Map(getCatalog().instruments.map(preset => [preset.id, preset.program]));

/** Engine release facts: {version, hash, scoreVersions, fingerprint, limits, speech}. */
export function engineInfo() {
  return { version: VERSION, hash: engineHash(), scoreVersions: [...SCORE_VERSIONS], fingerprint: FINGERPRINT_VERSION, limits: { ...LIMITS }, speech: { model: SPEECH_MODEL.id, dtype: SPEECH_MODEL.dtype, weights: SPEECH_MODEL.weights, sha256: SPEECH_MODEL.sha256, voices: [...SPEECH_VOICES] } };
}

/** {valid, issues: [{path, message}]} for score version 1 or 2. Never throws. */
export function validate(score) {
  return validateScore(score);
}

/** The ordinary-note score every render uses: version 1 shape, defaults filled,
 * clips and pattern strings expanded into sorted notes. Throws an error named
 * ScoreValidationError with .issues for invalid scores. */
export function compile(score) {
  return compileScore(score);
}

/** Render a score to 16-bit stereo WAV bytes, exactly as the CLI and studio do.
 * Options: mix, sampleRate (44100), from/to seconds, stems, projectDir for local
 * assets/ WAVs, speech {cacheDir, synthesize, modelDir, offline, log},
 * progress, signal. Returns {revision, duration, sampleRate, wav, report,
 * parts, stems?: {partId: wav}}. Invalid scores throw ScoreValidationError;
 * cancelled renders throw AbortError; audio failing signal checks throws an
 * error carrying .report. */
export async function render(score, { mix = {}, sampleRate = 44100, projectDir, ...options } = {}) {
  const result = await renderScore(score, { ...options, mix, sampleRate, projectDir });
  const revision = sourceIdentity(score, { mix, sampleRate, projectDir });
  const report = { ...result.report, revision, source: 'editable-score' };
  if (report.nonFinite || report.clipped) {
    const error = new Error('The render failed audio checks: ' + JSON.stringify(report.warnings));
    error.report = report;
    throw error;
  }
  const wav = audio => Buffer.from(encodeWav(audio));
  return { revision, duration: report.duration, sampleRate, wav: wav(result.audio), report, parts: result.parts, ...(result.stems ? { stems: Object.fromEntries(Object.entries(result.stems).map(([id, audio]) => [id, wav(audio)])) } : {}) };
}

/** The revision of a render: 24 hex characters over the score and mix as
 * canonical JSON, sample rate, engine hash and the bytes of referenced local
 * WAVs (which need projectDir). Options: mix, sampleRate, projectDir. */
export function revision(score, options) {
  return sourceIdentity(score, options);
}

/** "fp1:" and 64 hex characters identifying the music of a valid score.
 * Equal scores in version 1 or 2 notation share a fingerprint. */
export function fingerprint(score) {
  return musicFingerprint(score);
}

const PERCUSSION = { kick: 36, snare: 38, clap: 39, 'hi-hat': 42, shaker: 70, 'rock-kick': 36, 'rock-snare': 38, tom: 45, crash: 49, ride: 51, 'open-hat': 46 };
// GM toms occupy a sparse range; other pitches would select cymbals or effects.
const tomPitch = pitch => [41, 43, 45, 47, 48, 50].reduce((a, b) => Math.abs(b - pitch) < Math.abs(a - pitch) ? b : a);
/** Standard MIDI file bytes (format 1, 480 ticks per beat): a conductor track
 * with tempo and section markers, then one track per instrument with its GM
 * program; drums on channel 10. Sample and noise parts are left out. */
export function midi(score) {
  const expanded = compileScore(score);
  return encodeMidi({ title: expanded.title, bpm: expanded.bpm, sections: expanded.sections, tracks: expanded.parts.filter(p => !['sample', 'noise'].includes(p.instrument)).map(p => ({ name: p.name, program: programs.get(p.instrument), drums: p.instrument in PERCUSSION, notes: p.notes.map(n => ({ ...n, pitch: p.instrument === 'tom' ? tomPitch(n.pitch) : PERCUSSION[p.instrument] ?? n.pitch })) })) });
}

/** The original 800×800 SVG sleeve the studio shows. Pass the track's position
 * in its collection as index to match the studio. artwork {style, colors,
 * seed} replaces score.artwork. */
export function sleeve(score, { index, artwork } = {}) {
  return coverSvg(artwork === undefined ? score : { ...score, artwork }, { index });
}

/** {valid, issues} for sleeve settings {style, colors, seed}. */
export function validateArtwork(artwork) {
  const issues = [];
  const issue = (path, message) => issues.push({ path, message });
  if (artwork === undefined) return { valid: true, issues };
  if (!artwork || typeof artwork !== 'object' || Array.isArray(artwork)) issue('artwork', 'Expected {style, colors, seed}.');
  else {
    for (const key of Object.keys(artwork)) if (!['style', 'colors', 'seed'].includes(key)) issue(`artwork.${key}`, 'Sleeve settings are style, colors and seed.');
    if (artwork.style !== undefined && !SLEEVE_STYLES.includes(artwork.style)) issue('artwork.style', `Use one of: ${SLEEVE_STYLES.join(', ')}.`);
    if (artwork.colors !== undefined && (!Array.isArray(artwork.colors) || !artwork.colors.length || artwork.colors.length > 3 || artwork.colors.some(c => typeof c !== 'string' || !/^#[0-9a-f]{6}$/i.test(c)))) issue('artwork.colors', 'Use one to three six-digit hex colors: background, ink and accent.');
    if (artwork.seed !== undefined && (!Number.isInteger(artwork.seed) || artwork.seed < 0 || artwork.seed > 0xffffffff)) issue('artwork.seed', 'Expected an integer seed from 0 to 4294967295.');
  }
  return { valid: !issues.length, issues };
}

/** Distinct speech recipes of a valid score: [{key, text, voice, file, cached}],
 * where file is the phrase's place in the speech cache (options.cacheDir). */
export function speechRecipes(score, { cacheDir = defaultSpeechDir() } = {}) {
  return recipesOf(compileScore(score)).map(recipe => {
    const file = speechFile(recipe, { cacheDir });
    return { ...recipe, file, cached: fs.existsSync(file) };
  });
}

/** Speak every uncached recipe with the local Kokoro model so renders can use
 * speech {cacheDir, synthesize: false}. Options: cacheDir, modelDir, offline,
 * log. Returns the recipes as speechRecipes does. */
export async function prepareSpeech(score, { cacheDir = defaultSpeechDir(), ...model } = {}) {
  const recipes = speechRecipes(score, { cacheDir });
  for (const recipe of recipes) if (!recipe.cached) await synthesizeSpeech(recipe, { cacheDir, ...model });
  return recipes.map(recipe => ({ ...recipe, cached: true, synthesized: !recipe.cached }));
}
