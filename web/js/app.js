// Soundroo listening studio: boot, routing, navigation and shortcuts.
import { api } from './api.js';
import { data, settings, setLibrary, on, emit, trackById } from './store.js';
import { applyJobs, requestRender } from './jobs.js';
import { $, $$, h, icon, toast, errorMessage, preserveFocus } from './dom.js';
import { syncPlaying, syncFavorites, syncStatuses, toggleFavorite } from './actions.js';
import { syncTransport } from './transport.js';
import { openNowPlaying, closeNowPlaying, isOpen as nowPlayingOpen } from './nowplaying.js';
import { toggleQueue } from './queue.js';
import { openSettings, openShortcuts, openNoteDialog } from './dialogs.js';
import { initShare } from './share.js';
import { closeMenu } from './menu.js';
import { homeView } from './views/home.js';
import { tracksView, setQuery } from './views/tracks.js';
import { trackView } from './views/track.js';
import { makeView } from './views/make.js';
import { isActiveJob, plural } from './logic.js';
import * as player from './player.js';

const main = $('#main');
let view = null;
let routeKey = '';
let libraryJson = '';
let libraryTicket = 0;
let keepFocus = false;

// --- appearance -----------------------------------------------------------------

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');

function applyAppearance() {
  const root = document.documentElement;
  const theme = settings.theme === 'system' ? (darkQuery.matches ? 'dark' : 'light') : settings.theme;
  root.dataset.theme = theme;
  root.dataset.motion = settings.reduceMotion || motionQuery.matches ? 'reduce' : 'full';
  $('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#151413' : '#faf9f6');
}

darkQuery.addEventListener('change', applyAppearance);
motionQuery.addEventListener('change', () => {
  applyAppearance();
  emit('settings', {});
});
on('settings', applyAppearance);

// --- routing ----------------------------------------------------------------------

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(part => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  const [page, id, tab] = parts;
  if (!page) return { key: 'home', make: homeView };
  if (page === 'tracks') return { key: 'tracks', make: () => tracksView() };
  if (page === 'favorites') return { key: 'favorites', make: () => tracksView({ favorites: true }) };
  if (page === 'make') return { key: 'make', make: makeView };
  if (page === 'track' && id) return { key: `track:${id}`, tab: tab ?? '', make: () => trackView({ id, tab }) };
  return { key: 'home', make: homeView, unknown: true };
}

function route({ focus = true } = {}) {
  closeMenu(false);
  const next = parseRoute();
  if (next.unknown) history.replaceState(null, '', '#/');
  if (view && next.key === routeKey) {
    if (next.tab !== undefined) view.setTab?.(next.tab);
    return;
  }
  view?.destroy?.();
  routeKey = next.key;
  view = next.make();
  main.replaceChildren();
  window.scrollTo(0, 0);
  view.render(main);
  syncPlaying();
  updateNav();
  updateTitle();
  if (focus && !keepFocus) $('[data-page-title]', main)?.focus({ preventScroll: true });
  keepFocus = false;
}

function rerender() {
  if (!view) return;
  const y = window.scrollY;
  preserveFocus(() => {
    main.replaceChildren();
    view.render(main);
    syncPlaying();
  });
  window.scrollTo(0, y);
}

// Views return false from update() when they want to be rendered again.
function dispatch(type, payload) {
  if (!view || !data.loaded) return;
  if (view.update?.(type, payload) === false) rerender();
}

window.addEventListener('hashchange', () => {
  if (data.loaded) route();
});

// --- library ----------------------------------------------------------------------

async function refreshLibrary({ initial = false, quiet = false } = {}) {
  const mine = ++libraryTicket;
  try {
    const payload = await api.library();
    if (mine !== libraryTicket) return false;
    data.fetchedAt = Date.now();
    if (Array.isArray(payload?.jobs)) applyJobs(payload.jobs);
    const json = JSON.stringify([payload?.collection ?? null, payload?.tracks ?? null]);
    if (!initial && json === libraryJson) return true;
    libraryJson = json;
    setLibrary(payload);
    return true;
  } catch (error) {
    if (mine !== libraryTicket) return false;
    if (initial) throw error;
    if (!quiet) toast(`Couldn’t refresh the library. ${errorMessage(error)}`, { tone: 'error' });
    return false;
  }
}

// Pick up work the agent did in the terminal when the listener comes back.
function refreshWhenBack() {
  if (data.loaded && !document.hidden && Date.now() - data.fetchedAt > 15000) refreshLibrary({ quiet: true });
}
document.addEventListener('visibilitychange', refreshWhenBack);
window.addEventListener('focus', refreshWhenBack);

on('library', () => {
  dispatch('library');
  updateNav();
  updateTitle();
});
on('jobs', () => {
  syncStatuses();
  updateJobsIndicator();
  dispatch('jobs');
});
on('favorite', id => {
  syncFavorites(id);
  updateNav();
  dispatch('favorite', id);
});
on('player', () => {
  syncPlaying();
  updateTitle();
  dispatch('player');
});
on('feedback', id => dispatch('feedback', id));

on('jobs-settled', async ({ finished, failed }) => {
  await refreshLibrary({ quiet: true });
  const ready = finished.map(job => trackById(job.trackId)).filter(track => track?.rendered);
  if (ready.length === 1) {
    const [track] = ready;
    toast(`“${track.title}” is ready.`, player.isCurrent(track.id) ? {} : { action: { label: 'Play', run: () => player.playTrack(track.id) } });
  } else if (ready.length > 1) {
    toast(`${plural(ready.length, 'track')} finished rendering.`);
  }
  for (const job of failed) {
    const track = trackById(job.trackId);
    toast(`Rendering “${track?.title ?? 'a track'}” failed.${job.error ? ` ${job.error}` : ''}`, {
      tone: 'error',
      action: track ? { label: 'Try again', run: () => requestRender(track.id) } : null,
    });
  }
});

// --- chrome -------------------------------------------------------------------------

function updateNav() {
  const current = view?.nav ?? '';
  for (const link of $$('[data-nav]')) {
    if (link.dataset.nav === current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const count = data.tracks.filter(t => t.favorite).length;
  for (const el of $$('[data-bind="favorites-count"]')) el.textContent = count ? String(count) : '';
}

function updateTitle() {
  const track = player.currentTrack();
  document.title = player.state.playing && track ? `▶ ${track.title} · Soundroo` : `${view?.title?.() ?? 'Listen'} · Soundroo`;
}

function updateJobsIndicator() {
  const active = data.jobs.filter(isActiveJob);
  const indicator = $('#jobs-indicator');
  indicator.hidden = !active.length;
  if (!active.length) return;
  const known = active.filter(job => job.progress != null);
  const pct = known.length ? Math.round((known.reduce((sum, job) => sum + job.progress, 0) / known.length) * 100) : null;
  $('#jobs-text').textContent = `Rendering ${plural(active.length, 'track')}${pct == null ? '…' : ` · ${pct}%`}`;
  $('#jobs-bar').style.setProperty('--fill', `${pct ?? 8}%`);
}

const search = $('#search');
const onListPage = () => routeKey === 'tracks' || routeKey === 'favorites';
search.addEventListener('input', () => {
  setQuery(search.value);
  if (!onListPage() && search.value.trim()) {
    keepFocus = true;
    location.hash = '#/tracks';
  }
});
search.addEventListener('keydown', event => {
  if (event.key === 'Escape' && search.value) {
    event.stopPropagation();
    search.value = '';
    setQuery('');
  }
});
$('#search-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!onListPage()) location.hash = '#/tracks';
});

function focusSearch() {
  if (search.offsetParent !== null) {
    search.focus();
    search.select();
    return;
  }
  if (!onListPage()) {
    keepFocus = true;
    location.hash = '#/tracks';
  }
  requestAnimationFrame(() => $('.toolbar-search input')?.focus());
}

$('#open-settings').addEventListener('click', openSettings);
$('#open-shortcuts').addEventListener('click', openShortcuts);
for (const button of $$('[data-open="settings"]')) button.addEventListener('click', openSettings);

// --- keyboard ---------------------------------------------------------------------

document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
  if ($('dialog[open]:not(#np)')) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
  const key = event.key;
  const lower = key.length === 1 ? key.toLowerCase() : key;
  if (key === ' ') {
    if (target?.closest('button, a[href], summary, [role="slider"], [role="tab"], [role="menuitem"]')) return;
    player.toggle();
  } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
    if (target?.closest('[role="slider"], [role="tablist"], [role="menu"]')) return;
    const forward = key === 'ArrowRight';
    if (event.shiftKey) forward ? player.next() : player.previous();
    else player.skip(forward ? 5 : -5);
  } else if (lower === 'k') player.toggle();
  else if (lower === 'm') player.toggleMute();
  else if (lower === 'f') (nowPlayingOpen() ? closeNowPlaying() : openNowPlaying());
  else if (lower === 'q') toggleQueue();
  else if (lower === 's') player.setShuffle(!player.queue.shuffle);
  else if (lower === 'r') player.cycleRepeat();
  else if (lower === 'n') {
    if (player.state.trackId) openNoteDialog(player.state.trackId, player.currentTime());
  } else if (lower === 'l') {
    if (player.state.trackId) toggleFavorite(player.state.trackId);
  } else if (key === '/') {
    if (nowPlayingOpen()) return;
    focusSearch();
  } else if (key === '?') openShortcuts();
  else return;
  event.preventDefault();
});

// --- boot -----------------------------------------------------------------------------

function showLoading() {
  main.replaceChildren(h('div', { class: 'skeleton', role: 'status', 'aria-label': 'Loading your library' },
    h('div', { class: 'sk-hero' }, h('div', { class: 'sk-art' }), h('div', { class: 'sk-lines' }, h('span'), h('span'), h('span'))),
    h('div', { class: 'tiles' }, Array.from({ length: 10 }, () => h('div', { class: 'sk-tile' })))));
}

function showBootError(error) {
  main.replaceChildren(h('section', { class: 'empty-state boot-error', role: 'alert' },
    h('div', { class: 'empty-record', 'aria-hidden': 'true' }, h('span', { class: 'stack-disc' }, h('span', { class: 'stack-label' }))),
    h('h1', { tabindex: '-1' }, 'The studio isn’t answering'),
    h('p', {}, errorMessage(error)),
    h('p', { class: 'hint' }, 'If the terminal running Soundroo was closed, start the studio again and then try once more.'),
    h('button', { type: 'button', class: 'btn btn-primary', onclick: boot }, icon('render'), 'Try again')));
}

let booting = false;
async function boot() {
  if (booting) return;
  booting = true;
  showLoading();
  try {
    await refreshLibrary({ initial: true });
  } catch (error) {
    booting = false;
    showBootError(error);
    return;
  }
  booting = false;
  player.restore();
  route({ focus: false });
  updateJobsIndicator();
}

applyAppearance();
syncTransport();
boot();
initShare();
