// Network commands of bin/soundroo.js. They load only when someone types one,
// so start, render and composing never reach this code. Every network request
// goes through soundroo-cloud; this module prepares music and prints results.
import { libraryPath } from '../project.js';
import { shareLibrary, shareStatus, serviceOrigin, connect } from './share.js';
import { importTrack } from './importer.js';
import { runCloud, cloudResult } from './runner.js';
import { ShareError, asShareError } from './errors.js';
import { MANIFEST_PATH } from './binary.js';

export const NETWORK_COMMANDS = new Set(['share', 'publish', 'login', 'logout', 'whoami', 'claim-link', 'import', 'cloud']);
export const NETWORK_FLAGS = ['dry-run', 'rights-accepted', 'no-wait', 'force', 'confirm', 'start', 'wait', 'local-only', 'refresh', 'no-guest'];

const time = seconds => (Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}` : '');
const table = rows => {
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map(r => String(r[i] ?? '').length))) ?? [];
  return rows.map(r => '  ' + r.map((cell, i) => (i === r.length - 1 ? String(cell ?? '') : String(cell ?? '').padEnd(widths[i]))).join('  ')).join('\n');
};

export function renderShare(result) {
  if (result.dryRun) {
    const lines = [`DRY RUN: would share ${result.tracks.length} track${result.tracks.length === 1 ? '' : 's'} from “${result.collection.title}” to ${result.service}`];
    lines.push(table(result.tracks.map(t => [t.title, time(t.duration), t.access, t.visibility ?? result.collection.visibility ?? 'as on the service', t.speech.length ? `${t.speech.length} spoken phrase${t.speech.length === 1 ? '' : 's'}` : ''])));
    for (const s of result.skipped) lines.push(`  Not shared: ${s.title} (${s.message})`);
    lines.push(`Uploads: ${result.uploads}`, `Stays here: ${result.staysLocal}`);
    lines.push(`Library id: ${result.libraryUid.isNew ? 'created on the first real share' : result.libraryUid.value}`);
    lines.push(`soundroo-cloud: ${result.tool.status}`);
    lines.push(result.rightsAccepted ? 'Rights: accepted' : 'Rights: not accepted yet. Sharing needs --rights-accepted once the person sharing the music agrees.');
    lines.push('No changes were made: nothing was downloaded, sent or saved.');
    return lines.join('\n');
  }
  const lines = [];
  if (result.unchanged) lines.push(`Nothing changed since the last share of “${result.collection?.title}”.`);
  else lines.push(`Shared “${result.collection?.title}” on ${result.service} (${result.status}).`);
  if (result.collection?.url) lines.push(`Collection: ${result.collection.url}`);
  if (result.collection?.shortUrl) lines.push(`Short link: ${result.collection.shortUrl}`);
  if (result.tracks?.length) lines.push(table(result.tracks.map(t => [t.title ?? t.localId, t.status ?? '', t.shortUrl ?? t.url ?? '', t.error ?? ''])));
  for (const s of result.skipped ?? []) lines.push(`Not shared: ${s.title} (${s.message})`);
  if (result.claimUrl) lines.push('Claim your artist page to keep this music. Keep this link private; whoever opens it can claim the page:', `  ${result.claimUrl}`);
  if (result.status === 'queued' || result.status === 'rendering') lines.push('The links work now; the service renders the audio from your scores and each track plays once it is ready.');
  if (result.status === 'failed') lines.push('Some tracks did not render on the service. Check their scores, render them here, then share again.');
  return lines.join('\n');
}

function renderStatus(result) {
  const lines = [];
  if (!result.shared) lines.push(`This library has not been shared on ${result.service} yet. Preview a share with: node bin/soundroo.js share --library ${result.library} --dry-run`);
  else {
    lines.push(`“${result.collection.title}” on ${result.service}`, `Collection: ${result.collection.url}`);
    if (result.lastRelease) lines.push(`Last share: ${result.lastRelease.status}${result.lastRelease.createdAt ? ` (${result.lastRelease.createdAt})` : ''}`);
    lines.push(table(result.tracks.map(t => [t.localId, t.status ?? '', t.access ?? '', t.shortUrl ?? ''])));
    if (result.pending) lines.push('An earlier share did not finish; sharing again retries it safely.');
  }
  if (result.dryRun) lines.push(result.request ? `DRY RUN: --refresh would ask ${result.service} for the rendering status of the last share.` : 'DRY RUN: there is no earlier share to refresh.', 'No changes were made.');
  return lines.join('\n');
}

function progressLogger(log) {
  let last = '';
  return event => {
    let line = '';
    if (event.stage === 'preparing') line = `Preparing ${event.tracks} track${event.tracks === 1 ? '' : 's'}…`;
    else if (event.stage === 'download') line = `Downloading soundroo-cloud ${event.version} (${(event.size / 1e6).toFixed(1)} MB) from the service…`;
    else if (event.stage === 'uploading') line = 'Sending scores and settings…';
    else if (event.stage === 'rendering') line = `The service is rendering: ${event.ready} of ${event.total} tracks ready${event.failed ? `, ${event.failed} failed` : ''}…`;
    else if (event.stage === 'follow-failed') line = `Stopped following the render: ${event.message}`;
    else if (event.stage === 'downloading-score') line = 'Downloading the score…';
    if (line && line !== last) { log(line); last = line; }
  };
}

function number(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new ShareError(`${name} must be a positive number.`, { code: 'invalid_option' });
  return n;
}

// Runs soundroo-cloud for a passthrough command. Human mode shares the
// terminal (prompts, progress); JSON mode prints one JSON document.
async function passthrough(origin, args, { json, print, dryRun, env }) {
  const connected = await connect(origin, { env, download: !dryRun });
  if (!connected) return null;
  const argv = ['--service', origin, ...(json ? ['--json'] : []), ...args];
  if (!json) return (await runCloud(connected.binary.path, argv, { env, inherit: true, timeoutMs: 60 * 60_000 })).code;
  print(cloudResult(await runCloud(connected.binary.path, ['--no-prompt', ...argv], { env, timeoutMs: 60 * 60_000 })));
  return 0;
}

const flagArgs = (options, names) => names.filter(name => options[name] === true).map(name => `--${name}`);

export async function runNetworkCommand(command, { positional = [], options = {}, raw = [], print, log, env = process.env }) {
  const json = Boolean(options.json);
  try {
    if (command === 'share' || command === 'publish') {
      const status = positional[0] === 'status';
      const directory = libraryPath(options.library ?? (status ? positional[1] : positional[0]));
      if (status) {
        const result = await shareStatus(directory, { service: options.service, refresh: options.refresh === true, dryRun: options['dry-run'] === true, env });
        print(json ? result : renderStatus(result));
        return 0;
      }
      const tracks = options.tracks ? String(options.tracks).split(',').map(s => s.trim()).filter(Boolean) : undefined;
      const result = await shareLibrary(directory, {
        service: options.service, tracks, visibility: options.visibility, access: options.access, brief: options.brief, artist: options.artist,
        rightsAccepted: options['rights-accepted'] === true, dryRun: options['dry-run'] === true, wait: options['no-wait'] !== true,
        timeoutMs: options.timeout != null ? number(options.timeout, '--timeout') * 1000 : undefined, force: options.force === true, env,
        onProgress: json ? undefined : progressLogger(log),
      });
      print(json ? result : renderShare(result));
      return result.status === 'failed' ? 2 : 0;
    }
    if (command === 'import') {
      if (!positional[0]) throw new ShareError('Name the track to import: node bin/soundroo.js import https://soundroo.com/t/ID --library library/my-music', { code: 'usage' });
      const result = await importTrack(libraryPath(options.library), positional[0], { service: options.service, env, dryRun: options['dry-run'] === true, onProgress: json ? undefined : progressLogger(log) });
      if (json) print(result);
      else if (result.dryRun) {
        print([`DRY RUN: would download the score of ${result.url} and add it to ${result.library}${result.libraryExists ? '' : ' (a new library)'} as a remix with its credit.`, `soundroo-cloud: ${result.tool.status}`, 'No changes were made: nothing was downloaded or saved.'].join('\n'));
      } else {
        print([`Imported “${result.track.title}” as ${result.track.id} into ${result.library}.`, `Credit when you share or play it for others: ${result.credit}`, result.verified ? 'The score matches what the artist shared.' : 'Shared with another engine version; render it to hear it with yours.', result.speech.length ? `It speaks ${result.speech.length} phrase(s); rendering them needs the optional Kokoro speech runtime (see README).` : '', `Next: ${result.next}`].filter(Boolean).join('\n'));
      }
      return 0;
    }
    // cloud passes its arguments through unparsed, so read --service from them.
    const rawService = command === 'cloud' ? raw.reduce((found, value, i) => (value === '--service' ? raw[i + 1] : value.startsWith('--service=') ? value.slice(10) : found), undefined) : undefined;
    const origin = serviceOrigin(rawService ?? options.service, env);
    if (command === 'cloud') {
      const args = raw.filter((value, i) => !(value === '--service' || raw[i - 1] === '--service' || value.startsWith('--service=')));
      const dryRun = args.includes('--dry-run');
      const connected = await connect(origin, { env, download: !dryRun });
      if (!connected) throw new ShareError('soundroo-cloud is not installed yet. Run a command without --dry-run once, or set SOUNDROO_CLOUD_BIN.', { code: 'binary_missing', exitCode: 2 });
      return (await runCloud(connected.binary.path, ['--service', origin, ...args], { env, inherit: true, timeoutMs: 60 * 60_000 })).code;
    }
    if (command === 'whoami') {
      if (options['dry-run'] === true) { print(json ? { dryRun: true, service: origin, request: { method: 'GET', path: '/api/v1/me' }, changes: 'none' } : `DRY RUN: would ask ${origin} which artist the stored key publishes as, with its collections.\nNo changes were made.`); return 0; }
      return await passthrough(origin, ['me'], { json, print, env });
    }
    if (command === 'claim-link') {
      const code = await passthrough(origin, ['claim-link', ...flagArgs(options, ['dry-run'])], { json, print, env, dryRun: options['dry-run'] === true });
      if (code === null) { print(json ? { dryRun: true, service: origin, request: { method: 'POST', path: '/api/v1/claim-links' }, changes: 'none' } : `DRY RUN: would ask ${origin} for a new claim link.\nNo changes were made.`); return 0; }
      return code;
    }
    if (command === 'login') {
      const args = ['login', ...flagArgs(options, ['start', 'wait', 'force', 'dry-run'])];
      const code = await passthrough(origin, args, { json, print, env, dryRun: options['dry-run'] === true });
      if (code === null) { print(json ? { dryRun: true, service: origin, request: { method: 'POST', path: '/api/v1/device/code' }, changes: 'none' } : `DRY RUN: would ask ${origin} for a device login code.\nNo changes were made.`); return 0; }
      return code;
    }
    if (command === 'logout') {
      const args = ['logout', ...flagArgs(options, ['confirm', 'local-only', 'dry-run'])];
      const code = await passthrough(origin, args, { json, print, env, dryRun: options['dry-run'] === true });
      if (code === null) { print(json ? { dryRun: true, service: origin, request: { method: 'DELETE', path: '/api/v1/auth/token' }, changes: 'none' } : `DRY RUN: would revoke and remove the key stored for ${origin}.\nNo changes were made.`); return 0; }
      return code;
    }
    throw new ShareError(`Unknown command: ${command}.`, { code: 'usage' });
  } catch (error) {
    const e = asShareError(error);
    if (json) print(e.toJSON());
    else {
      log('Soundroo: ' + e.message);
      for (const issue of e.issues ?? []) {
        log(`  - ${issue.path ? issue.path + ': ' : ''}${issue.message}`);
        for (const inner of issue.issues ?? []) log(`      ${inner.path}: ${inner.message}`);
      }
      if (e.hint) log(e.hint);
      if (e.claimUrl) log(`Claim link (private; whoever opens it can claim the page):\n  ${e.claimUrl}`);
      if (e.code === 'binary_unavailable') log(`soundroo-cloud is downloaded from ${MANIFEST_PATH} on the service you share with.`);
    }
    return e.exitCode;
  }
}
