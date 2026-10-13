import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseWav, resample, toMono } from './audio/pcm.js';
import { encodeWav } from './audio/wav.js';
import { tapePitch, granularVoice, vocodeVoice, chopVoice } from './audio/voice-effects.js';
import { analyzeAudio } from './audio/analysis.js';

export function audioBuffer(channels, sampleRate) {
  return { sampleRate, length: channels[0].length, numberOfChannels: channels.length, duration: channels[0].length / sampleRate, getChannelData: index => channels[index] };
}
export function processSpeech(samples, sampleRate, { effect = 'dry', semitones = 0, pitch = 57, stretch = 1, bpm = 120, pattern } = {}) {
  if (!Number.isFinite(semitones) || Math.abs(semitones) > 24 || !Number.isFinite(pitch) || pitch < 24 || pitch > 96 || !Number.isFinite(stretch) || stretch < 0.25 || stretch > 4 || !Number.isFinite(bpm) || bpm < 20 || bpm > 400) throw new Error('Voice settings are outside the supported musical range.');
  if (pattern && (!Array.isArray(pattern) || pattern.length > 128 || pattern.some(v => v != null && (!Number.isInteger(v) || v < -1 || v > 3)))) throw new Error('Voice chop patterns use slice numbers 0–3 and null rests.');
  if (effect === 'dry') return samples.slice();
  if (effect === 'tape') return tapePitch(samples, semitones);
  if (effect === 'granular') return granularVoice(samples, sampleRate, { semitones, stretch });
  if (effect === 'vocoder') return vocodeVoice(samples, sampleRate, { pitch });
  if (effect === 'chop') return chopVoice(samples, sampleRate, { semitones, bpm, ...(pattern ? { pattern } : {}) });
  throw new Error('Choose a voice effect: dry, tape, granular, vocoder or chop.');
}

export async function createSpeech(text, outFile, { voice = 'af_heart', dtype = 'q8', cacheDir, log = () => {} } = {}) {
  if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('Speech needs between 1 and 2,000 characters.');
  if (!/^[a-z]{2}_[a-z]+$/.test(voice)) throw new Error('Choose a Kokoro voice such as af_heart or am_michael.');
  if (!['fp32', 'fp16', 'q8', 'q4', 'q4f16'].includes(dtype)) throw new Error('Choose a supported voice model precision.');
  let KokoroTTS, env;
  try { ({ KokoroTTS } = await import('kokoro-js')); ({ env } = await import('@huggingface/transformers')); }
  catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') throw new Error('Optional speech runtime is not installed. From the Soundroo source folder run: npm install --no-save kokoro-js@1.2.1 @huggingface/transformers@3.8.1');
    throw error;
  }
  env.cacheDir = cacheDir ?? path.join(process.env.SOUNDROO_CACHE ?? path.join(os.homedir(), '.cache', 'soundroo'), 'models');
  env.allowRemoteModels = process.env.SOUNDROO_OFFLINE !== '1';
  let last = 0;
  const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
    dtype, device: 'cpu', progress_callback: event => {
      if (event.status === 'progress' && Date.now() - last > 1500) { last = Date.now(); log(`Voice model: ${Math.round(event.progress ?? 0)}%`); }
    },
  });
  const audio = await tts.generate(text.trim(), { voice, speed: 1 });
  const buffer = audioBuffer([audio.audio], audio.sampling_rate);
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.writeFileSync(outFile, Buffer.from(encodeWav(buffer)));
  return { file: path.resolve(outFile), text: text.trim(), voice, ...analyzeAudio([audio.audio], audio.sampling_rate) };
}
export function transformSpeech(file, outFile, options = {}) {
  const bytes = fs.readFileSync(file), audio = parseWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const sampleRate = options.sampleRate ?? 44100;
  const mono = resample(toMono(audio.channels), audio.sampleRate, sampleRate);
  const output = processSpeech(mono, sampleRate, options);
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.writeFileSync(outFile, Buffer.from(encodeWav(audioBuffer([output], sampleRate))));
  return { file: path.resolve(outFile), effect: options.effect ?? 'dry', ...analyzeAudio([output], sampleRate) };
}
