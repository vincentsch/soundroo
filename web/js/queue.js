// "Playing next" side panel.
import { on, trackById } from './store.js';
import { $, $$, h, artwork, iconButton } from './dom.js';
import { formatTime } from './logic.js';
import { registerAction } from './transport.js';
import { isOpen as nowPlayingOpen, closeNowPlaying } from './nowplaying.js';
import * as player from './player.js';

const panel = $('#queue-panel');
const body = $('#queue-body');
const heading = $('#queue-title');
let returnFocus = null;

export function toggleQueue(force, opener = null) {
  const open = typeof force === 'boolean' ? force : panel.hidden;
  if (open === !panel.hidden) return;
  if (open && nowPlayingOpen()) closeNowPlaying();
  panel.hidden = !open;
  document.body.classList.toggle('queue-open', open);
  for (const button of $$('[data-action="queue"]')) {
    if (!panel.contains(button)) button.setAttribute('aria-expanded', String(open));
  }
  if (open) {
    returnFocus = opener && !panel.contains(opener) ? opener : document.activeElement;
    render();
    heading.focus();
  } else {
    const target = returnFocus?.isConnected && !returnFocus.closest('dialog') ? returnFocus : $('.player [data-action="queue"]');
    returnFocus = null;
    target?.focus();
  }
}

registerAction('queue', control => toggleQueue(undefined, control));

panel.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  event.stopPropagation();
  toggleQueue(false);
});

function render() {
  if (panel.hidden) return;
  const focusKey = document.activeElement?.closest?.('[data-key]')?.dataset.key;
  const hadFocus = panel.contains(document.activeElement);
  const { items, index } = player.queue;
  const current = player.currentTrack();
  const upcoming = items.map((id, i) => ({ id, i })).filter(entry => entry.i > index && trackById(entry.id));
  body.replaceChildren(
    h('section', { class: 'queue-section', 'aria-labelledby': 'queue-now' },
      h('h3', { id: 'queue-now' }, 'Now playing'),
      current
        ? h('ul', { class: 'queue-list', role: 'list' }, row(current, index, { current: true }))
        : h('p', { class: 'panel-empty' }, 'Nothing is playing yet.')),
    h('section', { class: 'queue-section', 'aria-labelledby': 'queue-next' },
      h('div', { class: 'queue-subhead' },
        h('h3', { id: 'queue-next' }, player.queue.shuffle ? 'Up next, shuffled' : 'Up next'),
        upcoming.length ? h('button', { type: 'button', class: 'link-btn', dataset: { key: 'q-clear' }, onclick: () => player.clearUpcoming() }, 'Clear') : null),
      upcoming.length
        ? h('ol', { class: 'queue-list' }, upcoming.map((entry, n) => row(trackById(entry.id), entry.i, { first: n === 0, last: n === upcoming.length - 1 })))
        : h('p', { class: 'panel-empty' }, player.queue.repeat === 'all' && current ? 'The queue starts again from the top.' : 'Nothing is queued after this track.')));
  if (!hadFocus) return;
  const target = focusKey && panel.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
  (target && !target.disabled ? target : heading).focus({ preventScroll: true });
}

function row(track, index, { current = false, first = false, last = false } = {}) {
  const sub = !track.rendered ? 'Not rendered, will be skipped' : [track.genre, track.mood].filter(Boolean).join(' · ') || formatTime(track.duration);
  return h('li', { class: `queue-row ${current ? 'is-current' : ''} ${track.rendered ? '' : 'is-unrendered'}`.trim(), dataset: { trackRow: track.id } },
    h('button', {
      type: 'button',
      class: 'queue-play',
      disabled: current,
      dataset: { key: `q-play:${track.id}` },
      'aria-label': current ? `Now playing: ${track.title}` : `Play ${track.title} now`,
      onclick: () => player.jumpTo(index),
    },
    artwork(track, { tag: 'span', className: 'queue-art' }),
    h('span', { class: 'queue-text' }, h('span', { class: 'queue-title' }, track.title), h('span', { class: 'queue-sub' }, sub))),
    current ? null : h('div', { class: 'queue-tools' },
      iconButton('arrow-up', `Move “${track.title}” up`, { disabled: first, dataset: { key: `q-up:${track.id}` }, onclick: () => player.moveInQueue(index, -1) }),
      iconButton('arrow-down', `Move “${track.title}” down`, { disabled: last, dataset: { key: `q-down:${track.id}` }, onclick: () => player.moveInQueue(index, 1) }),
      iconButton('close', `Remove “${track.title}” from the queue`, { dataset: { key: `q-remove:${track.id}` }, onclick: () => player.removeFromQueue(index) })));
}

on('queue', render);
on('player', render);
on('library', render);
