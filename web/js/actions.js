// Track actions and the small controls that appear wherever a track is shown.
import { api, DOWNLOADS, downloadUrl } from './api.js';
import { data, emit, on, trackById, activeJob, failedJob } from './store.js';
import { h, icon, $$, nodes, toast, announce, errorMessage } from './dom.js';
import { requestRender, refreshJobsSoon } from './jobs.js';
import { openMenu } from './menu.js';
import * as player from './player.js';

// --- favorites ------------------------------------------------------------------

const favoriteRequests = new Map();

export async function toggleFavorite(id) {
  const track = trackById(id);
  if (!track) return;
  const wanted = !track.favorite;
  const ticket = (favoriteRequests.get(track.id) ?? 0) + 1;
  favoriteRequests.set(track.id, ticket);
  track.favorite = wanted;
  emit('favorite', track.id);
  announce(wanted ? `Added “${track.title}” to favorites` : `Removed “${track.title}” from favorites`);
  try {
    const result = await api.setFavorite(track.id, wanted);
    if (favoriteRequests.get(track.id) !== ticket) return;
    const saved = [result?.favorite, result?.state?.favorite, result?.track?.favorite].find(v => typeof v === 'boolean');
    if (saved !== undefined && saved !== track.favorite) {
      track.favorite = saved;
      emit('favorite', track.id);
    }
  } catch (error) {
    if (favoriteRequests.get(track.id) !== ticket) return;
    track.favorite = !wanted;
    emit('favorite', track.id);
    toast(`Couldn’t update favorites. ${errorMessage(error)}`, { tone: 'error' });
  }
}

export function favButton(track, { className = '' } = {}) {
  return h('button', {
    type: 'button',
    class: `fav-btn ${className}`.trim(),
    dataset: { fav: track.id },
    'aria-pressed': track.favorite,
    'aria-label': `Favorite “${track.title}”`,
    title: track.favorite ? 'Remove from favorites' : 'Add to favorites',
    onclick: event => {
      event.stopPropagation();
      toggleFavorite(track.id);
    },
  }, icon('heart', 'heart-off'), icon('heart-fill', 'heart-on'));
}

export function syncFavorites(id) {
  const track = trackById(id);
  if (!track) return;
  for (const button of $$(`[data-fav="${CSS.escape(track.id)}"]`)) {
    button.setAttribute('aria-pressed', String(track.favorite));
    button.title = track.favorite ? 'Remove from favorites' : 'Add to favorites';
  }
}

// --- playing ------------------------------------------------------------------

// Play/pause control for one track. `context` returns the ids to queue.
export function playButton(track, { context, className = 'play-btn', content } = {}) {
  const button = h('button', {
    type: 'button',
    class: className,
    dataset: { play: track.id },
    onclick: event => {
      event.stopPropagation();
      playFrom(track.id, context);
    },
  }, content ?? [icon('play', 'when-paused'), icon('pause', 'when-playing')]);
  updatePlayButton(button, track);
  return button;
}

export function playFrom(id, context) {
  player.playTrack(id, { context: typeof context === 'function' ? context() : context });
}

function updatePlayButton(button, track) {
  const playing = player.isPlayingTrack(track.id);
  button.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} “${track.title}”`);
  button.classList.toggle('is-playing', playing);
  button.classList.toggle('is-current', player.isCurrent(track.id));
  button.classList.toggle('is-unrendered', !track.rendered);
}

export function syncPlaying() {
  for (const button of $$('[data-play]')) {
    const track = trackById(button.dataset.play);
    if (track) updatePlayButton(button, track);
  }
  for (const el of $$('[data-track-row]')) {
    const id = el.dataset.trackRow;
    el.classList.toggle('is-current', player.isCurrent(id));
    el.classList.toggle('is-playing', player.isPlayingTrack(id));
    const title = el.querySelector('[data-title]');
    if (title) {
      if (player.isCurrent(id)) title.setAttribute('aria-current', 'true');
      else title.removeAttribute('aria-current');
    }
  }
}

// --- render status --------------------------------------------------------------

export function statusBadge(track, { compact = false } = {}) {
  const job = activeJob(track.id);
  const holder = h('span', { class: 'status', dataset: { status: track.id, compact: compact ? '1' : null } });
  fillStatus(holder, track, job, compact);
  return holder;
}

function fillStatus(holder, track, job, compact) {
  holder.replaceChildren();
  holder.className = 'status';
  holder.removeAttribute('title');
  if (job) {
    const pct = job.progress == null ? null : Math.round(job.progress * 100);
    const doing = job.type === 'stems' ? 'Preparing stems' : 'Rendering';
    holder.classList.add('status-busy');
    holder.append(...nodes(
      h('span', { class: 'spinner', 'aria-hidden': 'true' }),
      h('span', { class: 'status-text' }, job.status === 'queued' ? (job.type === 'stems' ? 'Waiting to prepare stems' : 'Waiting to render') : pct == null ? doing : `${doing} ${pct}%`),
      pct == null ? null : h('span', { class: 'status-bar', 'aria-hidden': 'true' }, h('span', { style: { width: `${pct}%` } })),
    ));
    return;
  }
  if (track.error) {
    holder.classList.add('status-problem');
    holder.title = track.error;
    holder.append(h('span', { class: 'status-text' }, 'Score needs a fix'));
    return;
  }
  const failed = failedJob(track.id);
  if (failed) {
    holder.classList.add('status-problem');
    if (failed.error) holder.title = failed.error;
    holder.append(h('span', { class: 'status-text' }, track.rendered ? 'Last render failed' : 'Render failed'));
    if (!compact) {
      holder.append(h('button', {
        type: 'button',
        class: 'link-btn',
        onclick: event => {
          event.stopPropagation();
          requestRender(track.id);
        },
      }, 'Try again'));
    }
    return;
  }
  if (!track.rendered) {
    holder.classList.add('status-idle');
    holder.append(h('span', { class: 'status-text' }, 'Not rendered'));
    if (!compact) {
      holder.append(h('button', {
        type: 'button',
        class: 'link-btn',
        onclick: event => {
          event.stopPropagation();
          requestRender(track.id);
        },
      }, 'Render'));
    }
  }
}

export function syncStatuses() {
  for (const holder of $$('[data-status]')) {
    const track = trackById(holder.dataset.status);
    if (track) fillStatus(holder, track, activeJob(track.id), holder.dataset.compact === '1');
  }
}

// --- menu -----------------------------------------------------------------------

export function trackMenuItems(track, { context, detail = true } = {}) {
  const current = player.isCurrent(track.id);
  const busy = Boolean(activeJob(track.id));
  return [
    { label: player.isPlayingTrack(track.id) ? 'Pause' : 'Play', icon: player.isPlayingTrack(track.id) ? 'pause' : 'play', disabled: !track.rendered, run: () => playFrom(track.id, context) },
    { label: 'Play next', icon: 'play-next', disabled: !track.rendered || current, run: () => player.playNext(track.id) },
    { label: 'Add to queue', icon: 'queue', disabled: !track.rendered || current, run: () => player.addToQueue(track.id) },
    { label: track.favorite ? 'Remove from favorites' : 'Add to favorites', icon: track.favorite ? 'heart-fill' : 'heart', run: () => toggleFavorite(track.id) },
    detail ? { label: 'Open track', icon: 'arrow-right', href: `#/track/${encodeURIComponent(track.id)}` } : null,
    'separator',
    ...DOWNLOADS.filter(d => d.kind !== 'share').map(d => ({
      label: `Download ${d.label.toLowerCase()}`,
      hint: d.format,
      icon: 'download',
      href: downloadUrl(track.id, d.kind),
      download: '',
      run: d.needsRender ? () => setTimeout(refreshJobsSoon, 400) : null,
      disabled: d.needsRender && !track.rendered,
    })),
    'separator',
    { label: busy ? 'Rendering…' : track.rendered ? 'Render again' : 'Render now', icon: 'render', disabled: busy, run: () => requestRender(track.id) },
  ];
}

export function moreButton(track, options = {}) {
  return h('button', {
    type: 'button',
    class: `icon-btn more-btn ${options.className ?? ''}`.trim(),
    'aria-label': `More for “${track.title}”`,
    title: 'More',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    onclick: event => {
      event.stopPropagation();
      const fresh = trackById(track.id) ?? track;
      openMenu(event.currentTarget, trackMenuItems(fresh, options), { label: `Options for ${fresh.title}` });
    },
  }, icon('more'));
}

// --- unplayable tracks ------------------------------------------------------------

on('unplayable', id => {
  const track = trackById(id);
  if (!track) {
    toast(data.tracks.length ? 'Nothing here is rendered yet. Render a track to listen to it.' : 'There’s no music in the library yet.');
    return;
  }
  if (activeJob(track.id)) {
    toast(`“${track.title}” is still rendering. It will be playable in a moment.`);
    return;
  }
  toast(`“${track.title}” isn’t rendered yet.`, { action: { label: 'Render now', run: () => requestRender(track.id) } });
});

