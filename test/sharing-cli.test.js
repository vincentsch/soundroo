import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { addTrack } from '../src/project.js';
import { runNetworkCommand } from '../src/cloud/cli.js';
import { shareLibrary } from '../src/cloud/share.js';
import { canonicalBytes } from '../src/cloud/payload.js';
import { readSharing, sharingPath, updateService } from '../src/cloud/state.js';
import * as engine from '../src/headless.js';
import { makeLibrary, markRendered, score, installStub, releaseAnswer, tempDir, snapshot, posix } from './fixtures/sharing.js';

const skip = !posix && 'the soundroo-cloud stand-in needs a POSIX shebang';
const origin = 'https://soundroo.com';
// The stored key the first share created, as soundroo-cloud reports it.
const guestKey = { service: origin, key: { present: true, source: 'file', kind: 'guest', artist: { handle: 'amber-orchard' }, claimUrl: 'https://soundroo.com/claim/again' } };

async function run(command, { positional = [], options = {}, env }) {
  const out = [], err = [];
  const code = await runNetworkCommand(command, { positional, options, raw: [], env, print: value => out.push(value), log: line => err.push(line) });
  return { code, out, err, json: out.length === 1 && typeof out[0] === 'object' ? out[0] : null };
}

test('share publishes through soundroo-cloud and remembers links, not secrets', { skip }, async () => {
  const directory = await makeLibrary();
  const stub = installStub({ publish: releaseAnswer({ status: 'queued' }), 'release show': [releaseAnswer({ status: 'rendering' }), releaseAnswer({ status: 'ready', claimUrl: null })] });
  const result = await shareLibrary(directory, { env: stub.env, rightsAccepted: true, intervalMs: 1 });
  assert.equal(result.status, 'ready');
  assert.equal(result.claimUrl, 'https://soundroo.com/claim/secretclaimtoken');
  assert.equal(result.collection.shortUrl, 'https://soundroo.com/c/01JCOLLECTION0000000000001');
  assert.deepEqual(result.tracks.map(t => [t.localId, t.status]), [['night-train', 'ready'], ['city-lights', 'ready']]);
  const calls = stub.calls();
  assert.deepEqual(calls.map(c => c.command), ['version', 'publish', 'release show', 'release show']);
  const publish = calls[1];
  const keyIndex = publish.argv.indexOf('--idempotency-key');
  assert.deepEqual(publish.argv.slice(0, 9), ['--service', origin, '--json', '--no-prompt', 'publish', '--payload', '-', '--rights-accepted', '--idempotency-key']);
  assert.equal(publish.argv[keyIndex + 1], result.idempotencyKey);
  // The bytes on stdin are the canonical release with the stored library id.
  const sent = JSON.parse(publish.input);
  const state = readSharing(directory);
  assert.equal(sent.libraryUid, state.libraryUid);
  assert.equal(publish.input, canonicalBytes(sent).toString('utf8'));
  assert.equal(sent.rightsAccepted, true);
  const stored = state.services[origin];
  assert.equal(stored.collection.id, '01JCOLLECTION0000000000001');
  assert.equal(stored.tracks['night-train'].shortUrl, 'https://soundroo.com/t/01JTRACK000000000000000000');
  assert.equal(stored.lastRelease.status, 'ready');
  assert.equal(stored.pending, undefined);
  const text = fs.readFileSync(sharingPath(directory), 'utf8');
  assert.ok(!text.includes('claim') && !/token/i.test(text), 'sharing.json holds a secret');
});

test('a failed request is retried with the same key; changed music gets a new key', { skip }, async () => {
  const directory = await makeLibrary();
  const stub = installStub({ publish: [{ fail: { exit: 2, code: 'network', error: 'Could not reach https://soundroo.com: connection reset.' } }, releaseAnswer({ status: 'ready' })] });
  const failed = await run('share', { options: { library: directory, 'rights-accepted': true, json: true }, env: stub.env });
  assert.equal(failed.code, 2);
  assert.deepEqual(failed.json, { error: 'Could not reach https://soundroo.com: connection reset.', code: 'network', exitCode: 2 });
  const pending = readSharing(directory).services[origin].pending;
  assert.match(pending.idempotencyKey, /^sr1-[a-f0-9]{24}-[a-f0-9]{12}$/);
  const keyOf = call => call.argv[call.argv.indexOf('--idempotency-key') + 1];
  const retried = await run('share', { options: { library: directory, 'rights-accepted': true, json: true, 'no-wait': true }, env: stub.env });
  assert.equal(retried.code, 0);
  const publishes = stub.calls().filter(c => c.command === 'publish');
  assert.equal(keyOf(publishes[0]), keyOf(publishes[1]));
  assert.equal(keyOf(publishes[1]), pending.idempotencyKey);
  assert.equal(readSharing(directory).services[origin].pending, undefined);
  // A new version of the music is a new request.
  await addTrack(directory, score('night-train', { title: 'night train', line: 'E2/.5 E2 B2/.5 A2 -/1' }), { replace: true });
  markRendered(directory, 'night-train');
  stub.set({ publish: releaseAnswer({ id: '01JRELEASE0000000000000002', status: 'ready' }), 'auth status': guestKey, 'collection show': { id: '01JCOLLECTION0000000000001', visibility: 'unlisted', artist: '@amber-orchard', canEdit: true, tracks: [{ localId: 'night-train', visibility: 'unlisted', access: 'listen-only' }] } });
  const changed = await run('share', { options: { library: directory, 'rights-accepted': true, json: true }, env: stub.env });
  assert.equal(changed.code, 0);
  const latest = stub.calls().filter(c => c.command === 'publish').at(-1);
  assert.notEqual(keyOf(latest), pending.idempotencyKey);
  // The access chosen on the service is kept.
  assert.equal(JSON.parse(latest.input).tracks[0].access, 'listen-only');
});

test('sharing unchanged music again sends nothing new', { skip }, async () => {
  const directory = await makeLibrary();
  const ready = releaseAnswer({ status: 'ready' });
  const stub = installStub({ publish: ready, 'release show': ready, 'collection show': { id: ready.collection.id, visibility: 'unlisted', artist: '@amber-orchard', canEdit: true, tracks: ready.tracks }, 'auth status': guestKey });
  assert.equal((await run('share', { options: { library: directory, 'rights-accepted': true, json: true }, env: stub.env })).code, 0);
  stub.reset();
  const again = await run('share', { options: { library: directory, 'rights-accepted': true, json: true }, env: stub.env });
  assert.equal(again.code, 0);
  assert.equal(again.json.unchanged, true);
  assert.equal(again.json.claimUrl, 'https://soundroo.com/claim/again');
  // The protocol check already ran in this process; no publish happens.
  assert.deepEqual(stub.calls().map(c => c.command), ['auth status', 'collection show', 'release show']);
  const forced = await run('share', { options: { library: directory, 'rights-accepted': true, json: true, force: true, 'no-wait': true }, env: stub.env });
  assert.equal(forced.code, 0);
  assert.equal(stub.calls().filter(c => c.command === 'publish').length, 1);
});

test('service errors keep their exit codes and stable JSON', { skip }, async () => {
  const directory = await makeLibrary();
  for (const [exit, code] of [[3, 'auth_invalid'], [4, 'forbidden'], [1, 'validation_failed'], [6, 'rate_limited']]) {
    const stub = installStub({ publish: { fail: { exit, code, error: `failure ${code}`, issues: code === 'validation_failed' ? [{ path: 'tracks.0.score', message: 'Too long.' }] : undefined } } });
    const result = await run('share', { options: { library: directory, 'rights-accepted': true, json: true }, env: stub.env });
    assert.equal(result.code, exit, code);
    assert.equal(result.json.code, code);
    assert.equal(result.json.exitCode, exit);
    if (code === 'validation_failed') assert.deepEqual(result.json.issues, [{ path: 'tracks.0.score', message: 'Too long.' }]);
    const human = await run('share', { options: { library: directory, 'rights-accepted': true }, env: stub.env });
    assert.equal(human.code, exit);
    assert.ok(human.err.includes(`Soundroo: failure ${code}`), human.err.join('\n'));
  }
  const missingRights = await run('share', { options: { library: directory, json: true }, env: installStub({}).env });
  assert.equal(missingRights.code, 1);
  assert.equal(missingRights.json.code, 'rights_not_accepted');
  const badService = await run('share', { options: { library: directory, json: true, service: 'http://soundroo.com', 'rights-accepted': true }, env: installStub({}).env });
  assert.equal(badService.code, 1);
  assert.equal(badService.json.code, 'invalid_service');
});

test('an update stops before publishing when this computer cannot update the shared collection', { skip }, async () => {
  const collection = { id: '01JCOLLECTION0000000000001', title: 'Night Trains', visibility: 'unlisted', artist: '@amber-orchard', tracks: [{ localId: 'night-train', visibility: 'unlisted', access: 'open' }] };
  async function sharedLibrary() {
    const directory = await makeLibrary();
    assert.equal((await run('share', { options: { library: directory, 'rights-accepted': true, json: true }, env: installStub({ publish: releaseAnswer({ status: 'ready' }) }).env })).code, 0);
    // The music changed since, so a real update would publish.
    updateService(directory, origin, s => ({ ...s, lastRelease: { ...s.lastRelease, payloadSha256: '0'.repeat(64) } }));
    return directory;
  }
  const share = (directory, stub, extra = {}) => run('share', { options: { library: directory, 'rights-accepted': true, json: true, ...extra }, env: stub.env });
  const published = stub => stub.calls().some(c => c.command === 'publish');

  // After logout: no key. A new guest artist would be refused as another
  // artist's music, so nothing is sent and the way back is the claim link.
  const directory = await sharedLibrary();
  let stub = installStub({ 'auth status': { service: origin, key: { present: false, source: 'none' } }, publish: releaseAnswer({ status: 'ready' }) });
  let result = await share(directory, stub);
  assert.equal(result.code, 3);
  assert.equal(result.json.code, 'key_missing');
  assert.match(result.json.error, /shared on soundroo\.com as @amber-orchard/);
  assert.match(result.json.hint, /claim link while signed in/);
  assert.match(result.json.hint, /node bin\/soundroo\.js login/);
  assert.doesNotMatch(result.json.hint, /logout --confirm|new guest/);
  assert.deepEqual(stub.calls().map(c => c.command), ['version', 'auth status'], 'only local reads before stopping');
  const human = await run('share', { options: { library: directory, 'rights-accepted': true }, env: stub.env });
  assert.equal(human.code, 3);
  assert.ok(human.err.some(line => line.includes('this computer has no key for it')), human.err.join('\n'));

  // An account connected before claiming the guest page: its saved claim link is the way back.
  stub = installStub({
    'auth status': { service: origin, key: { present: true, source: 'file', kind: 'account', artist: { handle: 'mara' }, formerGuest: { artist: { handle: 'amber-orchard' }, claimUrl: 'https://soundroo.com/claim/formerguest' } } },
    'collection show': { ...collection, canEdit: false }, publish: releaseAnswer({ status: 'ready' }),
  });
  result = await share(directory, stub, { force: true });
  assert.equal(result.code, 4);
  assert.equal(result.json.code, 'artist_mismatch');
  assert.equal(result.json.claimUrl, 'https://soundroo.com/claim/formerguest');
  assert.match(result.json.hint, /before connecting @mara/);
  assert.ok(!published(stub));
  const told = await run('share', { options: { library: directory, 'rights-accepted': true }, env: stub.env });
  assert.ok(told.err.join('\n').includes('Claim link (private; whoever opens it can claim the page):\n  https://soundroo.com/claim/formerguest'), told.err.join('\n'));

  // Once claimed, the account owns the collection, whatever its handle: the update goes ahead.
  stub.set({ 'auth status': { service: origin, key: { present: true, source: 'file', kind: 'account', artist: { handle: 'mara' } } }, 'collection show': { ...collection, artist: '@mara', canEdit: true }, publish: releaseAnswer({ status: 'ready' }) });
  result = await share(directory, stub);
  assert.equal(result.code, 0, JSON.stringify(result.json));
  assert.ok(published(stub));

  // A private collection another artist owns is not visible at all.
  const other = await sharedLibrary();
  stub = installStub({ 'auth status': { service: origin, key: { present: true, source: 'file', kind: 'guest', artist: { handle: 'velvet-echo' } } }, 'collection show': { fail: { exit: 5, code: 'not_found', error: 'Soundroo could not find that, or it is not shared with you.' } }, publish: releaseAnswer({ status: 'ready' }) });
  result = await share(other, stub);
  assert.equal(result.code, 4);
  assert.equal(result.json.code, 'artist_mismatch');
  assert.equal(result.json.claimUrl, undefined);
  assert.ok(!published(stub));
  // The same artist's collection deleted on the service is shared anew.
  stub.set({ 'auth status': guestKey, 'collection show': { fail: { exit: 5, code: 'not_found', error: 'Soundroo could not find that, or it is not shared with you.' } }, publish: releaseAnswer({ status: 'ready' }) });
  assert.equal((await share(other, stub)).code, 0);
  assert.ok(published(stub));

  // A stored key the service no longer accepts points to the same way back.
  stub = installStub({ 'auth status': guestKey, 'collection show': { fail: { exit: 3, code: 'auth_invalid', error: 'Your API key is invalid or expired.' } }, publish: releaseAnswer({ status: 'ready' }) });
  result = await share(other, stub);
  assert.equal(result.code, 3);
  assert.equal(result.json.code, 'auth_invalid');
  assert.equal(result.json.claimUrl, 'https://soundroo.com/claim/again');
  assert.match(result.json.hint, /claim link below while signed in/);
  assert.doesNotMatch(result.json.hint, /logout --confirm|new guest/);
  assert.ok(!published(stub));
});

test('import, whoami and status refresh preview offline under --dry-run', { skip }, async () => {
  const directory = await makeLibrary({ tracks: ['night-train'] });
  updateService(directory, origin, s => ({ ...s, collection: { id: '01JCOLLECTION0000000000001' }, lastRelease: { id: '01JRELEASE0000000000000001', status: 'rendering' } }));
  const shared = score('open-groove', { title: 'Open Groove' });
  const stub = installStub({
    score: { score: shared, mix: {}, engine: { version: engine.engineInfo().version, hash: engine.engineHash() }, revision: engine.revision(shared, { mix: {} }), license: 'CC-BY-4.0' },
    me: { service: origin, artist: { handle: 'amber-orchard' }, collections: [] },
    'release show': releaseAnswer({ status: 'ready' }),
  });
  const before = snapshot(directory);
  const imported = await run('import', { positional: ['https://soundroo.com/t/01JTRACK000000000000000009'], options: { library: directory, 'dry-run': true, json: true }, env: stub.env });
  assert.equal(imported.code, 0);
  assert.deepEqual([imported.json.dryRun, imported.json.remixOf, imported.json.request.path, imported.json.libraryExists, imported.json.changes], [true, '01JTRACK000000000000000009', '/api/v1/tracks/01JTRACK000000000000000009/score', true, 'none']);
  const fresh = path.join(tempDir(), 'not-yet');
  const into = await run('import', { positional: ['01JTRACK000000000000000009'], options: { library: fresh, 'dry-run': true }, env: stub.env });
  assert.equal(into.code, 0);
  assert.match(into.out[0], /^DRY RUN: would download the score of https:\/\/soundroo\.com\/t\/01JTRACK000000000000000009 and add it to .* \(a new library\)/);
  assert.ok(!fs.existsSync(fresh), 'a dry run created the library');
  // An invalid link is still refused.
  assert.equal((await run('import', { positional: ['https://other.example/t/01JTRACK000000000000000009'], options: { library: directory, 'dry-run': true, json: true }, env: stub.env })).json.code, 'other_service');
  const me = await run('whoami', { options: { 'dry-run': true, json: true }, env: stub.env });
  assert.deepEqual(me.json, { dryRun: true, service: origin, request: { method: 'GET', path: '/api/v1/me' }, changes: 'none' });
  const status = await run('share', { positional: ['status'], options: { library: directory, refresh: true, 'dry-run': true, json: true }, env: stub.env });
  assert.equal(status.code, 0);
  assert.deepEqual([status.json.dryRun, status.json.request.path, status.json.changes, status.json.lastRelease.status], [true, '/api/v1/releases/01JRELEASE0000000000000001', 'none', 'rendering']);
  const text = await run('share', { positional: ['status'], options: { library: directory, refresh: true, 'dry-run': true }, env: stub.env });
  assert.match(text.out[0], /DRY RUN: --refresh would ask https:\/\/soundroo\.com/);
  assert.deepEqual(stub.calls(), [], 'a dry run ran soundroo-cloud');
  assert.deepEqual(snapshot(directory), before, 'a dry run changed the library');
});

test('dry runs of account commands work without installing anything', async () => {
  const env = { ...process.env, SOUNDROO_CACHE: tempDir(), SOUNDROO_CLOUD_BIN: '', SOUNDROO_URL: '' };
  delete env.SOUNDROO_CLOUD_BIN;
  for (const command of ['logout', 'login']) {
    const result = await run(command, { options: { 'dry-run': true, json: true }, env });
    assert.equal(result.code, 0, command);
    assert.equal(result.json.dryRun, true);
    assert.equal(result.json.changes, 'none');
  }
  assert.deepEqual(fs.readdirSync(env.SOUNDROO_CACHE), []);
});

test('whoami and status read through soundroo-cloud', { skip }, async () => {
  const directory = await makeLibrary();
  const stub = installStub({ me: { service: origin, artist: { handle: 'amber-orchard', name: 'Amber Orchard', url: 'https://soundroo.com/@amber-orchard' }, collections: [] } });
  const me = await run('whoami', { options: { json: true }, env: stub.env });
  assert.equal(me.code, 0);
  assert.equal(me.json.artist.handle, 'amber-orchard');
  assert.deepEqual(stub.calls().at(-1).argv, ['--no-prompt', '--service', origin, '--json', 'me']);
  const status = await run('share', { positional: ['status'], options: { library: directory, json: true }, env: stub.env });
  assert.equal(status.code, 0);
  assert.equal(status.json.shared, false);
  assert.ok(!fs.existsSync(path.join(directory, 'sharing.json')));
});
