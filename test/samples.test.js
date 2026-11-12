import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { installPacks, scorePacks, samplesStatus } from '../src/samples-install.js';
import { defaultSamplesDir, packFileName, sampleManifest, MissingSamplesError } from '../src/audio/library.js';
import { renderScore } from '../src/render.js';

// The strings pack is the smallest; the fake server serves the installed copy.
const NAME = 'strings';
const installed = () => fs.readFileSync(path.join(defaultSamplesDir(), packFileName(NAME)));
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'soundroo-samples-'));

function server(bytes, { failAfter = Infinity, corrupt = false } = {}) {
  const requests = [];
  const fetchImpl = async (url, { headers = {} } = {}) => {
    requests.push({ url, range: headers.Range ?? null });
    const from = headers.Range ? Number(/bytes=(\d+)-/.exec(headers.Range)[1]) : 0;
    let body = bytes.subarray(from);
    if (corrupt) { body = Buffer.from(body); body[body.length - 1] ^= 0xff; }
    async function* chunks() {
      let sent = 0;
      for (let at = 0; at < body.length; at += 1 << 20) {
        if (sent >= failAfter) throw new Error('connection reset');
        const chunk = body.subarray(at, Math.min(body.length, at + (1 << 20)));
        sent += chunk.length;
        yield chunk;
      }
    }
    return { status: from ? 206 : 200, body: chunks() };
  };
  return { fetchImpl, requests };
}

test('a pack downloads once, resumes after an interruption and is checked', async () => {
  const bytes = installed(), dir = temp();
  try {
    const flaky = server(bytes, { failAfter: 30 << 20 });
    await assert.rejects(installPacks([NAME], { samplesDir: dir, fetchImpl: flaky.fetchImpl, env: {} }), /connection reset/);
    const part = path.join(dir, `${packFileName(NAME)}.part`);
    assert.ok(fs.statSync(part).size >= 30 << 20);
    const good = server(bytes);
    const [status] = await installPacks([NAME], { samplesDir: dir, fetchImpl: good.fetchImpl, env: {} });
    assert.equal(status.installed, true);
    assert.match(good.requests[0].range, /^bytes=\d+-$/);
    assert.equal(good.requests[0].url, sampleManifest().packs[NAME].url);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, packFileName(NAME)))).digest('hex'), sampleManifest().packs[NAME].sha256);
    assert.ok(!fs.existsSync(part));
    // Installed packs are not downloaded again.
    const again = server(bytes);
    await installPacks([NAME], { samplesDir: dir, fetchImpl: again.fetchImpl, env: {} });
    assert.equal(again.requests.length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('damaged downloads, offline mode and missing packs fail clearly', async () => {
  const bytes = installed(), dir = temp();
  try {
    await assert.rejects(installPacks([NAME], { samplesDir: dir, fetchImpl: server(bytes, { corrupt: true }).fetchImpl, env: {} }), /did not download intact/);
    assert.ok(!fs.existsSync(path.join(dir, `${packFileName(NAME)}.part`)));
    const offline = server(bytes);
    await assert.rejects(installPacks([NAME], { samplesDir: dir, fetchImpl: offline.fetchImpl, env: { SOUNDROO_OFFLINE: '1' } }), error => error.code === 'samples_missing');
    assert.equal(offline.requests.length, 0);
    const mirror = server(bytes);
    await installPacks([NAME], { samplesDir: dir, fetchImpl: mirror.fetchImpl, env: { SOUNDROO_SAMPLES_URL: 'https://mirror.example/packs/' } });
    assert.equal(mirror.requests[0].url, `https://mirror.example/packs/${packFileName(NAME)}`);
    await assert.rejects(installPacks(['harp'], { samplesDir: dir }), /Unknown sample pack harp/);
    const score = { version: 1, id: 'needs', title: 'Needs', bpm: 120, beats: 4, parts: [{ id: 'p', instrument: 'piano', notes: [{ pitch: 60, beat: 0, duration: 1 }] }, { id: 'k', instrument: 'rock-kick', notes: [{ pitch: 36, beat: 0, duration: 1 }] }, { id: 'l', instrument: 'analog-lead', notes: [{ pitch: 60, beat: 0, duration: 1 }] }] };
    assert.deepEqual(scorePacks(score), ['drums', 'piano']);
    await assert.rejects(renderScore(score, { samplesDir: dir }), error => error instanceof MissingSamplesError && error.code === 'samples_missing' && error.packs.join() === 'drums,piano');
    const synthesized = await renderScore(score, { samplesDir: dir, sound: 'synthesized', sampleRate: 8000 });
    assert.ok(synthesized.report.rms > 0);
    assert.deepEqual(samplesStatus({ samplesDir: dir }).filter(p => p.installed).map(p => p.name), [NAME]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
