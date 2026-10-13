import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from '../src/server.js';
import { updateService } from '../src/cloud/state.js';
import { makeLibrary, installStub, releaseAnswer, posix } from './fixtures/sharing.js';

const skip = !posix && 'the soundroo-cloud stand-in needs a POSIX shebang';

test('the studio shares only on an explicit, same-page request and never exposes keys', { skip }, async () => {
  const directory = await makeLibrary();
  const stub = installStub({
    'auth status': { service: 'https://soundroo.com', key: { present: true, source: 'file', masked: '****wxyz', kind: 'guest', artist: { handle: 'amber-orchard' }, claimUrl: 'https://soundroo.com/claim/secretclaimtoken' } },
    publish: releaseAnswer({ status: 'queued' }),
    'release show': releaseAnswer({ status: 'ready', claimUrl: null }),
  });
  const saved = { ...process.env };
  Object.assign(process.env, { SOUNDROO_CLOUD_BIN: stub.file, STUB_DIR: stub.dir, SOUNDROO_CACHE: stub.env.SOUNDROO_CACHE, SOUNDROO_URL: '' });
  let studio;
  try {
    studio = await startServer(directory, { renderMissing: false });
    const local = new URL(studio.url).origin;
    const call = (route, { method = 'GET', body, headers = {} } = {}) => fetch(studio.url + route, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

    // Every page load asks whether sharing is available: a cheap answer
    // without checking each track.
    const status = await (await call('/api/share')).json();
    assert.equal(status.available, true);
    assert.equal(status.service, 'https://soundroo.com');
    assert.match(status.token, /^[A-Za-z0-9_-]{32}$/);
    assert.equal(status.collection.title, 'Night Trains');
    assert.equal(status.tracks, undefined, 'the page-load check surveyed the tracks');
    assert.equal(status.shared.shared, false);
    assert.deepEqual(stub.calls(), [], 'the page-load check ran soundroo-cloud');
    const token = { 'x-soundroo-share': status.token };
    const page = { ...token, origin: local };

    // Everything else needs this page's token; changes also need its Origin.
    assert.equal((await call('/api/share/account')).status, 403);
    assert.equal((await call('/api/share/account', { headers: { 'x-soundroo-share': 'guess' } })).status, 403);
    assert.equal((await call('/api/share/account', { headers: { ...token, 'sec-fetch-site': 'cross-site' } })).status, 403);
    // Opening the dialog reads the library and the stored key, locally.
    const account = await (await call('/api/share/account', { headers: token })).json();
    assert.deepEqual(account.tracks.map(t => [t.localId, t.status]), [['night-train', 'ready'], ['city-lights', 'ready']]);
    assert.equal(account.key.claimUrl, 'https://soundroo.com/claim/secretclaimtoken');
    assert.equal(account.key.kind, 'guest');
    assert.ok(!JSON.stringify(account).includes('wxyz'), 'the masked key is not needed by the page');
    assert.deepEqual(stub.calls().map(c => c.command), ['version', 'auth status'], 'opening the dialog contacted the service');
    const publish = body => call('/api/share/publish', { method: 'POST', body, headers: page });
    assert.equal((await call('/api/share/publish', { method: 'POST', body: { rightsAccepted: true }, headers: token })).status, 403, 'missing Origin');
    assert.equal((await call('/api/share/publish', { method: 'POST', body: { rightsAccepted: true }, headers: { ...token, origin: 'http://evil.example' } })).status, 403);
    assert.equal((await call('/api/share/publish', { method: 'POST', body: { rightsAccepted: true }, headers: { origin: local } })).status, 403, 'missing token');
    const refused = await publish({ rightsAccepted: 'yes' });
    assert.equal(refused.status, 400);
    assert.equal((await refused.json()).code, 'rights_not_accepted');
    assert.equal((await publish({ rightsAccepted: true, visibility: 'everyone' })).status, 400);
    assert.equal((await fetch(studio.url + '/api/share/publish', { method: 'POST', headers: { ...page, 'content-type': 'text/plain' }, body: '{"rightsAccepted":true}' })).status, 400);
    assert.equal(stub.calls().filter(c => c.command === 'publish').length, 0);

    // A preview is a dry run.
    const preview = await (await call('/api/share/preview', { method: 'POST', body: { tracks: ['city-lights'] }, headers: page })).json();
    assert.equal(preview.dryRun, true);
    assert.deepEqual(preview.tracks.map(t => t.localId), ['city-lights']);
    assert.equal(stub.calls().filter(c => c.command === 'publish').length, 0);
    assert.ok(!fs.existsSync(path.join(directory, 'sharing.json')));

    // The listener's confirmation starts the share.
    const started = await publish({ rightsAccepted: true, tracks: ['night-train'], access: 'listen-only', visibility: 'public' });
    assert.equal(started.status, 202);
    let { job } = await started.json();
    assert.match(job.id, /^[a-f0-9]{16}$/);
    assert.equal((await publish({ rightsAccepted: true })).status, 409, 'a second share while one runs');
    for (let i = 0; i < 100 && !['done', 'failed', 'error'].includes(job.status); i++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      ({ job } = await (await call(`/api/share/jobs/${job.id}`, { headers: token })).json());
    }
    assert.equal(job.status, 'done', JSON.stringify(job.error));
    assert.equal(job.result.claimUrl, 'https://soundroo.com/claim/secretclaimtoken');
    assert.equal((await call(`/api/share/jobs/${job.id}`)).status, 403, 'job results need the token');
    const sent = JSON.parse(stub.calls().find(c => c.command === 'publish').input);
    assert.equal(sent.rightsAccepted, true);
    assert.deepEqual(sent.tracks.map(t => [t.localId, t.access, t.visibility]), [['night-train', 'listen-only', 'public']]);
    const after = await (await call('/api/share')).json();
    assert.equal(after.shared.shared, true);
    assert.ok(!JSON.stringify(after).includes('secretclaimtoken'), 'the claim link stays out of the open status');
  } finally {
    if (studio) await studio.close();
    for (const key of ['SOUNDROO_CLOUD_BIN', 'STUB_DIR', 'SOUNDROO_CACHE', 'SOUNDROO_URL']) if (key in saved) process.env[key] = saved[key]; else delete process.env[key];
  }
});

test('a studio update keeps choices made on the service and shows the way back to an earlier guest page', { skip }, async () => {
  const directory = await makeLibrary();
  const origin = 'https://soundroo.com';
  // Shared before as a guest page; since then made public, with one private,
  // listen-only track, on the website.
  updateService(directory, origin, s => ({ ...s, artist: { handle: 'amber-orchard' }, collection: { id: '01JCOLLECTION0000000000001', title: 'Night Trains', visibility: 'unlisted' }, tracks: { 'night-train': { access: 'open' }, 'city-lights': { access: 'open' } }, lastRelease: { id: '01JRELEASE0000000000000001', status: 'ready', payloadSha256: 'f'.repeat(64) } }));
  const onService = canEdit => ({ id: '01JCOLLECTION0000000000001', visibility: 'public', artist: '@amber-orchard', canEdit, tracks: [{ localId: 'night-train', visibility: 'private', access: 'listen-only' }, { localId: 'city-lights', visibility: 'unlisted', access: 'open' }] });
  // An account connected before the guest page was claimed.
  const formerGuest = { artist: { handle: 'amber-orchard', name: 'Amber Orchard' }, claimUrl: 'https://soundroo.com/claim/formerguest' };
  const accountKey = extra => ({ service: origin, key: { present: true, source: 'file', kind: 'account', artist: { handle: 'mara' }, ...extra } });
  const stub = installStub({ 'auth status': accountKey({ formerGuest }), 'collection show': onService(false), publish: releaseAnswer({ status: 'ready' }) });
  const saved = { ...process.env };
  Object.assign(process.env, { SOUNDROO_CLOUD_BIN: stub.file, STUB_DIR: stub.dir, SOUNDROO_CACHE: stub.env.SOUNDROO_CACHE, SOUNDROO_URL: '' });
  let studio;
  try {
    studio = await startServer(directory, { renderMissing: false });
    const status = await (await fetch(studio.url + '/api/share')).json();
    const headers = { 'x-soundroo-share': status.token, origin: new URL(studio.url).origin, 'content-type': 'application/json' };
    const account = await (await fetch(studio.url + '/api/share/account', { headers })).json();
    assert.deepEqual(account.key.formerGuest, formerGuest);
    const share = async body => {
      let { job } = await (await fetch(studio.url + '/api/share/publish', { method: 'POST', headers, body: JSON.stringify(body) })).json();
      for (let i = 0; i < 100 && !['done', 'failed', 'error'].includes(job.status); i++) {
        await new Promise(resolve => setTimeout(resolve, 25));
        ({ job } = await (await fetch(`${studio.url}/api/share/jobs/${job.id}`, { headers })).json());
      }
      return job;
    };
    // Unclaimed, the guest page's music cannot be updated from this account:
    // the job says why and carries the saved claim link.
    let job = await share({ rightsAccepted: true, tracks: ['night-train', 'city-lights'] });
    assert.equal(job.status, 'error');
    assert.equal(job.error.code, 'artist_mismatch');
    assert.equal(job.error.claimUrl, 'https://soundroo.com/claim/formerguest');
    assert.ok(!stub.calls().some(c => c.command === 'publish'));
    // Claimed: an untouched update sends no choices, so the service's stay.
    stub.set({ 'auth status': accountKey(), 'collection show': onService(true), publish: releaseAnswer({ status: 'ready' }) });
    job = await share({ rightsAccepted: true, tracks: ['night-train', 'city-lights'] });
    assert.equal(job.status, 'done', JSON.stringify(job.error));
    const sent = JSON.parse(stub.calls().find(c => c.command === 'publish').input);
    assert.equal(sent.collection.visibility, 'public');
    assert.deepEqual(sent.tracks.map(t => [t.localId, t.visibility, t.access]), [['night-train', 'private', 'listen-only'], ['city-lights', 'unlisted', 'open']]);
  } finally {
    if (studio) await studio.close();
    for (const key of ['SOUNDROO_CLOUD_BIN', 'STUB_DIR', 'SOUNDROO_CACHE', 'SOUNDROO_URL']) if (key in saved) process.env[key] = saved[key]; else delete process.env[key];
  }
});

test('a studio with an unusable service address still serves music', async () => {
  const directory = await makeLibrary();
  const saved = process.env.SOUNDROO_URL;
  process.env.SOUNDROO_URL = 'http://soundroo.example';
  let studio;
  try {
    studio = await startServer(directory, { renderMissing: false });
    const status = await (await fetch(studio.url + '/api/share')).json();
    assert.equal(status.available, false);
    assert.match(status.reason, /https/);
    assert.equal((await fetch(studio.url + '/api/library')).status, 200);
  } finally {
    if (studio) await studio.close();
    if (saved === undefined) delete process.env.SOUNDROO_URL; else process.env.SOUNDROO_URL = saved;
  }
});
