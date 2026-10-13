// Binds every transport control in the page (player bar, full-screen view)
// declared in index.html with data-action and data-bind attributes.
import { settings, on, trackLabel } from './store.js';
import { $$, artwork } from './dom.js';
import { formatTime, clamp } from './logic.js';
import { toggleFavorite } from './actions.js';
import { openNoteDialog } from './dialogs.js';
import * as player from './player.js';

const actions = {
  toggle: () => player.toggle(),
  previous: () => player.previous(),
  next: () => player.next(),
  shuffle: () => player.setShuffle(!player.queue.shuffle),
  repeat: () => player.cycleRepeat(),
  mute: () => player.toggleMute(),
  favorite: () => { if (player.state.trackId) toggleFavorite(player.state.trackId); },
  note: () => { if (player.state.trackId) openNoteDialog(player.state.trackId, player.currentTime()); },
};

// Other modules register queue and full-screen toggles.
export function registerAction(name, fn) {
  actions[name] = fn;
}

document.addEventListener('click', event => {
  const control = event.target.closest('[data-action]');
  if (!control || control.disabled) return;
  const run = actions[control.dataset.action];
  if (!run) return;
  event.preventDefault();
  run(control);
});

// --- seek and volume ---------------------------------------------------------------

const scrubbing = new Set();

function setFill(input, fraction) {
  input.style.setProperty('--fill', `${clamp(fraction, 0, 1) * 100}%`);
}

for (const input of $$('[data-bind="seek"]')) {
  input.addEventListener('input', () => {
    scrubbing.add(input);
    const total = player.duration();
    setFill(input, total > 0 ? Number(input.value) / total : 0);
    for (const el of $$('[data-bind="elapsed"]', input.closest('[data-transport]') ?? document)) el.textContent = formatTime(Number(input.value));
  });
  input.addEventListener('change', () => {
    scrubbing.delete(input);
    player.seek(Number(input.value));
  });
  input.addEventListener('blur', () => scrubbing.delete(input));
  input.addEventListener('keydown', event => {
    const steps = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -30, PageUp: 30 };
    if (!(event.key in steps) && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const total = player.duration();
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? total - 1 : player.currentTime() + steps[event.key];
    player.seek(clamp(target, 0, Math.max(0, total)));
  });
}

for (const input of $$('[data-bind="volume"]')) {
  input.addEventListener('input', () => player.setVolume(Number(input.value)));
}

// --- sync ---------------------------------------------------------------------------

export function syncTime() {
  const total = player.duration();
  const now = player.currentTime();
  const fraction = total > 0 ? now / total : 0;
  for (const input of $$('[data-bind="seek"]')) {
    if (scrubbing.has(input)) continue;
    input.max = String(total > 0 ? total : 1);
    input.value = String(now);
    input.disabled = !player.state.src;
    input.setAttribute('aria-valuetext', `${formatTime(now)} of ${formatTime(total)}`);
    setFill(input, fraction);
  }
  for (const bar of $$('[data-bind="progress"]')) bar.style.setProperty('--fill', `${clamp(fraction, 0, 1) * 100}%`);
  for (const el of $$('[data-bind="elapsed"]')) {
    if (![...scrubbing].some(input => input.closest('[data-transport]')?.contains(el))) el.textContent = player.state.src ? formatTime(now) : '–:––';
  }
  for (const el of $$('[data-bind="remaining"]')) el.textContent = player.state.src && total > 0 ? `−${formatTime(Math.max(0, total - now))}` : '–:––';
}

export function syncTransport() {
  const track = player.currentTrack();
  const has = Boolean(track);
  const playing = player.state.playing;
  const repeat = player.queue.repeat;
  for (const button of $$('[data-action="toggle"]')) {
    button.dataset.state = player.state.waiting && playing ? 'loading' : playing ? 'playing' : 'paused';
    button.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    button.title = playing ? 'Pause (Space)' : 'Play (Space)';
  }
  for (const button of $$('[data-action="previous"], [data-action="next"], [data-action="note"]')) button.disabled = !has;
  for (const button of $$('[data-action="shuffle"]')) button.setAttribute('aria-pressed', String(player.queue.shuffle));
  for (const button of $$('[data-action="repeat"]')) {
    button.dataset.mode = repeat;
    const text = repeat === 'one' ? 'Repeat: this track' : repeat === 'all' ? 'Repeat: all' : 'Repeat: off';
    button.setAttribute('aria-label', text);
    button.title = text;
  }
  for (const button of $$('[data-action="favorite"]')) {
    button.disabled = !has;
    button.setAttribute('aria-pressed', String(Boolean(track?.favorite)));
    button.setAttribute('aria-label', has ? `Favorite “${track.title}”` : 'Favorite');
  }
  for (const el of $$('[data-bind="title"]')) el.textContent = track?.title ?? 'Not playing';
  for (const link of $$('[data-bind="title-link"]')) {
    if (has) link.setAttribute('href', `#/track/${encodeURIComponent(track.id)}`);
    else link.removeAttribute('href');
  }
  const version = player.versionLabel();
  for (const el of $$('[data-bind="subtitle"]')) {
    el.textContent = has ? [trackLabel(track), version ? `Comparing: ${version}` : '', player.state.error ? 'Couldn’t load the audio' : ''].filter(Boolean).join(' · ') : 'Choose something to play';
  }
  for (const holder of $$('[data-bind="art"]')) {
    if (holder.dataset.trackId === (track?.id ?? '')) continue;
    holder.dataset.trackId = track?.id ?? '';
    holder.replaceChildren(has ? artwork(track, { tag: 'span', eager: true }) : holder.dataset.emptyArt ? document.getElementById('logo-template').content.cloneNode(true) : '');
  }
  for (const root of $$('[data-transport]')) {
    root.classList.toggle('is-idle', !has);
    root.classList.toggle('is-playing', playing);
  }
  syncVolume();
  syncTime();
}

export function syncVolume() {
  const level = settings.muted ? 0 : settings.volume;
  for (const input of $$('[data-bind="volume"]')) {
    input.value = String(level);
    input.setAttribute('aria-valuetext', settings.muted ? 'Muted' : `${Math.round(settings.volume * 100)}%`);
    setFill(input, level);
  }
  for (const button of $$('[data-action="mute"]')) {
    button.dataset.level = settings.muted || settings.volume === 0 ? 'mute' : settings.volume < 0.5 ? 'low' : 'high';
    button.setAttribute('aria-pressed', String(settings.muted));
    button.title = settings.muted ? 'Sound off. Press to unmute (M)' : 'Mute (M)';
  }
}

on('player', syncTransport);
on('time', syncTime);
on('volume', syncVolume);
on('favorite', id => { if (player.isCurrent(id)) syncTransport(); });
on('library', syncTransport);
