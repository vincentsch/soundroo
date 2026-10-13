// Speech recipes. A sample part can name spoken words, sample.speech
// {text, voice}, instead of a WAV. The optional local Kokoro model speaks each
// recipe once into a cache; renders read the cached phrase, so a recipe sounds
// the same every time it renders on that machine. Instrumental scores never
// load this runtime.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { parseWav } from './audio/pcm.js';
import { DEFAULT_SPEECH_VOICE } from './catalog.js';
import { speechText } from './score.js';

// The one model recipes use: Kokoro-82M v1.0, 8-bit ONNX weights, CPU. The
// hash identifies the weights file a deployment should have downloaded.
export const SPEECH_MODEL = Object.freeze({ id: 'onnx-community/Kokoro-82M-v1.0-ONNX', dtype: 'q8', device: 'cpu', speed: 1, weights: 'onnx/model_quantized.onnx', sha256: 'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478' });
export const SPEECH_RUNTIME = 'kokoro-js@1.2.1 @huggingface/transformers@3.8.1';

function cacheRoot() { return process.env.SOUNDROO_CACHE ?? path.join(os.homedir(), '.cache', 'soundroo'); }
export function defaultSpeechDir() { return path.join(cacheRoot(), 'speech'); }
export function defaultModelDir() { return path.join(cacheRoot(), 'models'); }

function recipe({ text, voice } = {}) {
  if (typeof text !== 'string' || !speechText(text)) throw new TypeError('A speech recipe needs text.');
  return { text: speechText(text), voice: voice ?? DEFAULT_SPEECH_VOICE };
}
// Cached phrases are named by their words, voice and the fixed model settings.
export function speechKey(value) {
  const { text, voice } = recipe(value);
  return crypto.createHash('sha256').update(JSON.stringify(['soundroo-speech/1', SPEECH_MODEL.id, SPEECH_MODEL.dtype, SPEECH_MODEL.speed, voice, text])).digest('hex').slice(0, 32);
}
export function speechFile(value, { cacheDir = defaultSpeechDir() } = {}) {
  return path.join(cacheDir, speechKey(value) + '.wav');
}

const models = new Map();
export function loadKokoro({ dtype = SPEECH_MODEL.dtype, modelDir = defaultModelDir(), offline = process.env.SOUNDROO_OFFLINE === '1', log = () => {} } = {}) {
  const key = JSON.stringify([dtype, modelDir, offline]);
  if (!models.has(key)) {
    const loading = (async () => {
      let KokoroTTS, env;
      try { ({ KokoroTTS } = await import('kokoro-js')); ({ env } = await import('@huggingface/transformers')); }
      catch (error) {
        if (error.code === 'ERR_MODULE_NOT_FOUND') throw new Error(`Optional speech runtime is not installed. From the Soundroo source folder run: npm install --no-save --package-lock=false ${SPEECH_RUNTIME}`);
        throw error;
      }
      env.cacheDir = modelDir;
      env.allowRemoteModels = !offline;
      let last = 0;
      return KokoroTTS.from_pretrained(SPEECH_MODEL.id, {
        dtype, device: SPEECH_MODEL.device, progress_callback: event => {
          if (event.status === 'progress' && Date.now() - last > 1500) { last = Date.now(); log(`Voice model: ${Math.round(event.progress ?? 0)}%`); }
        },
      });
    })();
    models.set(key, loading);
    loading.catch(() => models.delete(key));
  }
  return models.get(key);
}

function floatWav(samples, sampleRate) {
  const bytes = Buffer.alloc(58 + samples.length * 4);
  bytes.write('RIFF', 0, 'ascii'); bytes.writeUInt32LE(50 + samples.length * 4, 4); bytes.write('WAVEfmt ', 8, 'ascii');
  bytes.writeUInt32LE(18, 16); bytes.writeUInt16LE(3, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 4, 28); bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(32, 34); bytes.writeUInt16LE(0, 36);
  bytes.write('fact', 38, 'ascii'); bytes.writeUInt32LE(4, 42); bytes.writeUInt32LE(samples.length, 46);
  bytes.write('data', 50, 'ascii'); bytes.writeUInt32LE(samples.length * 4, 54);
  for (let i = 0; i < samples.length; i++) bytes.writeFloatLE(samples[i], 58 + i * 4);
  return bytes;
}

// Speaks a recipe with Kokoro and stores the phrase as a 32-bit float WAV.
export async function synthesizeSpeech(value, { cacheDir = defaultSpeechDir(), log = () => {}, ...model } = {}) {
  const { text, voice } = recipe(value);
  const tts = await loadKokoro({ ...model, dtype: SPEECH_MODEL.dtype, log });
  log(`Speaking “${text}” (${voice})`);
  const result = await tts.generate(text, { voice, speed: SPEECH_MODEL.speed });
  const samples = result?.audio, sampleRate = result?.sampling_rate;
  if (!samples?.length || !Number.isInteger(sampleRate) || samples.length > sampleRate * 60 || samples.some(v => !Number.isFinite(v))) throw new Error(`Speech synthesis for “${text}” did not return 1–60 seconds of valid audio.`);
  const file = speechFile({ text, voice }, { cacheDir });
  fs.mkdirSync(cacheDir, { recursive: true });
  const temporary = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, floatWav(samples, sampleRate));
  fs.renameSync(temporary, file);
  return { file, key: speechKey({ text, voice }), text, voice, duration: samples.length / sampleRate };
}

// The phrase audio for a recipe, speaking it first when it is not cached and
// synthesis is allowed. Returns parsed WAV channels.
export async function speechAudio(value, { cacheDir = defaultSpeechDir(), synthesize = true, ...model } = {}) {
  const file = speechFile(value, { cacheDir });
  if (!fs.existsSync(file)) {
    const { text, voice } = recipe(value);
    if (!synthesize) throw new Error(`Speech “${text}” (${voice}) is not in the speech cache. Prepare it first or allow synthesis.`);
    await synthesizeSpeech(value, { cacheDir, ...model });
  }
  const bytes = await fs.promises.readFile(file);
  try { return parseWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); }
  catch (error) { throw new Error(`Cached speech ${file} is unreadable (${error.message}). Delete it to speak the phrase again.`); }
}

// Distinct recipes of a compiled score, in part order.
export function speechRecipes(expandedScore) {
  const found = new Map();
  for (const part of expandedScore.parts) if (part.sample?.speech) {
    const key = speechKey(part.sample.speech);
    if (!found.has(key)) found.set(key, { key, text: part.sample.speech.text, voice: part.sample.speech.voice });
  }
  return [...found.values()];
}
