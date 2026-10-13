// Share on a Soundroo service, from the studio. The studio server prepares the
// scores and talks to the service through soundroo-cloud; keys never reach
// this page. Nothing is sent until the listener ticks the rights box and
// presses Share. The buttons stay hidden when the studio has no sharing; the
// page-load check is cheap, and the tracks are checked when the dialog opens.
import { on } from './store.js';
import { $$, h, icon, toast, copyText, errorMessage } from './dom.js';
import { formatTime, plural } from './logic.js';
import { requestRender } from './jobs.js';

const dialog = document.getElementById('share-dialog');
const body = document.getElementById('share-body');
const RUNNING = new Set(['preparing', 'download', 'uploading', 'rendering']);
const VISIBILITY = {
  unlisted: { label: 'Anyone with the link', hint: 'Not listed on the site. Good for sending to friends.' },
  public: { label: 'Public', hint: 'Listed on soundroo.com once your artist page is claimed.' },
  private: { label: 'Only me', hint: 'Only you can play it after signing in.' },
};
const ACCESS = {
  open: { label: 'Open', hint: 'Listeners can download the score, audio and MIDI and remix them with credit (CC BY 4.0).' },
  'listen-only': { label: 'Listen only', hint: 'Streaming only. No downloads or remixes.' },
};
// An update keeps what is set on the service, including changes made on the
// website, unless the listener picks a value here.
const KEEP = 'keep';
const IDENTITY_ERRORS = new Set(['key_missing', 'artist_mismatch']);

let token = '';
let status = null;
let account = null;
let tracks = [];
let view = 'loading';
let lastError = null;
let job = null;
let pollTimer = 0;
let login = null;
let loginTimer = 0;
// What "Try again" repeats: opening the dialog, or the share that failed.
let retry = null;
const choices = { tracks: new Set(), visibility: 'unlisted', access: 'open', artist: '', rights: false };

async function call(path, { method = 'GET', payload } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers['x-soundroo-share'] = token;
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(path, { method, headers, cache: 'no-store', body: payload === undefined ? undefined : JSON.stringify(payload) });
  } catch {
    throw new Error("Soundroo's local server isn't responding. Check that the studio is still running.");
  }
  const raw = await response.text().catch(() => '');
  let json = null;
  try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
  if (!response.ok) {
    const error = new Error(typeof json?.error === 'string' && json.error ? json.error : `The studio answered with an error (${response.status}).`);
    Object.assign(error, { code: json?.code, issues: json?.issues, hint: json?.hint, status: response.status });
    throw error;
  }
  return json ?? {};
}

const host = url => { try { return new URL(url).host; } catch { return url; } };
const shortLabel = url => { try { const u = new URL(url); return u.host + u.pathname; } catch { return url; } };
const ready = () => tracks.filter(t => t.status === 'ready');
const updating = () => Boolean(status?.shared?.shared);
// The artist page this library was shared as, from sharing.json.
const sharedAs = () => (updating() ? status.shared.artist?.handle ?? null : null);

function optionsFor(name) {
  const [options, keep] = name === 'share-visibility'
    ? [VISIBILITY, `Each track keeps who can listen as set on ${host(status?.service)}.`]
    : [ACCESS, `Each track keeps its download setting from ${host(status?.service)}.`];
  return updating() ? { [KEEP]: { label: 'Unchanged', hint: keep }, ...options } : options;
}

// The dialog's local reads: every track's readiness and the stored key.
async function loadDetails() {
  const details = await call('/api/share/account');
  account = details;
  // A studio started before this check moved keeps sending tracks in its status.
  tracks = details.tracks ?? status?.tracks ?? [];
}

function header(title, sub) {
  return [
    h('header', { class: 'sheet-head' },
      h('h2', { id: 'share-title', tabindex: '-1' }, title),
      h('button', { type: 'button', class: 'icon-btn', 'data-close': '', 'aria-label': 'Close', title: 'Close' }, icon('close'))),
    sub ? h('p', { class: 'sheet-sub' }, sub) : null,
  ];
}

function linkRow(label, url) {
  return h('div', { class: 'share-link' },
    h('span', { class: 'share-link-label' }, label),
    h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, url),
    h('button', {
      type: 'button', class: 'icon-btn', 'aria-label': `Copy ${label.toLowerCase()}`, title: 'Copy link',
      onclick: async () => toast((await copyText(url)) ? 'Link copied.' : 'Couldn’t copy. Select the link instead.'),
    }, icon('copy')));
}

function segmented(name, legend, value, onChange) {
  const options = optionsFor(name);
  return h('fieldset', { class: 'segmented share-choice' },
    h('legend', {}, legend),
    Object.entries(options).map(([key, option]) => h('label', {},
      h('input', { type: 'radio', name, value: key, checked: value === key, onchange: () => { onChange(key); paintHints(); } }),
      h('span', {}, option.label))),
    h('p', { class: 'hint', dataset: { hintFor: name } }, options[value]?.hint ?? ''));
}

function paintHints() {
  for (const el of body.querySelectorAll('[data-hint-for]')) {
    const value = el.dataset.hintFor === 'share-visibility' ? choices.visibility : choices.access;
    el.textContent = optionsFor(el.dataset.hintFor)[value]?.hint ?? '';
  }
}

function trackRow(track) {
  const selectable = track.status === 'ready';
  const badge = { ready: 'Ready', render: 'Render first', example: 'Example', blocked: 'Can’t share' }[track.status] ?? track.status;
  return h('li', { class: `share-track${selectable ? '' : ' is-disabled'}` },
    h('label', { class: 'check' },
      h('input', {
        type: 'checkbox', checked: selectable && choices.tracks.has(track.localId), disabled: !selectable,
        onchange: event => { event.target.checked ? choices.tracks.add(track.localId) : choices.tracks.delete(track.localId); paintSubmit(); },
      }),
      h('span', {},
        h('strong', {}, track.title),
        h('small', {}, [track.duration ? formatTime(track.duration) : '', track.speech ? plural(track.speech, 'spoken phrase') : '', track.remixOf ? 'Remix' : ''].filter(Boolean).join(' · ') || ' '))),
    h('span', { class: `share-badge share-badge-${track.status}`, title: track.message ?? '' }, badge),
    track.status === 'render' ? h('button', { type: 'button', class: 'link-btn', onclick: () => requestRender(track.localId) }, 'Render') : null,
    !selectable && track.message ? h('p', { class: 'share-track-note' }, track.message) : null);
}

function claimLink(url, label) {
  return h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, label);
}

function accountLine() {
  const key = account?.key;
  if (key?.artist?.handle) {
    const unclaimed = key.kind === 'guest' && !key.claimed;
    // A guest page kept from before connecting an account; the notice above
    // shows it when this collection belongs to it.
    const former = key.formerGuest?.artist?.handle && key.formerGuest.artist.handle !== sharedAs() ? key.formerGuest : null;
    return h('p', { class: 'hint share-account' }, `Shares as @${key.artist.handle}${unclaimed ? ', a guest artist page that is not claimed yet' : ''}.`,
      unclaimed && key.claimUrl ? [' ', claimLink(key.claimUrl, 'Claim it'), ' while signed in to keep the music on your own account. Keep that link private.'] : null,
      former ? [` Music you shared as the guest @${former.artist.handle} stays on that page until you `, claimLink(former.claimUrl, 'open its claim link'), ' while signed in. Keep that link private.'] : null);
  }
  // A library shared before never starts a new guest artist: the service would
  // refuse its music as another artist's.
  if (sharedAs()) return null;
  return h('div', { class: 'field share-artist' },
    h('label', { for: 'share-artist' }, 'Artist name (optional)'),
    h('input', { id: 'share-artist', maxlength: '80', autocomplete: 'off', placeholder: 'Leave empty to get a generated name', value: choices.artist, oninput: event => { choices.artist = event.target.value; } }),
    h('p', { class: 'hint' }, 'No account is needed. Your first share creates a guest artist page with a private claim link; claim it later to keep the music and list it publicly.'));
}

// Who owns this library's collection, from local records only. Updating it
// needs that artist page's owner; the way back is to claim the page while
// signed in, then connect that account, never a new guest artist.
function identityNotice() {
  const page = sharedAs();
  if (!page || account?.tool !== 'installed') return null;
  const key = account.key;
  if (!key) {
    return h('p', { class: 'notice notice-warn share-identity' }, icon('alert'),
      h('span', {}, `This collection was shared as @${page}, and this computer has no key for it. To update it, sign in as its owner: if @${page} is a guest page that is not claimed yet, first open its claim link (your first share showed it) while signed in to your Soundroo account. Then connect your account below.`));
  }
  if (!key.artist?.handle || key.artist.handle === page) return null;
  const former = key.formerGuest?.artist?.handle === page ? key.formerGuest : null;
  if (former) {
    return h('section', { class: 'share-claim share-identity' },
      h('h3', {}, `Claim @${page} before updating`),
      h('p', {}, `This collection belongs to @${page}, the guest page you shared with before connecting @${key.artist.handle}. Open its claim link while signed in as @${key.artist.handle}; the music moves into your account. Then update. Keep the link private: whoever opens it can claim the page.`),
      linkRow('Claim link', former.claimUrl));
  }
  return h('p', { class: 'notice share-identity' }, icon('info'),
    h('span', {}, `This collection was shared as @${page}, and this computer shares as @${key.artist.handle}. Updating works once @${page}'s music is in this account: if @${page} is a guest page that is not claimed yet, open its claim link while signed in as @${key.artist.handle} first.`));
}

function loginBlock() {
  return h('div', { id: 'share-login-slot' }, loginContent());
}

function paintLogin() {
  const slot = body?.querySelector('#share-login-slot');
  if (slot) slot.replaceChildren(...[loginContent()].filter(Boolean));
  const line = body?.querySelector('.share-account, .share-artist');
  if (line && account?.key?.artist?.handle) line.replaceWith(accountLine());
}

function loginContent() {
  const key = account?.key;
  if (key?.kind === 'account') return null;
  if (!login) {
    // Claim first: connecting an account keeps an unclaimed guest's music on the guest page.
    const claimFirst = (key?.kind === 'guest' && !key.claimed && key.claimUrl) || (!key && sharedAs());
    return h('p', { class: 'hint' }, claimFirst ? 'Have a Soundroo account? After claiming, ' : 'Already have a Soundroo account? ',
      h('button', { type: 'button', class: 'link-btn', onclick: startLogin }, claimFirst ? 'connect it' : 'Connect it instead'), '.');
  }
  if (login.status === 'waiting') {
    return h('div', { class: 'notice share-login', role: 'status' }, icon('info'),
      h('span', {}, 'Open ', h('a', { href: login.verificationUriComplete || login.verificationUri, target: '_blank', rel: 'noopener noreferrer' }, host(login.verificationUri)),
        ', sign in and approve code ', h('strong', { class: 'share-code' }, login.userCode), '. This dialog updates when you are done.'));
  }
  if (login.status === 'done') {
    const former = login.formerGuest;
    return h('p', { class: 'notice share-login' }, icon('check'), h('span', {}, 'Your account is connected.',
      former?.claimUrl && former.artist?.handle !== sharedAs() ? [` Music you shared as the guest @${former.artist?.handle} stays on that page until you `, claimLink(former.claimUrl, 'open its claim link'), ' while signed in.'] : null));
  }
  return h('p', { class: 'notice notice-warn' }, icon('alert'), login.error ?? 'Login did not finish.');
}

function paintSubmit() {
  const button = body.querySelector('#share-submit');
  if (!button) return;
  const count = choices.tracks.size;
  // Stays pressable so a missing choice is explained, not silently blocked.
  button.disabled = !ready().length;
  button.replaceChildren(icon('globe'), count ? `${updating() ? 'Update' : 'Share'} ${plural(count, 'track')}` : 'Share');
}

function composeView() {
  const shared = updating() ? status.shared : null;
  const error = h('p', { class: 'form-error', id: 'share-error', role: 'alert', hidden: true });
  const form = h('form', {
    class: 'share-form', novalidate: true,
    onsubmit: event => {
      event.preventDefault();
      if (!choices.tracks.size) { error.textContent = 'Choose at least one ready track.'; error.hidden = false; return; }
      if (!choices.rights) { error.textContent = 'Confirm that you have the right to share this music.'; error.hidden = false; body.querySelector('#share-rights')?.focus(); return; }
      publish();
    },
  },
  header(shared ? 'Update on Soundroo' : 'Share on Soundroo', `${status.collection?.title || 'This collection'} · ${host(status.service)}`),
  shared?.collection?.url ? h('div', { class: 'notice share-shared' }, icon('check'),
    h('span', {}, 'Shared before. ', h('a', { href: shared.collection.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open the collection'), '. Sharing again adds new versions at the same links.')) : null,
  h('p', { class: 'share-intro' }, `${host(status.service)} renders the audio from your scores and gives you links that play anywhere.`),
  h('fieldset', { class: 'share-tracks' },
    h('legend', {}, `Tracks · ${ready().length} of ${tracks.length} ready`),
    h('ul', { role: 'list' }, tracks.map(trackRow))),
  segmented('share-visibility', 'Who can listen', choices.visibility, value => { choices.visibility = value; }),
  segmented('share-access', 'Downloads and remixes', choices.access, value => { choices.access = value; }),
  identityNotice(),
  accountLine(),
  loginBlock(),
  h('details', { class: 'share-details' },
    h('summary', {}, 'What is sent'),
    h('p', {}, status.uploads),
    h('p', {}, status.staysLocal),
    h('p', {}, 'The service checks that every track renders from its score with an official Soundroo engine. It cannot tell whether a person or an AI model wrote a score.')),
  h('label', { class: 'check share-rights' },
    h('input', { type: 'checkbox', id: 'share-rights', checked: choices.rights, onchange: event => { choices.rights = event.target.checked; paintSubmit(); } }),
    h('span', {}, h('strong', {}, 'I have the right to share this music.'),
      h('small', {}, 'It is original or properly credited, and it does not copy someone else’s melody, lyrics or recording.'))),
  error,
  h('footer', { class: 'sheet-foot' },
    h('button', { type: 'button', class: 'btn btn-quiet', 'data-close': '' }, 'Cancel'),
    h('button', { type: 'submit', class: 'btn btn-primary', id: 'share-submit' })));
  queueMicrotask(paintSubmit);
  return form;
}

function progressView() {
  const stage = job?.stage ?? 'preparing';
  const progress = job?.progress ?? {};
  const steps = [
    ['preparing', 'Checking the tracks'],
    ...(stage === 'download' ? [['download', `Getting the sharing tool${progress.size ? ` (${(progress.size / 1e6).toFixed(1)} MB)` : ''}`]] : []),
    ['uploading', 'Sending scores and settings'],
    ['rendering', progress.total ? `Rendering on ${host(status?.service)}: ${progress.ready} of ${progress.total} ready` : `Rendering on ${host(status?.service)}`],
  ];
  const order = steps.map(([key]) => key);
  const at = Math.max(0, order.indexOf(stage));
  const pct = progress.total ? Math.round((progress.ready / progress.total) * 100) : null;
  return h('div', { class: 'share-form' },
    header('Sharing…', status?.collection?.title ?? ''),
    h('ol', { class: 'share-steps', role: 'status', 'aria-live': 'polite' }, steps.map(([key, label], i) => h('li', { class: i < at ? 'is-done' : i === at ? 'is-active' : '' },
      i < at ? icon('check') : i === at ? h('span', { class: 'spinner', 'aria-hidden': 'true' }) : h('span', { class: 'share-dot', 'aria-hidden': 'true' }),
      h('span', {}, label)))),
    pct == null ? null : h('span', { class: 'share-bar', 'aria-hidden': 'true' }, h('span', { style: { width: `${pct}%` } })),
    h('p', { class: 'hint' }, 'You can close this window. Sharing continues while the studio runs.'),
    h('footer', { class: 'sheet-foot' }, h('button', { type: 'button', class: 'btn btn-quiet', 'data-close': '' }, 'Close')));
}

function doneView() {
  const result = job?.result ?? {};
  const failed = result.status === 'failed';
  return h('div', { class: 'share-form' },
    header(failed ? 'Shared, with problems' : result.unchanged ? 'Already shared' : 'Shared', `${result.collection?.title ?? ''} · ${host(result.service ?? status?.service)}`),
    result.unchanged ? h('p', { class: 'share-intro' }, 'Nothing changed since the last share, so nothing new was sent.') : null,
    result.collection?.url ? linkRow('Collection', result.collection.url) : null,
    result.collection?.shortUrl ? linkRow('Short link', result.collection.shortUrl) : null,
    h('ul', { class: 'share-results', role: 'list' }, (result.tracks ?? []).map(t => h('li', {},
      h('span', { class: 'share-result-title' }, t.title ?? t.localId),
      h('span', { class: `share-badge share-badge-${t.status === 'ready' ? 'ready' : t.status === 'failed' ? 'blocked' : 'render'}` }, t.status === 'ready' ? 'Playing' : t.status === 'failed' ? 'Failed' : 'Rendering'),
      t.shortUrl ? h('a', { href: t.shortUrl, target: '_blank', rel: 'noopener noreferrer' }, shortLabel(t.shortUrl)) : null))),
    result.claimUrl ? h('section', { class: 'share-claim' },
      h('h3', {}, 'Claim your artist page'),
      h('p', {}, 'Open this link and sign in to keep this music on your own page and list it publicly. Keep it private: whoever opens it can claim the page.'),
      linkRow('Claim link', result.claimUrl)) : null,
    failed ? h('p', { class: 'notice notice-warn' }, icon('alert'), 'Some tracks did not render on the service. Check them here, render again and share again.') : null,
    h('footer', { class: 'sheet-foot' }, h('button', { type: 'button', class: 'btn btn-primary', 'data-close': '' }, 'Done')));
}

// The studio's own words for a library whose artist page this computer cannot
// update; the command-line hint names commands the listener does not need here.
function studioHint(e) {
  if (!IDENTITY_ERRORS.has(e.code)) return e.hint;
  if (e.code === 'artist_mismatch' && e.claimUrl) return 'Open the claim link below while signed in to your Soundroo account; the music moves into your account. Then try again.';
  return `Sign in as the owner of that artist page: if it is a guest page that is not claimed yet, first open its claim link${e.claimUrl ? ' below' : ''} while signed in to your Soundroo account. Then go back, connect that account and try again.`;
}

function errorView() {
  const e = lastError ?? {};
  const issues = Array.isArray(e.issues) ? e.issues : [];
  const hint = studioHint(e);
  return h('div', { class: 'share-form' },
    header('Sharing didn’t finish', status?.collection?.title ?? ''),
    h('p', { class: 'notice notice-warn', role: 'alert' }, icon('alert'), errorMessage(e)),
    issues.length ? h('ul', { class: 'share-issues' }, issues.slice(0, 12).map(issue => h('li', {}, issue.message ?? String(issue)))) : null,
    hint ? h('p', { class: 'hint' }, hint) : null,
    e.claimUrl ? h('section', { class: 'share-claim' },
      h('p', {}, 'Keep this link private: whoever opens it can claim the page.'),
      linkRow('Claim link', e.claimUrl)) : null,
    h('footer', { class: 'sheet-foot' },
      retry === open ? null : h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => { view = 'compose'; render(); } }, 'Back'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => (retry ?? open)() }, icon('render'), 'Try again')));
}

let painted = '';
function render() {
  if (!body) return;
  const views = {
    loading: () => h('div', { class: 'share-form', role: 'status' }, header('Share on Soundroo'), h('p', { class: 'share-intro' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), ' Checking your library…')),
    unavailable: () => h('div', { class: 'share-form' }, header('Sharing is not set up'), h('p', { class: 'notice notice-warn' }, icon('alert'), status?.reason ?? 'This studio cannot share right now.')),
    compose: composeView,
    progress: progressView,
    done: doneView,
    error: errorView,
  };
  const keep = body.contains(document.activeElement) && painted === view ? document.activeElement?.id || document.activeElement?.dataset?.close != null && 'close' : null;
  body.replaceChildren(views[view]?.() ?? views.loading());
  // Move focus to the heading only when the step changes, not on progress updates.
  if (painted !== view) body.querySelector('#share-title')?.focus({ preventScroll: true });
  else if (keep === 'close') body.querySelector('[data-close]')?.focus({ preventScroll: true });
  else if (keep) document.getElementById(keep)?.focus({ preventScroll: true });
  painted = view;
}

function show() {
  if (dialog && !dialog.open) dialog.showModal();
  render();
}

function initialChoices() {
  choices.tracks = new Set(ready().map(t => t.localId));
  // A first share starts from the defaults; an update keeps the service's
  // choices for every track until the listener picks another.
  choices.visibility = updating() ? KEEP : 'unlisted';
  choices.access = updating() ? KEEP : 'open';
  // The rights confirmation is asked again every time.
  choices.rights = false;
}

async function open() {
  if (!dialog || !body) return;
  // Never carried over from an earlier share: asked again every time.
  choices.rights = false;
  if (!(job && RUNNING.has(job.status))) { view = 'loading'; render(); }
  if (!dialog.open) dialog.showModal();
  try {
    status = await call('/api/share');
    token = status.token ?? '';
    if (!status.available) { view = 'unavailable'; render(); return; }
    await loadDetails();
    if (status.job && RUNNING.has(status.job.status)) { job = status.job; view = 'progress'; schedulePoll(); }
    else if (view === 'loading') { initialChoices(); view = 'compose'; }
    render();
  } catch (error) {
    lastError = error;
    retry = open;
    view = 'error';
    render();
  }
}

async function publish() {
  view = 'progress';
  job = { status: 'preparing', stage: 'preparing' };
  render();
  try {
    // Untouched choices of an update are left out, so the service keeps its own.
    const answer = await call('/api/share/publish', { method: 'POST', payload: {
      rightsAccepted: choices.rights === true, tracks: [...choices.tracks],
      visibility: choices.visibility === KEEP ? undefined : choices.visibility,
      access: choices.access === KEEP ? undefined : choices.access,
      artist: choices.artist.trim() || undefined,
    } });
    job = answer.job;
    schedulePoll();
  } catch (error) {
    lastError = error;
    retry = publish;
    view = 'error';
    render();
  }
}

function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(poll, 1500);
}

async function poll() {
  if (!job?.id) return;
  try {
    job = (await call(`/api/share/jobs/${encodeURIComponent(job.id)}`)).job;
  } catch (error) {
    lastError = error;
    retry = publish;
    view = 'error';
    if (dialog.open) render();
    return;
  }
  if (RUNNING.has(job.status)) {
    if (dialog.open && view === 'progress') render();
    schedulePoll();
    return;
  }
  if (job.status === 'error') {
    lastError = Object.assign(new Error(job.error?.error ?? 'Sharing did not finish.'), job.error ?? {});
    retry = publish;
    view = 'error';
  } else view = 'done';
  if (dialog.open) render();
  else if (view === 'done') toast(`“${job.result?.collection?.title ?? 'Your music'}” is shared.`, { action: { label: 'Show links', run: show } });
  else toast('Sharing didn’t finish.', { tone: 'error', action: { label: 'Details', run: show } });
}

async function startLogin() {
  try {
    login = await call('/api/share/login', { method: 'POST', payload: {} });
  } catch (error) {
    login = { status: 'error', error: errorMessage(error) };
  }
  if (view === 'compose') paintLogin();
  clearTimeout(loginTimer);
  const check = async () => {
    try { login = { ...login, ...(await call('/api/share/login')) }; } catch (error) { login = { status: 'error', error: errorMessage(error) }; }
    if (login.status === 'waiting') loginTimer = setTimeout(check, 3000);
    else if (login.status === 'done') {
      await loadDetails().catch(() => {});
      // The key changed: the account line and the claim notice follow it.
      if (dialog.open && view === 'compose') { render(); return; }
    }
    if (dialog.open && view === 'compose' && login.status !== 'waiting') paintLogin();
  };
  if (login.status === 'waiting') loginTimer = setTimeout(check, 3000);
}

export async function initShare() {
  if (!dialog || !body) return;
  const openers = $$('[data-open="share"]');
  for (const button of openers) button.addEventListener('click', () => open());
  dialog.addEventListener('close', () => { clearTimeout(loginTimer); painted = ''; });
  try {
    await call('/api/share');
    for (const button of openers) button.hidden = false;
  } catch {
    // A studio without sharing support: keep the buttons hidden.
  }
}

// After a render finishes, the open dialog shows the track as ready, keeping
// the listener's choices.
on('jobs-settled', async () => {
  if (!dialog?.open || view !== 'compose') return;
  try {
    const before = new Set(ready().map(t => t.localId));
    await loadDetails();
    for (const track of ready()) if (!before.has(track.localId)) choices.tracks.add(track.localId);
    render();
  } catch { /* keep the dialog as it is */ }
});
