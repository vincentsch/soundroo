// End to end with the real soundroo-cloud: the toolkit downloads the binary
// from a stand-in service's manifest, verifies it and shares a library through
// it. Runs where Go is installed; the toolkit itself never needs Go.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { platformKey } from '../src/cloud/binary.js';
import { runNetworkCommand } from '../src/cloud/cli.js';
import { readSharing } from '../src/cloud/state.js';
import { makeLibrary, tempDir } from './fixtures/sharing.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Runs wherever Go is installed, except in CI unless SOUNDROO_TEST_GO=1: the
// toolkit's own checks never need Go.
const go = spawnSync('go', ['version'], { encoding: 'utf8' });
const skip = (go.status !== 0 && 'Go is not installed') || (!platformKey() && 'no prebuilt platform') || (process.env.CI && process.env.SOUNDROO_TEST_GO !== '1' && 'set SOUNDROO_TEST_GO=1 to build soundroo-cloud in CI');

function buildBinary() {
  const out = path.join(tempDir('soundroo-go-'), process.platform === 'win32' ? 'soundroo-cloud.exe' : 'soundroo-cloud');
  const result = spawnSync('go', ['build', '-trimpath', '-o', out, '.'], { cwd: path.join(root, 'cloud-cli'), env: { ...process.env, CGO_ENABLED: '0', GOFLAGS: '-mod=readonly' }, encoding: 'utf8', timeout: 300_000 });
  assert.equal(result.status, 0, result.stderr);
  return out;
}

// A small stand-in for the Laravel API with the same routes and shapes.
async function fakeService(binary) {
  const bytes = fs.readFileSync(binary);
  const seen = [];
  const tokens = new Map();
  const releases = new Map();
  let guests = 0;
  let owner = null;
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    seen.push({ method: request.method, url: request.url, auth: request.headers.authorization ?? '', key: request.headers['idempotency-key'] ?? '', body });
    const send = (status, value) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(typeof value === 'string' ? value : JSON.stringify(value)); };
    const url = request.url;
    if (url === '/downloads/cli/manifest.json') return send(200, { name: 'soundroo-cloud', version: '0.1.0', protocol: 1, platforms: { [platformKey()]: { url: '0.1.0/soundroo-cloud', sha256: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length } } });
    if (url === '/downloads/cli/0.1.0/soundroo-cloud') { response.writeHead(200, { 'content-type': 'application/octet-stream' }); return response.end(bytes); }
    if (request.headers.accept !== 'application/json') return send(500, { message: 'Route [login] not defined.' });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const artist = handle => ({ id: '01JARTIST00000000000000001', handle, name: 'Amber Orchard', url: `${origin}/@${handle}` });
    if (request.method === 'POST' && url === '/api/v1/guest-keys') {
      guests++;
      const token = `${guests}|guest${crypto.randomBytes(12).toString('hex')}`;
      tokens.set(token, 'amber-orchard');
      return send(201, { token, artist: artist('amber-orchard'), claimUrl: `${origin}/claim/${'c'.repeat(64)}` });
    }
    const token = (request.headers.authorization ?? '').replace(/^Bearer /, '');
    const handle = tokens.get(token);
    // A public read: a sent key must be valid; canEdit says whether it owns the collection.
    if (request.method === 'GET' && url === '/api/v1/collections/01JCOLLECTION0000000000001' && owner) {
      if (token && !handle) return send(401, { message: 'Your API key is invalid or expired.' });
      const last = [...releases.values()].at(-1).payload;
      return send(200, { data: { id: '01JCOLLECTION0000000000001', title: last.collection.title, description: '', visibility: last.collection.visibility, artist: artist(owner), url: `${origin}/@${owner}/collections/x`, shortUrl: `${origin}/c/01JCOLLECTION0000000000001`, canEdit: handle === owner, tracks: last.tracks.map((t, i) => ({ id: `01JTRACK${String(i).padStart(18, '0')}`, localId: t.localId, title: t.score.title, status: 'ready', visibility: t.visibility, access: t.access, url: 'u', shortUrl: 's' })) } });
    }
    if (!handle) return send(401, { message: 'Unauthenticated.' });
    const resource = (id, payload, status) => ({
      id, status, statusUrl: `${origin}/api/v1/releases/${id}`,
      items: payload.tracks.map((t, i) => ({ trackId: `01JTRACK${String(i).padStart(18, '0')}`, versionId: i + 1, status, revision: t.clientRevision, error: null })),
      collection: { id: '01JCOLLECTION0000000000001', title: payload.collection.title, description: payload.collection.description, visibility: payload.collection.visibility, artist: artist(handle), url: `${origin}/@${handle}/collections/x`, shortUrl: `${origin}/c/01JCOLLECTION0000000000001`, tracks: payload.tracks.map((t, i) => ({ id: `01JTRACK${String(i).padStart(18, '0')}`, localId: t.localId, title: t.score.title, status, visibility: t.visibility, access: t.access, url: `${origin}/@${handle}/${t.localId}`, shortUrl: `${origin}/t/01JTRACK${String(i).padStart(18, '0')}` })) },
    });
    if (request.method === 'POST' && url === '/api/v1/releases') {
      const payload = JSON.parse(body);
      if (!payload.rightsAccepted) return send(422, { message: 'The rights accepted field must be accepted.', errors: { rightsAccepted: ['The rights accepted field must be accepted.'] } });
      const id = `01JRELEASE${String(releases.size + 1).padStart(16, '0')}`;
      releases.set(id, { payload, polls: 0 });
      owner ??= handle;
      return send(202, { ...resource(id, payload, 'queued'), claimUrl: `${origin}/claim/${'d'.repeat(64)}` });
    }
    const release = /^\/api\/v1\/releases\/(\w{26})$/.exec(url);
    if (request.method === 'GET' && release && releases.has(release[1])) {
      const entry = releases.get(release[1]);
      entry.polls++;
      return send(200, resource(release[1], entry.payload, entry.polls > 1 ? 'ready' : 'rendering'));
    }
    if (request.method === 'DELETE' && url === '/api/v1/auth/token') { tokens.delete(token); return send(200, { revoked: true }); }
    if (request.method === 'GET' && url === '/api/v1/me') return send(200, { artist: artist(handle), collections: [] });
    return send(404, { message: `The route ${url} could not be found.` });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, seen, tokens, close: () => new Promise(resolve => server.close(resolve)) };
}

async function run(command, options, env) {
  const out = [], err = [];
  const code = await runNetworkCommand(command, { positional: options.positional ?? [], options, raw: [], env, print: value => out.push(value), log: line => err.push(line) });
  return { code, json: out[0], text: JSON.stringify(out) + err.join('\n') };
}

test('the real soundroo-cloud is fetched, verified and shares a library', { skip, timeout: 600_000 }, async () => {
  const binary = buildBinary();
  const service = await fakeService(binary);
  const other = await fakeService(binary);
  const home = tempDir('soundroo-home-');
  const config = path.join(home, 'soundroo-cloud', 'config.yaml');
  const env = { ...process.env, HOME: home, SOUNDROO_CACHE: path.join(home, 'cache'), SOUNDROO_CLOUD_CONFIG: config, SOUNDROO_URL: service.origin };
  delete env.SOUNDROO_CLOUD_BIN;
  delete env.SOUNDROO_TOKEN;
  const directory = await makeLibrary();
  try {
    // A dry run downloads nothing and writes nothing.
    const preview = await run('share', { library: directory, 'dry-run': true, json: true }, env);
    assert.equal(preview.code, 0);
    assert.deepEqual(service.seen, []);
    assert.ok(!fs.existsSync(path.join(home, 'cache')) && !fs.existsSync(path.dirname(config)));

    const shared = await run('share', { library: directory, 'rights-accepted': true, json: true, artist: 'Amber Orchard' }, env);
    assert.equal(shared.code, 0, shared.text);
    assert.equal(shared.json.status, 'ready');
    assert.equal(shared.json.claimUrl, `${service.origin}/claim/${'d'.repeat(64)}`);
    assert.equal(shared.json.credential.created, true);
    assert.deepEqual(service.seen.slice(0, 4).map(r => `${r.method} ${r.url}`), ['GET /downloads/cli/manifest.json', 'GET /downloads/cli/0.1.0/soundroo-cloud', 'POST /api/v1/guest-keys', 'POST /api/v1/releases']);
    const [guest, publish] = [service.seen[2], service.seen[3]];
    assert.equal(guest.auth, '', 'guest creation must not send a key');
    assert.equal(publish.key, shared.json.idempotencyKey);
    const key = publish.auth.replace('Bearer ', '');
    assert.ok(service.tokens.has(key));
    // The exact canonical release reached the service.
    assert.equal(crypto.createHash('sha256').update(publish.body).digest('hex'), shared.json.payloadSha256);
    assert.equal(JSON.parse(publish.body).libraryUid, readSharing(directory).libraryUid);
    // Keys stay in soundroo-cloud's owner-only file, never in output or the library.
    const credentials = JSON.parse(fs.readFileSync(path.join(path.dirname(config), 'credentials.json'), 'utf8'));
    assert.equal(credentials.entries[service.origin].token, key);
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(path.dirname(config), 'credentials.json')).mode & 0o777, 0o600);
    assert.ok(!shared.text.includes(key));
    assert.ok(!fs.readFileSync(path.join(directory, 'sharing.json'), 'utf8').includes(key));

    // Sharing again first checks with the service that this key owns the collection.
    const update = await run('share', { library: directory, 'rights-accepted': true, json: true, force: true }, env);
    assert.equal(update.code, 0, update.text);
    const check = service.seen.find(r => r.url === '/api/v1/collections/01JCOLLECTION0000000000001');
    assert.equal(check?.auth, publish.auth, 'the update did not ask about its own collection');
    assert.equal(service.seen.filter(r => r.url === '/api/v1/releases').length, 2);

    // Another service gets its own guest key; neither key crosses over.
    const elsewhere = await run('share', { library: directory, 'rights-accepted': true, json: true, service: other.origin }, env);
    assert.equal(elsewhere.code, 0, elsewhere.text);
    const otherKey = other.seen.find(r => r.url === '/api/v1/releases').auth;
    assert.notEqual(otherKey, publish.auth);
    assert.ok(!other.seen.some(r => r.auth === publish.auth));
    assert.ok(!service.seen.some(r => r.auth === otherKey));

    const me = await run('whoami', { json: true }, env);
    assert.equal(me.code, 0, me.text);
    assert.equal(me.json.artist.handle, 'amber-orchard');

    // logout revokes this service's key and removes it; the other stays.
    const out = await run('logout', { json: true, confirm: true }, env);
    assert.equal(out.code, 0, out.text);
    assert.equal(out.json.revoked, true);
    assert.ok(!service.tokens.has(key));
    const after = JSON.parse(fs.readFileSync(path.join(path.dirname(config), 'credentials.json'), 'utf8'));
    assert.deepEqual(Object.keys(after.entries), [other.origin]);
    const unauthorized = await run('whoami', { json: true }, env);
    assert.equal(unauthorized.code, 3);
    assert.equal(unauthorized.json.code, 'auth_required');
    // The library still belongs to that guest page: without its key, sharing
    // stops and points to the claim link instead of starting a new guest.
    const seen = service.seen.length;
    const orphan = await run('share', { library: directory, 'rights-accepted': true, json: true, force: true }, env);
    assert.equal(orphan.code, 3, orphan.text);
    assert.equal(orphan.json.code, 'key_missing');
    assert.deepEqual(service.seen.slice(seen).filter(r => r.url.startsWith('/api/')), [], 'a share without the key reached the API');
  } finally {
    await service.close();
    await other.close();
  }
});
