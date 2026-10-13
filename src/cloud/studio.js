// The studio's Share dialog, server side. The browser never sees a key: this
// process runs soundroo-cloud, which keeps keys in its owner-only config. The
// studio contacts the service only when the listener presses Share or Sign
// in; opening the dialog reads the library and nothing else.
//
// GET /api/share answers every page load, so it stays cheap: whether sharing
// is available, the page's token and what sharing.json remembers. The track
// survey (validating and fingerprinting every score) runs only when the
// dialog opens, behind the token, in account().
import crypto from 'node:crypto';
import { libraryPath } from '../project.js';
import { surveyLibrary, collectionSummary, VISIBILITIES, ACCESSES, UPLOADS, STAYS_LOCAL } from './payload.js';
import { shareLibrary, shareStatus, serviceOrigin, connect } from './share.js';
import { runCloud, cloudResult } from './runner.js';
import { ShareError, asShareError } from './errors.js';

const RUNNING = new Set(['preparing', 'download', 'uploading', 'rendering']);

export function createShareService(directory, { service, env = process.env } = {}) {
  directory = libraryPath(directory);
  const token = crypto.randomBytes(24).toString('base64url');
  const controller = new AbortController();
  let origin = null, originError = null;
  try { origin = serviceOrigin(service, env); } catch (error) { originError = error; }
  let job = null, login = null;

  const requireOrigin = () => { if (!origin) throw originError; return origin; };
  const publicJob = value => value && { id: value.id, status: value.status, stage: value.stage, progress: value.progress, startedAt: value.startedAt, finishedAt: value.finishedAt ?? null, result: value.result ?? null, error: value.error ?? null };

  const formerGuest = former => (former?.claimUrl ? { artist: former.artist ?? null, claimUrl: former.claimUrl } : null);

  // What soundroo-cloud stores for this service, read locally when it is
  // already installed. formerGuest is a guest page kept when an account was
  // connected before claiming it; its claim link is the way to bring that
  // music along.
  async function keyStatus() {
    const connected = await connect(requireOrigin(), { env, download: false }).catch(() => null);
    if (!connected) return { tool: 'not-installed', key: null };
    try {
      const status = await connected.cloud(['auth', 'status']);
      const key = status.key ?? {};
      return { tool: 'installed', key: key.present ? { kind: key.kind ?? 'unknown', source: key.source, artist: key.artist ?? null, claimed: Boolean(key.claimed), claimUrl: key.claimUrl ?? null, formerGuest: formerGuest(key.formerGuest) } : null, pendingLogin: status.pendingLogin ?? null };
    } catch (error) {
      return { tool: 'installed', key: null, error: asShareError(error).message };
    }
  }

  // The dialog's local reads, when it opens: every track's readiness and the
  // key a share would use. Nothing is sent to the service.
  async function account() {
    const survey = surveyLibrary(directory);
    return { ...(await keyStatus()), collection: survey.collection, tracks: survey.tracks };
  }

  async function status() {
    if (!origin) return { available: false, reason: originError.message };
    const shared = await shareStatus(directory, { service: origin, env });
    // The open status names a running share; its links and claim link come
    // from the token-protected job endpoint.
    const running = job && { id: job.id, status: job.status, stage: job.stage, progress: job.progress };
    return { available: true, service: origin, token, collection: collectionSummary(directory), shared, uploads: UPLOADS, staysLocal: STAYS_LOCAL, choices: { visibility: VISIBILITIES, access: ACCESSES }, job: running, login: login && { status: login.status } };
  }

  function options(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ShareError('Send the share choices as a JSON object.', { code: 'invalid_request' });
    const tracks = body.tracks;
    if (tracks !== undefined && (!Array.isArray(tracks) || tracks.some(id => typeof id !== 'string') || tracks.length > 30)) throw new ShareError('Choose up to 30 tracks.', { code: 'invalid_request' });
    for (const [key, allowed] of [['visibility', VISIBILITIES], ['access', ACCESSES]]) if (body[key] !== undefined && !allowed.includes(body[key])) throw new ShareError(`Choose a valid ${key}.`, { code: 'invalid_option' });
    if (body.artist !== undefined && (typeof body.artist !== 'string' || body.artist.length > 80)) throw new ShareError('Keep the artist name under 80 characters.', { code: 'invalid_option' });
    return { tracks: tracks?.length ? tracks : undefined, visibility: body.visibility, access: body.access, artist: body.artist?.trim() || undefined };
  }

  async function preview(body) {
    return shareLibrary(directory, { ...options(body), service: requireOrigin(), env, dryRun: true, rightsAccepted: body?.rightsAccepted === true });
  }

  function publish(body) {
    const choices = options(body);
    // The listener's own checkbox, sent with this request; never assumed.
    if (body.rightsAccepted !== true) throw new ShareError('Confirm that you have the right to share this music.', { code: 'rights_not_accepted' });
    if (job && RUNNING.has(job.status)) throw new ShareError('A share is already running.', { code: 'busy', exitCode: 1, status: 409 });
    const current = { id: crypto.randomBytes(8).toString('hex'), status: 'preparing', stage: 'preparing', progress: null, startedAt: new Date().toISOString() };
    job = current;
    shareLibrary(directory, {
      ...choices, service: requireOrigin(), env, rightsAccepted: true, wait: true, signal: controller.signal,
      onProgress: event => {
        current.stage = event.stage;
        if (RUNNING.has(event.stage)) current.status = event.stage;
        if (event.stage === 'rendering') current.progress = { ready: event.ready, failed: event.failed, total: event.total };
        if (event.stage === 'download') current.progress = { version: event.version, size: event.size };
      },
    }).then(result => {
      Object.assign(current, { status: result.status === 'failed' ? 'failed' : 'done', result, finishedAt: new Date().toISOString() });
    }, error => {
      Object.assign(current, { status: 'error', error: asShareError(error).toJSON(), finishedAt: new Date().toISOString() });
    });
    return publicJob(current);
  }

  function jobById(id) {
    if (!job || job.id !== id) throw new ShareError('That share is not running in this studio.', { code: 'not_found', exitCode: 5, status: 404 });
    return publicJob(job);
  }

  // Optional device login: the service shows a link and code; the listener
  // approves it in their own browser tab. No browser is opened from here.
  async function startLogin() {
    if (login?.status === 'waiting') return { status: 'waiting', ...login.device };
    const { binary, cloud } = await connect(requireOrigin(), { env });
    const device = await cloud(['login', '--start', '--force']);
    login = { status: 'waiting', device: { userCode: device.userCode, verificationUri: device.verificationUri, verificationUriComplete: device.verificationUriComplete ?? null, expiresAt: device.expiresAt } };
    const current = login;
    runCloud(binary.path, ['--service', origin, '--json', '--no-prompt', 'login', '--wait', '--force'], { env, timeoutMs: 35 * 60_000, signal: controller.signal })
      .then(cloudResult)
      .then(result => Object.assign(current, { status: 'done', artist: result.artist ?? null, formerGuest: formerGuest(result.formerGuest) }), error => Object.assign(current, { status: 'error', error: asShareError(error).message }));
    return { status: 'waiting', ...login.device };
  }

  function loginStatus() {
    return login ? { status: login.status, ...(login.device ?? {}), artist: login.artist ?? null, formerGuest: login.formerGuest ?? null, error: login.error ?? null } : { status: 'none' };
  }

  return { token, status, account, preview, publish, job: jobById, startLogin, loginStatus, close: () => controller.abort() };
}
