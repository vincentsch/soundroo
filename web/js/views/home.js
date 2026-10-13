// Listen: the collection as a record sleeve gallery.
import { data, label, isExampleInPersonal } from '../store.js';
import { h, icon, artwork } from '../dom.js';
import { plural, formatTotal, formatTime, isActiveJob } from '../logic.js';
import { playButton, moreButton, statusBadge } from '../actions.js';
import * as player from '../player.js';

const collectionIds = () => data.tracks.map(t => t.id);

export function homeView() {
  let favoritesShelf = null;

  function render(main) {
    if (!data.tracks.length) {
      main.append(emptyLibrary());
      return;
    }
    favoritesShelf = favorites();
    main.append(hero(), gallery(), favoritesShelf);
  }

  return {
    key: 'home',
    title: () => data.collection?.title ?? 'Listen',
    nav: 'home',
    render,
    // Returning false asks the router to render the view again.
    update(type) {
      if (type === 'library') return false;
      if (type === 'jobs') return data.tracks.length > 0;
      if (type === 'player') updateStack();
      if (type === 'favorite' && favoritesShelf) {
        const next = favorites();
        favoritesShelf.replaceWith(next);
        favoritesShelf = next;
      }
      return true;
    },
  };
}

function hero() {
  const collection = data.collection;
  const tracks = data.tracks;
  const total = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
  const unrendered = tracks.filter(t => !t.rendered).length;
  const playable = tracks.some(t => t.rendered);
  return h('header', { class: 'collection-hero' },
    recordStack(),
    h('div', { class: 'hero-text' },
      h('p', { class: 'eyebrow' }, label()),
      h('h1', { class: 'hero-title', tabindex: '-1', dataset: { pageTitle: '' } }, collection?.title ?? 'Library'),
      collection?.description ? h('p', { class: 'hero-desc' }, collection.description) : null,
      h('p', { class: 'hero-meta' }, [plural(tracks.length, 'track'), formatTotal(total), unrendered ? `${unrendered} not rendered yet` : ''].filter(Boolean).join(' · ')),
      h('div', { class: 'hero-actions' },
        h('button', { type: 'button', class: 'btn btn-primary', disabled: !playable, dataset: { key: 'hero-play' }, onclick: () => player.playContext(collectionIds(), null, { shuffle: false }) }, icon('play'), 'Play'),
        h('button', { type: 'button', class: 'btn btn-tinted', disabled: !playable, dataset: { key: 'hero-shuffle' }, onclick: () => player.playContext(collectionIds(), null, { shuffle: true }) }, icon('shuffle'), 'Shuffle')),
      collection?.source === 'examples'
        ? h('p', { class: 'hero-note' }, 'Built-in examples. ', h('a', { href: '#/make' }, 'Make your own collection'), ' with your coding agent.')
        : null));
}

// The current (or first) sleeve in front of two others, a record peeking out.
function recordStack() {
  const front = frontTrack();
  const others = data.tracks.filter(t => t.id !== front.id).slice(0, 2);
  return h('div', { class: 'stack', 'aria-hidden': 'true', dataset: { stack: front.id } },
    others[1] ? artwork(others[1], { className: 'stack-sleeve stack-back-2', eager: true }) : null,
    others[0] ? artwork(others[0], { className: 'stack-sleeve stack-back-1', eager: true }) : null,
    h('div', { class: 'stack-disc' }, h('span', { class: 'stack-label' })),
    artwork(front, { className: 'stack-sleeve stack-front', eager: true }));
}

function frontTrack() {
  return player.currentTrack() ?? data.tracks.find(t => t.rendered) ?? data.tracks[0];
}

function updateStack() {
  const stack = document.querySelector('[data-stack]');
  if (!stack) return;
  const front = frontTrack();
  if (front && stack.dataset.stack !== front.id) stack.replaceWith(recordStack());
  document.querySelector('[data-stack]')?.classList.toggle('is-spinning', player.state.playing);
}

function gallery() {
  return h('section', { class: 'shelf', 'aria-labelledby': 'gallery-heading' },
    h('div', { class: 'shelf-head' },
      h('h2', { id: 'gallery-heading' }, 'Tracks'),
      h('a', { class: 'shelf-link', href: '#/tracks' }, 'Show as list', icon('chevron-right'))),
    h('ul', { class: 'tiles', role: 'list' }, data.tracks.map(tile)));
}

function tile(track) {
  const sub = [isExampleInPersonal(track) ? 'Example' : '', track.genre, track.mood].filter(Boolean).join(' · ') || formatTime(track.duration);
  return h('li', { class: `tile ${track.rendered ? '' : 'is-unrendered'}`.trim(), dataset: { trackRow: track.id } },
    h('div', { class: 'tile-art' },
      playButton(track, {
        context: collectionIds,
        className: 'tile-play',
        content: [
          artwork(track, { tag: 'span' }),
          h('span', { class: 'tile-play-icon', 'aria-hidden': 'true' }, icon('play', 'when-paused'), icon('pause', 'when-playing')),
          h('span', { class: 'eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
        ],
      }),
      moreButton(track, { context: collectionIds, className: 'tile-more' }),
      statusBadge(track, { compact: true })),
    h('a', { class: 'tile-title', href: `#/track/${encodeURIComponent(track.id)}`, dataset: { title: '', key: `tile:${track.id}` } }, track.title),
    h('p', { class: 'tile-sub' }, sub));
}

function favorites() {
  const list = data.tracks.filter(t => t.favorite);
  if (!list.length) return h('div', { hidden: true });
  const context = () => data.tracks.filter(t => t.favorite).map(t => t.id);
  return h('section', { class: 'shelf', 'aria-labelledby': 'favorites-heading' },
    h('div', { class: 'shelf-head' },
      h('h2', { id: 'favorites-heading' }, 'Favorites'),
      h('a', { class: 'shelf-link', href: '#/favorites' }, 'See all', icon('chevron-right'))),
    h('ul', { class: 'mini-list', role: 'list' }, list.slice(0, 9).map(track => miniRow(track, context))));
}

export function miniRow(track, context) {
  return h('li', { class: 'mini-row', dataset: { trackRow: track.id } },
    playButton(track, {
      context,
      className: 'mini-play',
      content: [artwork(track, { tag: 'span' }), h('span', { class: 'mini-play-icon', 'aria-hidden': 'true' }, icon('play', 'when-paused'), icon('pause', 'when-playing'))],
    }),
    h('div', { class: 'mini-text' },
      h('a', { class: 'mini-title', href: `#/track/${encodeURIComponent(track.id)}`, dataset: { title: '' } }, track.title),
      h('span', { class: 'mini-sub' }, [track.genre, track.mood].filter(Boolean).join(' · ') || formatTime(track.duration))),
    moreButton(track, { context }));
}

function emptyLibrary() {
  const rendering = data.jobs.filter(isActiveJob).length;
  return h('section', { class: 'empty-state empty-library' },
    h('div', { class: 'empty-record', 'aria-hidden': 'true' }, h('span', { class: 'stack-disc' }, h('span', { class: 'stack-label' }))),
    h('h1', { tabindex: '-1', dataset: { pageTitle: '' } }, 'No music here yet'),
    h('p', {}, 'When your coding agent finishes a collection, its tracks appear here, ready to play.'),
    rendering ? h('p', { class: 'empty-busy' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), `Rendering ${plural(rendering, 'track')}…`) : null,
    h('a', { class: 'btn btn-primary', href: '#/make' }, icon('sparkle'), 'Make music'));
}

