import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureBinary, cachedBinary, platformKey, manifestEntry, cacheDir, binaryName } from '../src/cloud/binary.js';
import { connect } from '../src/cloud/share.js';
import { STUB_SOURCE, tempDir, posix } from './fixtures/sharing.js';

const key = platformKey();
const stubBytes = fs.readFileSync(STUB_SOURCE);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function serve(routes) {
  const hits = [];
  const server = http.createServer((request, response) => {
    hits.push(request.url);
    const route = routes[request.url];
    if (!route) { response.writeHead(404, { 'content-type': 'application/json' }); response.end('{"message":"Not Found"}'); return; }
    const value = typeof route === 'function' ? route(request) : route;
    response.writeHead(value.status ?? 200, value.headers ?? {});
    response.end(value.body ?? '');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, hits, close: () => new Promise(resolve => server.close(resolve)) };
}

function manifest(entry = {}, extra = {}) {
  return JSON.stringify({ name: 'soundroo-cloud', version: '0.1.0', protocol: 1, platforms: { [key]: { url: '0.1.0/soundroo-cloud_test', sha256: sha(stubBytes), size: stubBytes.length, ...entry } }, ...extra });
}

test('the binary is downloaded from the service, verified and cached', { skip: !key && 'no prebuilt platform' }, async () => {
  const service = await serve({ '/downloads/cli/manifest.json': { body: manifest() }, '/downloads/cli/0.1.0/soundroo-cloud_test': { body: stubBytes } });
  const env = { SOUNDROO_CACHE: tempDir() };
  try {
    const first = await ensureBinary({ origin: service.origin, env });
    assert.equal(first.source, 'download');
    assert.equal(first.sha256, sha(stubBytes));
    assert.equal(first.path, path.join(cacheDir(env), sha(stubBytes), binaryName()));
    assert.deepEqual(fs.readFileSync(first.path), stubBytes);
    if (posix) assert.equal(fs.statSync(first.path).mode & 0o777, 0o755);
    const record = JSON.parse(fs.readFileSync(path.join(path.dirname(first.path), 'binary.json'), 'utf8'));
    assert.deepEqual([record.version, record.platform, record.origin, record.origins], ['0.1.0', key, service.origin, [service.origin]]);
    assert.ok(!fs.readdirSync(path.dirname(first.path)).some(name => name.endsWith('.part')));
    const second = await ensureBinary({ origin: service.origin, env });
    assert.equal(second.source, 'cache');
    assert.equal(service.hits.filter(url => url.includes('soundroo-cloud_test')).length, 1, 'cached binary downloaded again');
    // A damaged cached file is never run: it is replaced on the next share.
    fs.appendFileSync(first.path, 'tampered');
    assert.equal(cachedBinary({ origin: service.origin, env }), null);
    const repaired = await ensureBinary({ origin: service.origin, env });
    assert.equal(repaired.source, 'download');
    assert.deepEqual(fs.readFileSync(repaired.path), stubBytes);
  } finally { await service.close(); }
});

test('nothing is downloaded when a command does not need the network', { skip: !key && 'no prebuilt platform' }, async () => {
  const service = await serve({ '/downloads/cli/manifest.json': { body: manifest() } });
  try {
    assert.equal(await ensureBinary({ origin: service.origin, env: { SOUNDROO_CACHE: tempDir() }, download: false }), null);
    assert.deepEqual(service.hits, []);
  } finally { await service.close(); }
});

test('downloads that do not match the manifest are discarded', { skip: !key && 'no prebuilt platform' }, async () => {
  for (const [name, routes, code] of [
    ['wrong hash', { '/downloads/cli/manifest.json': { body: manifest({ sha256: 'f'.repeat(64) }) }, '/downloads/cli/0.1.0/soundroo-cloud_test': { body: stubBytes } }, 'binary_integrity'],
    ['too long', { '/downloads/cli/manifest.json': { body: manifest() }, '/downloads/cli/0.1.0/soundroo-cloud_test': { body: Buffer.concat([stubBytes, Buffer.from('extra')]) } }, 'binary_integrity'],
    ['newer protocol', { '/downloads/cli/manifest.json': { body: manifest({}, { protocol: 2 }) } }, 'protocol_mismatch'],
  ]) {
    const service = await serve(routes);
    const env = { SOUNDROO_CACHE: tempDir() };
    try {
      await assert.rejects(ensureBinary({ origin: service.origin, env }), error => error.code === code && error.exitCode === 2, name);
      const dir = cacheDir(env);
      const leftovers = fs.existsSync(dir) ? fs.readdirSync(dir).flatMap(sub => fs.readdirSync(path.join(dir, sub))) : [];
      assert.deepEqual(leftovers, [], `${name} left files behind`);
    } finally { await service.close(); }
  }
});

test('binaries come only from the configured origin', { skip: !key && 'no prebuilt platform' }, async () => {
  const other = await serve({ '/soundroo-cloud': { body: stubBytes }, '/downloads/cli/manifest.json': { body: manifest() } });
  const pointing = await serve({ '/downloads/cli/manifest.json': { body: manifest({ url: other.origin + '/soundroo-cloud' }) } });
  const redirecting = await serve({ '/downloads/cli/manifest.json': { status: 302, headers: { location: other.origin + '/downloads/cli/manifest.json' } } });
  const sameRedirect = await serve({
    '/downloads/cli/manifest.json': { status: 307, headers: { location: '/downloads/cli/v2/manifest.json' } },
    '/downloads/cli/v2/manifest.json': { body: manifest({ url: 'soundroo-cloud' }) },
    '/downloads/cli/v2/soundroo-cloud': { body: stubBytes },
  });
  try {
    await assert.rejects(ensureBinary({ origin: pointing.origin, env: { SOUNDROO_CACHE: tempDir() } }), error => error.code === 'cross_origin_download');
    await assert.rejects(ensureBinary({ origin: redirecting.origin, env: { SOUNDROO_CACHE: tempDir() } }), error => error.code === 'redirect_refused');
    assert.deepEqual(other.hits, [], 'another origin was contacted');
    const followed = await ensureBinary({ origin: sameRedirect.origin, env: { SOUNDROO_CACHE: tempDir() } });
    assert.equal(followed.source, 'download');
    assert.throws(() => manifestEntry(JSON.parse(manifest({ url: 'https://evil.example/x' })), key, 'https://soundroo.com/downloads/cli/manifest.json', 'https://soundroo.com'), error => error.code === 'cross_origin_download');
    assert.throws(() => manifestEntry({ name: 'other', protocol: 1, version: '1.0.0', platforms: {} }, key, 'https://soundroo.com/x', 'https://soundroo.com'), error => error.code === 'bad_manifest');
  } finally { await Promise.all([other.close(), pointing.close(), redirecting.close(), sameRedirect.close()]); }
});

test('a cached binary serves only the services that vouched for it', { skip: !key && 'no prebuilt platform' }, async () => {
  let offering = true;
  const good = await serve({ '/downloads/cli/manifest.json': () => (offering ? { body: manifest() } : { status: 404 }), '/downloads/cli/0.1.0/soundroo-cloud_test': { body: stubBytes } });
  const bare = await serve({});
  const vouching = await serve({ '/downloads/cli/manifest.json': { body: manifest() } });
  const env = { SOUNDROO_CACHE: tempDir() };
  try {
    await ensureBinary({ origin: good.origin, env });
    // The service it came from stops offering downloads: the verified binary still works.
    offering = false;
    const reused = await ensureBinary({ origin: good.origin, env });
    assert.equal(reused.source, 'cache');
    assert.equal(reused.stale, true);
    // Another service without downloads never gets it: it would read that service's key.
    await assert.rejects(ensureBinary({ origin: bare.origin, env }), error => error.code === 'binary_unavailable' && /SOUNDROO_CLOUD_BIN/.test(error.hint));
    assert.equal(cachedBinary({ origin: bare.origin, env }), null);
    assert.equal(await ensureBinary({ origin: bare.origin, env, download: false }), null);
    // A service whose manifest lists the same build reuses it without a download, and keeps it offline.
    const events = [];
    const same = await ensureBinary({ origin: vouching.origin, env, onProgress: event => events.push(event.stage) });
    assert.equal(same.source, 'cache');
    assert.deepEqual(events, [], 'reported a download that did not happen');
    assert.deepEqual(vouching.hits, ['/downloads/cli/manifest.json']);
    assert.equal(cachedBinary({ origin: vouching.origin, env })?.sha256, sha(stubBytes));
    const record = JSON.parse(fs.readFileSync(path.join(cacheDir(env), sha(stubBytes), 'binary.json'), 'utf8'));
    assert.deepEqual([record.origin, record.origins], [good.origin, [good.origin, vouching.origin]]);
  } finally { await Promise.all([good.close(), bare.close(), vouching.close()]); }
});

test('the toolkit runs the binary without a shell and checks its protocol', { skip: !posix && 'POSIX shebang stub' }, async () => {
  const dir = tempDir();
  const file = path.join(dir, 'soundroo-cloud');
  fs.copyFileSync(STUB_SOURCE, file);
  fs.chmodSync(file, 0o755);
  fs.writeFileSync(path.join(dir, 'behavior.json'), JSON.stringify({ 'auth status': { service: 'x', key: { present: false } } }));
  const env = { ...process.env, SOUNDROO_CLOUD_BIN: file, STUB_DIR: dir };
  const { cloud } = await connect('https://soundroo.com', { env });
  assert.deepEqual(await cloud(['auth', 'status']), { service: 'x', key: { present: false } });
  const calls = fs.readFileSync(path.join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(calls[0].argv, ['version', '--json']);
  assert.deepEqual(calls[1].argv, ['--service', 'https://soundroo.com', '--json', '--no-prompt', 'auth', 'status']);
  // A binary speaking another protocol is refused.
  const old = path.join(dir, 'old-cloud');
  fs.copyFileSync(STUB_SOURCE, old);
  fs.chmodSync(old, 0o755);
  fs.writeFileSync(path.join(dir, 'behavior.json'), JSON.stringify({ version: { name: 'soundroo-cloud', version: '9.0.0', protocol: 9 } }));
  await assert.rejects(connect('https://soundroo.com', { env: { ...env, SOUNDROO_CLOUD_BIN: old } }), error => error.code === 'protocol_mismatch');
  await assert.rejects(connect('https://soundroo.com', { env: { ...env, SOUNDROO_CLOUD_BIN: path.join(dir, 'missing') } }), error => error.code === 'binary_missing');
});
