import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { pipeline } from 'node:stream/promises';
import { coverSvg } from './artwork.js';
import { zipStream } from './archive.js';
import { ROOT, VERSION, requireId, libraryPath, getLibrary, trackInfo, readScore, readCurrent, readMix, readVersions, trackPath, saveState, saveMix, saveFeedback, deleteFeedback, saveRequest, readRequests, midiForTrack, sourceIdentity } from './project.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.wav': 'audio/wav' };
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createRenderQueue(directory) {
  const jobs = [], listeners = new Map(); let active = null, stopped = false;
  const publicJobs = () => jobs.slice(-100).map(j => ({ id: j.id, trackId: j.trackId, status: j.status, progress: j.progress, error: j.error, type: j.stems ? 'stems' : 'render' }));
  const settle = job => { for (const fn of listeners.get(job.id) ?? []) fn(job); listeners.delete(job.id); };
  function runNext() {
    if (active || stopped) return;
    const job = jobs.find(j => j.status === 'queued'); if (!job) return;
    job.status = 'running'; job.progress = 0;
    const worker = new Worker(new URL('./render-worker.js', import.meta.url), { workerData: { directory, trackId: job.trackId, stems: job.stems } });
    active = worker;
    let complete = false;
    const finish = error => {
      if (complete) return; complete = true;
      if (error) { job.status = 'error'; job.error = error; } else { job.status = 'done'; job.progress = 1; }
      active = null; settle(job); runNext();
    };
    worker.on('message', message => {
      if (message.type === 'progress') job.progress = Math.max(0, Math.min(1, Number(message.progress) || 0));
      else if (message.type === 'done') finish();
      else if (message.type === 'error') finish(message.error);
    });
    worker.on('error', error => finish(error.message));
    worker.on('exit', code => { if (!complete) finish(code ? 'The audio renderer stopped unexpectedly.' : 'The renderer finished without an audio result.'); });
  }
  function enqueue(trackId, { stems = false } = {}) {
    readScore(directory, trackId);
    const existing = jobs.find(j => j.trackId === trackId && j.status === 'queued' && (!stems || j.stems));
    if (existing) return existing;
    const job = { id: crypto.randomBytes(10).toString('hex'), trackId, stems, status: 'queued', progress: 0 };
    jobs.push(job); runNext(); return job;
  }
  async function wait(job) {
    if (job.status === 'queued' || job.status === 'running') await new Promise(resolve => { const list = listeners.get(job.id) ?? []; list.push(resolve); listeners.set(job.id, list); });
    if (job.status === 'error') throw new Error(job.error); return job;
  }
  async function close() {
    stopped = true;
    for (const job of jobs) if (job.status === 'queued' || job.status === 'running') { job.status = 'error'; job.error = 'Studio closed before rendering finished.'; settle(job); }
    if (active) await active.terminate();
  }
  return { enqueue, wait, close, list: publicJobs };
}

async function jsonBody(request) {
  if (!String(request.headers['content-type'] ?? '').startsWith('application/json')) throw new Error('Send JSON with Content-Type: application/json.');
  let length = 0; const chunks = [];
  for await (const chunk of request) { length += chunk.length; if (length > 200000) throw new Error('This request is too large.'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('This request contains invalid JSON.'); }
}
function json(response, value, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value));
}
function disposition(filename) { return `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, '-')}"`; }
async function sendFile(request, response, file, { download } = {}) {
  const stat = await fs.promises.stat(file); if (!stat.isFile()) throw new Error('The requested audio file does not exist.');
  const headers = { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'no-cache' };
  if (download) headers['content-disposition'] = disposition(download);
  let start = 0, end = stat.size - 1, status = 200;
  if (request.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
    if (!match || (!match[1] && !match[2])) { response.writeHead(416, { 'content-range': `bytes */${stat.size}` }); response.end(); return; }
    if (!match[1]) start = Math.max(0, stat.size - Number(match[2]));
    else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= stat.size) { response.writeHead(416, { 'content-range': `bytes */${stat.size}` }); response.end(); return; }
    status = 206; headers['content-range'] = `bytes ${start}-${end}/${stat.size}`;
  }
  headers['content-length'] = Math.max(0, end - start + 1);
  response.writeHead(status, headers);
  if (request.method === 'HEAD') { response.end(); return; }
  await pipeline(fs.createReadStream(file, { start, end }), response);
}

function sharePage(score, duration) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(score.title)} — Soundroo</title><style>body{margin:0;background:#141416;color:#eee;font:16px system-ui;display:grid;place-items:center;min-height:100vh}main{width:min(90vw,520px);padding:36px 0}img{width:100%;border-radius:10px}h1{font-size:32px;margin-bottom:8px}p{color:#aaa;line-height:1.6}audio{width:100%;margin:22px 0}a{color:#d9b97b}.label{letter-spacing:3px;font-size:11px}</style><main><p class="label">SOUNDROO</p><img src="cover.svg" alt="${escape(score.title)} cover"><h1>${escape(score.title)}</h1><p>${escape(score.description ?? '')}</p><p>${escape(score.genre ?? '')} · ${escape(score.bpm)} BPM · ${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}</p><audio controls preload="metadata" src="track.wav"></audio><p>Open this page with the files beside it. The editable composition is in score.json.</p><a href="https://github.com/vincentsch/soundroo">Soundroo</a></main></html>`;
}

export async function startServer(directory, { port = 0, renderMissing = true, log = () => {} } = {}) {
  directory = libraryPath(directory);
  const queue = createRenderQueue(directory);
  let url;
  async function ensureAudio(id, { stems = false } = {}) {
    const current = readCurrent(directory, id), score = readScore(directory, id);
    const expected = sourceIdentity(directory, score, readMix(directory, id));
    const valid = current && current.id === expected && fs.existsSync(trackPath(directory, id, 'renders', current.id + '.wav'));
    if (!valid || (stems && !fs.existsSync(trackPath(directory, id, 'stems', current.id)))) await queue.wait(queue.enqueue(id, { stems }));
    const result = readCurrent(directory, id); if (!result) throw new Error('The track has not been rendered yet.'); return result;
  }
  const server = http.createServer(async (request, response) => {
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const host = request.headers.host ?? '';
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) { json(response, { error: 'Open the studio through its local loopback address.' }, 403); return; }
      const parsed = new URL(request.url, url ?? 'http://127.0.0.1');
      const pathname = decodeURIComponent(parsed.pathname);
      const mutation = request.method !== 'GET' && request.method !== 'HEAD';
      if (mutation && request.headers.origin && request.headers.origin !== `http://${host}`) { json(response, { error: 'The studio accepts changes from its own local page only.' }, 403); return; }
      if (pathname === '/api/health' && request.method === 'GET') { json(response, { app: 'soundroo', version: VERSION, status: 'ok' }); return; }
      if (pathname === '/api/library' && request.method === 'GET') { json(response, getLibrary(directory, queue.list())); return; }
      if (pathname === '/api/jobs' && request.method === 'GET') { json(response, { jobs: queue.list() }); return; }
      if (pathname === '/api/requests') {
        if (request.method === 'GET') { json(response, { requests: readRequests(directory) }); return; }
        if (request.method === 'POST') { json(response, { request: saveRequest(directory, await jsonBody(request)) }, 201); return; }
      }
      const match = /^\/api\/tracks\/([^/]+)(?:\/(.*))?$/.exec(pathname);
      if (match) {
        const id = requireId(match[1]), action = match[2] ?? '';
        if (!action && request.method === 'GET') { json(response, trackInfo(directory, id, { detail: true })); return; }
        if (action === 'state' && request.method === 'POST') { json(response, saveState(directory, id, await jsonBody(request))); return; }
        if (action === 'feedback' && request.method === 'POST') { json(response, { feedback: saveFeedback(directory, id, await jsonBody(request)) }, 201); return; }
        if (action.startsWith('feedback/') && request.method === 'DELETE') { json(response, deleteFeedback(directory, id, action.slice(9))); return; }
        if (action === 'mix' && request.method === 'POST') { saveMix(directory, id, await jsonBody(request)); const job = queue.enqueue(id); json(response, { job: { id: job.id, status: job.status } }, 202); return; }
        if (action === 'render' && request.method === 'POST') { const job = queue.enqueue(id); json(response, { job: { id: job.id, status: job.status } }, 202); return; }
        if (action === 'artwork' && request.method === 'GET') { const svg = coverSvg(readScore(directory, id)); response.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-cache' }); response.end(svg); return; }
        if ((action === 'audio' || /^versions\/[a-f0-9]{24}\/audio$/.test(action)) && ['GET', 'HEAD'].includes(request.method)) {
          const revision = action === 'audio' ? readCurrent(directory, id)?.id : action.split('/')[1];
          if (!revision || !readVersions(directory, id).some(v => v.id === revision)) { json(response, { error: 'This track is still being rendered.' }, 404); return; }
          await sendFile(request, response, trackPath(directory, id, 'renders', revision + '.wav')); return;
        }
        if (action.startsWith('download/') && request.method === 'GET') {
          const type = action.slice(9), score = readScore(directory, id);
          if (type === 'score') { response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': disposition(id + '.json') }); response.end(JSON.stringify(score, null, 2) + '\n'); return; }
          if (type === 'midi') { response.writeHead(200, { 'content-type': 'audio/midi', 'content-disposition': disposition(id + '.mid') }); response.end(await midiForTrack(directory, id)); return; }
          if (type === 'wav') { const current = await ensureAudio(id); await sendFile(request, response, trackPath(directory, id, 'renders', current.id + '.wav'), { download: id + '.wav' }); return; }
          if (type === 'stems' || type === 'share') {
            const current = await ensureAudio(id, { stems: type === 'stems' });
            let entries = [{ name: 'score.json', bytes: JSON.stringify(score, null, 2) + '\n' }];
            if (type === 'stems') {
              const stemDir = trackPath(directory, id, 'stems', current.id);
              entries.push({ name: 'master.wav', path: trackPath(directory, id, 'renders', current.id + '.wav') });
              for (const file of fs.readdirSync(stemDir).filter(n => n.endsWith('.wav'))) entries.push({ name: 'stems/' + file, path: path.join(stemDir, file) });
              entries.push({ name: 'README.txt', bytes: 'Dry instrument stems include part volume, pan, mute and solo. Shared master reverb, compression and gain are in the master WAV only. MIDI preserves note data, not the instrument sound.\n' });
            } else {
              entries.push({ name: 'index.html', bytes: sharePage(score, current.duration) }, { name: 'cover.svg', bytes: coverSvg(score) }, { name: 'track.wav', path: trackPath(directory, id, 'renders', current.id + '.wav') });
            }
            response.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': disposition(id + '-' + type + '.zip') });
            await pipeline(zipStream(entries), response); return;
          }
        }
        json(response, { error: 'This track operation does not exist.' }, 404); return;
      }
      if (pathname.startsWith('/api/')) { json(response, { error: 'This studio operation does not exist.' }, 404); return; }
      if (!['GET', 'HEAD'].includes(request.method)) { json(response, { error: 'Method not supported.' }, 405); return; }
      const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
      if (rel.split('/').some(s => s.startsWith('.')) || rel.includes('\\')) { json(response, { error: 'Page not found.' }, 404); return; }
      const root = path.join(ROOT, 'web'), file = path.resolve(root, rel);
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { json(response, { error: 'Page not found.' }, 404); return; }
      const real = fs.realpathSync(file); if (!real.startsWith(fs.realpathSync(root) + path.sep)) throw new Error('Page not found.');
      await sendFile(request, response, file);
    } catch (error) {
      if (response.headersSent) { response.destroy(error); return; }
      const status = error.code === 'ENOENT' || /not exist|Cannot read score\.json/.test(error.message) ? 404 : 400;
      json(response, { error: error.message }, status);
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  url = `http://127.0.0.1:${server.address().port}`;
  if (renderMissing) for (const track of getLibrary(directory).tracks) {
    try {
      if (!track.rendered || readCurrent(directory, track.id)?.id !== sourceIdentity(directory, readScore(directory, track.id), readMix(directory, track.id))) queue.enqueue(track.id);
    } catch (error) { log(`${track.id}: ${error.message}`); }
  }
  return { server, queue, url, directory, close: async () => { await queue.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
