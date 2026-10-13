// Tracks and Favorites: the searchable list.
import { data, label, settings, updateSettings, isExampleInPersonal } from '../store.js';
import { h, icon, artwork, nodes, preserveFocus } from '../dom.js';
import { filterTracks, sortTracks, facet, formatTime, formatTotal, plural, SORTS } from '../logic.js';
import { playButton, favButton, moreButton, statusBadge, playFrom } from '../actions.js';
import * as player from '../player.js';

// Shared with the sidebar search field.
export const filters = { query: '', genre: '', mood: '', status: '' };
const listeners = new Set();
export function setQuery(query) {
  filters.query = query;
  for (const fn of listeners) fn();
}

export function tracksView({ favorites = false } = {}) {
  let list = null;
  let foot = null;
  let tools = null;
  const visible = () => sortTracks(filterTracks(data.tracks, { ...filters, favorites }), settings.sort);
  const context = () => visible().map(t => t.id);
  const refresh = () => preserveFocus(fill);

  function render(main) {
    const collection = data.collection;
    main.append(
      h('header', { class: 'page-head' },
        h('p', { class: 'eyebrow' }, collection ? `${label()} · ${collection.title}` : label()),
        h('div', { class: 'page-title-row' },
          h('h1', { tabindex: '-1', dataset: { pageTitle: '' } }, favorites ? 'Favorites' : 'Tracks'),
          h('div', { class: 'page-actions' },
            h('button', { type: 'button', class: 'btn btn-primary btn-small', dataset: { key: 'list-play' }, onclick: () => player.playContext(context(), null, { shuffle: false }) }, icon('play'), 'Play'),
            h('button', { type: 'button', class: 'btn btn-tinted btn-small', dataset: { key: 'list-shuffle' }, onclick: () => player.playContext(context(), null, { shuffle: true }) }, icon('shuffle'), 'Shuffle')))),
      tools = toolbar(),
      h('div', { class: 'tracklist-head', 'aria-hidden': 'true' },
        h('span', { class: 'col-num' }, '#'), h('span', { class: 'col-title' }, 'Title'), h('span', { class: 'col-genre' }, 'Genre'),
        h('span', { class: 'col-mood' }, 'Mood'), h('span', { class: 'col-bpm' }, 'BPM'), h('span', { class: 'col-time' }, 'Time')),
      list = h('ol', { class: 'tracklist', 'aria-label': favorites ? 'Favorite tracks' : 'Tracks' }),
      foot = h('div', { class: 'list-foot' }));
    fill();
    listeners.add(refresh);
  }

  function toolbar() {
    const genres = facet(data.tracks, 'genre');
    const moods = facet(data.tracks, 'mood');
    const anyUnrendered = data.tracks.some(t => !t.rendered);
    const select = (key, labelText, options, allLabel) => h('label', { class: 'select' },
      h('span', { class: 'visually-hidden' }, labelText),
      h('select', {
        dataset: { key: `filter-${key}` },
        onchange: event => {
          filters[key] = event.target.value;
          refresh();
        },
      }, h('option', { value: '' }, allLabel), options.map(([value, text]) => h('option', { value, selected: filters[key] === value }, text))),
      icon('chevron-down'));
    return h('div', { class: 'toolbar', role: 'group', 'aria-label': 'Search and filter' },
      h('label', { class: 'search-field toolbar-search' },
        icon('search'),
        h('span', { class: 'visually-hidden' }, 'Search tracks'),
        h('input', {
          type: 'search',
          placeholder: 'Search title, mood, genre…',
          value: filters.query,
          dataset: { key: 'page-search' },
          oninput: event => {
            setQuery(event.target.value);
            const side = document.getElementById('search');
            if (side) side.value = event.target.value;
          },
        })),
      genres.length > 1 ? select('genre', 'Genre', genres.map(g => [g, g]), 'All genres') : null,
      moods.length > 1 ? select('mood', 'Mood', moods.map(m => [m, m]), 'All moods') : null,
      anyUnrendered ? select('status', 'Render status', [['rendered', 'Ready to play'], ['unrendered', 'Not rendered']], 'Any status') : null,
      h('label', { class: 'select select-sort' },
        h('span', { class: 'select-label' }, 'Sort'),
        h('select', {
          dataset: { key: 'sort' },
          onchange: event => {
            updateSettings({ sort: event.target.value }, { quiet: true });
            refresh();
          },
        }, Object.entries(SORTS).map(([value, text]) => h('option', { value, selected: settings.sort === value }, text))),
        icon('chevron-down')));
  }

  function fill() {
    if (!list) return;
    const tracks = visible();
    list.replaceChildren(...tracks.map(track => row(track, context)));
    const filtered = filters.query || filters.genre || filters.mood || filters.status;
    if (!tracks.length) {
      list.replaceChildren(h('li', { class: 'list-empty' }, emptyMessage(filtered)));
    }
    const total = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
    foot.replaceChildren(...nodes(
      tracks.length ? h('span', {}, [plural(tracks.length, 'track'), formatTotal(total)].filter(Boolean).join(', ')) : null,
      filtered ? h('button', { type: 'button', class: 'link-btn', dataset: { key: 'clear-filters' }, onclick: clearFilters }, 'Clear search and filters') : null));
  }

  function emptyMessage(filtered) {
    if (!data.tracks.length) return [h('strong', {}, 'No music here yet.'), ' When your coding agent finishes a collection, it appears here. ', h('a', { href: '#/make' }, 'Make music')];
    if (filtered) return [h('strong', {}, 'Nothing matches.'), ' Try another word or clear the filters.'];
    if (favorites) return [h('strong', {}, 'No favorites yet.'), ' Tap the heart on a track you love and it collects here.'];
    return 'No tracks.';
  }

  function clearFilters() {
    filters.genre = '';
    filters.mood = '';
    filters.status = '';
    setQuery('');
    const side = document.getElementById('search');
    if (side) side.value = '';
    const fresh = toolbar();
    tools.replaceWith(fresh);
    tools = fresh;
    refresh();
    document.querySelector('[data-page-title]')?.focus();
  }

  return {
    key: favorites ? 'favorites' : 'tracks',
    title: () => (favorites ? 'Favorites' : 'Tracks'),
    nav: favorites ? 'favorites' : 'tracks',
    render,
    update(type) {
      if (type === 'library') return false;
      // Unfavorited rows stay until the list is opened again, so a mistaken tap is easy to undo.
      return true;
    },
    destroy() {
      listeners.delete(refresh);
    },
  };
}

function row(track, context) {
  return h('li', {
    class: `row ${track.rendered ? '' : 'is-unrendered'}`.trim(),
    dataset: { trackRow: track.id },
    ondblclick: event => {
      if (!event.target.closest('button, a, input, select')) playFrom(track.id, context);
    },
  },
  h('div', { class: 'row-num' },
    h('span', { class: 'row-index', 'aria-hidden': 'true' }, String(track.index + 1)),
    h('span', { class: 'eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
    playButton(track, { context, className: 'row-play' })),
  artwork(track, { className: 'row-art' }),
  h('div', { class: 'row-main' },
    h('a', { class: 'row-title', href: `#/track/${encodeURIComponent(track.id)}`, dataset: { title: '', key: `row:${track.id}` } }, track.title),
    h('span', { class: 'row-sub' },
      statusBadge(track),
      isExampleInPersonal(track) ? h('span', { class: 'tag' }, 'Example') : null,
      h('span', { class: 'row-desc' }, track.description || [track.genre, track.mood].filter(Boolean).join(' · ')))),
  h('span', { class: 'row-genre' }, track.genre),
  h('span', { class: 'row-mood' }, track.mood),
  h('span', { class: 'row-bpm' }, track.bpm ? String(track.bpm) : ''),
  favButton(track, { className: 'row-fav' }),
  h('span', { class: 'row-time' }, track.duration ? formatTime(track.duration) : '–:––'),
  moreButton(track, { context, className: 'row-more' }));
}
