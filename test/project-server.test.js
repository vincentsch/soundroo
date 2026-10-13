import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initLibrary, writeJson, trackPath, saveMix, getLibrary } from '../src/project.js';
import { startServer } from '../src/server.js';
import { encodeWav } from '../src/audio/wav.js';
import { crc32, zipStream } from '../src/archive.js';

test('studio persists listening feedback/favorites/requests and serves seekable audio', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'soundroo-server-'));
  let studio;
  try {
    await initLibrary(directory, { title: 'Personal collection' });
    const score = { version: 1, id: 'test-piece', title: 'Test piece', bpm: 120, beats: 4, parts: [{ id: 'keys', name: 'Keys', instrument: 'epiano', volume: 0.5, notes: [{ pitch: 60, beat: 0, duration: 1, velocity: 0.7 }] }], sections: [{ id: 'a', name: 'A', beat: 0, beats: 4 }] };
    writeJson(trackPath(directory, score.id, 'score.json'), score);
    const collection = JSON.parse(fs.readFileSync(path.join(directory, 'collection.json'))); collection.tracks.push(score.id); writeJson(path.join(directory, 'collection.json'), collection);
    const revision = 'a'.repeat(24);
    const values = new Float32Array(24000).fill(0.1);
    const bytes = Buffer.from(encodeWav({ length: values.length, sampleRate: 24000, numberOfChannels: 2, getChannelData: () => values }));
    fs.mkdirSync(trackPath(directory, score.id, 'renders'), { recursive: true });
    fs.writeFileSync(trackPath(directory, score.id, 'renders', revision + '.wav'), bytes);
    writeJson(trackPath(directory, score.id, 'renders', revision + '.report.json'), { duration: 1, waveform: [0.1, 0.1] });
    writeJson(trackPath(directory, score.id, 'renders', 'index.json'), [{ id: revision, label: 'Version 1', duration: 1 }]);
    writeJson(trackPath(directory, score.id, 'renders', 'current.json'), { id: revision, duration: 1 });
    studio = await startServer(directory, { renderMissing: false });
    const call = (route, body, extra = {}) => fetch(studio.url + route, { ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}), ...extra });
    const library = await (await call('/api/library')).json();
    assert.equal(library.collection.source, 'personal'); assert.equal(library.tracks[0].rendered, true);
    const part = await call('/api/tracks/test-piece/audio', null, { headers: { range: 'bytes=0-43' } });
    assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), `bytes 0-43/${bytes.length}`);
    assert.equal(Buffer.from(await part.arrayBuffer()).toString('ascii', 0, 4), 'RIFF');
    const bad = await call('/api/tracks/test-piece/audio', null, { headers: { range: 'bytes=999999999-' } }); assert.equal(bad.status, 416);
    await call('/api/tracks/test-piece/state', { favorite: true });
    await call('/api/tracks/test-piece/feedback', { text: 'Make this section quieter.', time: 0.5 });
    const detail = await (await call('/api/tracks/test-piece')).json();
    assert.equal(detail.favorite, true); assert.equal(detail.feedback[0].time, 0.5);
    assert.equal(detail.feedback[0].text, 'Make this section quieter.');
    const request = await (await call('/api/requests', { brief: 'Ten quiet pieces for a rainy evening.', count: 10 })).json();
    assert.equal(request.request.count, 10); assert.ok(path.isAbsolute(request.request.path)); assert.ok(fs.existsSync(request.request.path));
    const requests = await (await call('/api/requests')).json(); assert.equal(requests.requests.length, 1); assert.equal(requests.requests[0].path, request.request.path);
    assert.equal((await call('/api/tracks/test-piece/state', { favorite: false }, { method: 'POST', headers: { origin: 'https://other.example', 'content-type': 'application/json' }, body: JSON.stringify({ favorite: false }) })).status, 403);
    assert.equal((await call('/api/tracks/test-piece/feedback', { text: '', time: 0 })).status, 400);
    saveMix(directory, score.id, { parts: { keys: { volume: 0.2, mute: true } } });
    assert.equal(getLibrary(directory).tracks[0].parts[0].volume, 0.2);
    assert.throws(() => saveMix(directory, score.id, { parts: { keys: { pan: 3 } } }), /Invalid pan/);
    assert.throws(() => trackPath(directory, '../secret', 'score.json'), /lowercase/);
  } finally { if (studio) await studio.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('ZIP streaming records file names, payload CRCs and complete central directory', async () => {
  const bytes = Buffer.from('original music');
  const chunks = []; for await (const chunk of zipStream([{ name: 'score.json', bytes }])) chunks.push(chunk);
  const archive = Buffer.concat(chunks);
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  assert.equal(archive.readUInt32LE(14), crc32(bytes));
  assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50);
  assert.equal(archive.readUInt16LE(archive.length - 12), 1);
  assert.ok(archive.includes(bytes));
});
