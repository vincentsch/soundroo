import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareSpeech, render, speechRecipes } from '../src/headless.js';
import { SPEECH_MODEL, synthesizeSpeech, defaultModelDir } from '../src/speech.js';
import { parseWav } from '../src/audio/pcm.js';

// The optional local speech runtime: npm install --no-save --package-lock=false
// kokoro-js@1.2.1 @huggingface/transformers@3.8.1. Run with SOUNDROO_TEST_KOKORO=1;
// the first run downloads the public model into the Soundroo model cache.
const skip = process.env.SOUNDROO_TEST_KOKORO !== '1' && 'set SOUNDROO_TEST_KOKORO=1 to test local Kokoro speech';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('speech recipes are spoken once by local Kokoro, cached and rendered repeatably', { skip, timeout: 600000 }, async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soundroo-kokoro-'));
  try {
    const score = { version: 2, id: 'lantern', title: 'Lantern', bpm: 100, beats: 8, parts: [
      { id: 'voice', instrument: 'sample', sample: { speech: { text: 'Carry the lantern home.', voice: 'am_michael' }, effect: 'chop', pattern: [0, null, 1, 2] }, notes: [{ pitch: 60, beat: 0, duration: 4, velocity: 0.8 }] },
      { id: 'pulse', instrument: 'kick', patterns: { beat: { beats: 4, steps: 'x...x...x...x...' } }, clips: [{ pattern: 'beat', beat: 0, repeat: 2 }] },
    ] };
    const [prepared] = await prepareSpeech(score, { cacheDir });
    assert.equal(prepared.synthesized, true);
    const wav = parseWav(new Uint8Array(fs.readFileSync(prepared.file)).buffer);
    assert.equal(wav.channels.length, 1);
    assert.equal(wav.sampleRate, 24000);
    const seconds = wav.channels[0].length / wav.sampleRate;
    assert.ok(seconds > 0.5 && seconds < 10, `${seconds} s`);
    assert.deepEqual((await prepareSpeech(score, { cacheDir })).map(r => r.synthesized), [false]);
    const options = { sampleRate: 22050, speech: { cacheDir, synthesize: false } };
    const a = await render(score, options), b = await render(score, options);
    assert.ok(a.wav.equals(b.wav));
    assert.ok(a.report.rms > 0.005);
    const again = await synthesizeSpeech(speechRecipes(score, { cacheDir })[0], { cacheDir: path.join(cacheDir, 'again') });
    assert.ok(fs.readFileSync(again.file).equals(fs.readFileSync(prepared.file)), 'the same recipe speaks the same samples on one machine');
    const weights = fs.readFileSync(path.join(defaultModelDir(), SPEECH_MODEL.id, SPEECH_MODEL.weights));
    assert.equal(crypto.createHash('sha256').update(weights).digest('hex'), SPEECH_MODEL.sha256);
    const out = path.join(cacheDir, 'cli.wav');
    const cli = spawnSync(process.execPath, [path.join(ROOT, 'bin/soundroo.js'), 'voice', 'create', 'Made of light', '--out', out, '--json'], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).voice, 'af_heart');
    assert.ok(fs.statSync(out).size > 10000);
  } finally { fs.rmSync(cacheDir, { recursive: true, force: true }); }
});
