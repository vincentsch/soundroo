// The one audio element of the studio, its queue and the Web Audio analyser
// used by the visualizer. Playback only starts from a user action.
import { data, settings, updateSettings, trackById, isPlayable, emit, on, trackLabel } from './store.js';
import { Queue, clamp } from './logic.js';
import { toast, announce } from './dom.js';

export const audio = document.getElementById('audio');
export const queue = new Queue({ shuffle: settings.shuffle, repeat: settings.repeat });

export const state = {
  trackId: null,
  versionId: null,
  src: null,
  playing: false,
  waiting: false,
  error: null,
};

let graph = null;
let graphFailed = false;
let pendingSeek = null;
let suspendTimer = 0;
let lastRemembered = 0;
let lastPosition = 0;
let offeredSrc = null;

audio.loop = queue.repeat === 'one';

// --- queries ------------------------------------------------------------------

export const currentTrack = () => trackById(state.trackId);
export const isCurrent = id => state.trackId != null && state.trackId === String(id);
export const isPlayingTrack = id => isCurrent(id) && state.playing;
export const analyser = () => (graph && graph.ctx.state === 'running' ? graph.analyser : null);

export function currentTime() {
  return pendingSeek ?? (Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
}

export function duration() {
  if (Number.isFinite(audio.duration) && audio.duration > 0) return audio.duration;
  return currentTrack()?.duration ?? 0;
}

export function versionLabel() {
  if (!state.versionId) return '';
  return currentTrack()?.versions.find(v => v.id === state.versionId)?.label ?? 'Earlier version';
}

function sourceFor(track, versionId) {
  if (!track) return null;
  if (versionId) return track.versions.find(v => v.id === versionId)?.audioUrl ?? null;
  return track.rendered ? track.audioUrl : null;
}

const collectionIds = () => data.tracks.map(t => t.id);

// --- audio graph ----------------------------------------------------------------

function ensureGraph() {
  if (graph || graphFailed) return graph;
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) {
    graphFailed = true;
    return null;
  }
  try {
    const ctx = new Context({ latencyHint: 'playback' });
    const source = ctx.createMediaElementSource(audio);
    const node = ctx.createAnalyser();
    node.fftSize = 2048;
    node.smoothingTimeConstant = 0.8;
    const gain = ctx.createGain();
    source.connect(node);
    node.connect(gain);
    gain.connect(ctx.destination);
    graph = { ctx, analyser: node, gain };
    gain.gain.value = level();
    audio.volume = 1;
  } catch (error) {
    console.warn('Web Audio is unavailable; playing without the visualizer.', error);
    graphFailed = true;
    graph = null;
  }
  return graph;
}

function level() {
  return settings.muted ? 0 : settings.volume ** 2;
}

function applyVolume() {
  if (graph) {
    audio.volume = 1;
    const now = graph.ctx.currentTime;
    graph.gain.gain.cancelScheduledValues(now);
    graph.gain.gain.setTargetAtTime(level(), now, 0.015);
  } else {
    audio.volume = level();
  }
}

// Let the audio device sleep after a while of silence.
function scheduleSuspend(delay = 20000) {
  clearTimeout(suspendTimer);
  suspendTimer = setTimeout(() => {
    if (audio.paused && graph?.ctx.state === 'running') graph.ctx.suspend().catch(() => {});
  }, delay);
}

// --- transport ------------------------------------------------------------------

function load(trackId, { versionId = null, at = 0, autoplay = false } = {}) {
  const track = trackById(trackId);
  const url = sourceFor(track, versionId);
  if (!url) {
    emit('unplayable', track?.id ?? null);
    return false;
  }
  const changed = state.trackId !== track.id;
  state.trackId = track.id;
  state.versionId = versionId;
  state.src = url;
  state.error = null;
  state.waiting = autoplay;
  pendingSeek = at > 0.25 ? at : null;
  audio.src = url;
  updateMediaSession();
  remember(at);
  emit('player', { changed });
  if (autoplay) {
    play();
    if (changed) announce(`Playing ${track.title}`);
  }
  return true;
}

export function play() {
  // After a media error the element stays unusable; load the source again.
  if (!state.src || state.error) {
    if (state.trackId && load(state.trackId, { versionId: state.versionId, at: currentTime(), autoplay: true })) return;
    playContext(collectionIds());
    return;
  }
  clearTimeout(suspendTimer);
  // The analyser graph is created inside a user gesture so the browser lets
  // its audio context run; without one the element plays directly.
  const g = navigator.userActivation?.isActive === false ? graph : ensureGraph();
  if (g && g.ctx.state !== 'running') {
    g.ctx.resume().catch(() => {});
    setTimeout(() => {
      if (state.playing && g.ctx.state !== 'running') {
        toast('The browser is holding the sound back.', { action: { label: 'Resume sound', run: () => g.ctx.resume().catch(() => {}) } });
      }
    }, 900);
  }
  const attempt = audio.play();
  attempt?.catch(error => {
    if (error?.name === 'AbortError') return; // replaced by a newer track
    state.playing = false;
    state.waiting = false;
    emit('player');
    if (error?.name === 'NotAllowedError') toast('Press play to start listening.');
  });
}

export function pause() {
  audio.pause();
}

// Decisions use our own state: after an error the element can report
// paused === false while nothing plays.
export function toggle() {
  if (state.playing) pause();
  else play();
}

export function seek(time) {
  if (!state.src) return;
  const end = duration();
  const target = clamp(time, 0, end > 0 ? Math.max(0, end - 0.05) : Math.max(0, time));
  if (audio.readyState === 0) pendingSeek = target;
  else audio.currentTime = target;
  emit('time');
}

export const skip = seconds => seek(currentTime() + seconds);

// Plays `ids` in order (or shuffled), starting at `startId` when given.
export function playContext(ids, startId = null, { shuffle, at = 0 } = {}) {
  if (startId != null && !isPlayable(startId)) {
    emit('unplayable', String(startId));
    return false;
  }
  if (typeof shuffle === 'boolean' && shuffle !== settings.shuffle) updateSettings({ shuffle });
  queue.load(ids, startId, typeof shuffle === 'boolean' ? shuffle : queue.shuffle);
  if (!isPlayable(queue.current)) {
    const index = queue.nextIndex(isPlayable);
    if (index < 0) {
      emit('unplayable', null);
      return false;
    }
    queue.index = index;
  }
  return load(queue.current, { at, autoplay: true });
}

// Play or pause a track, or play it from `at`. The loaded file (current render
// or a version being compared) stays; starting another track uses `context`
// as the queue.
export function playTrack(id, { context, at } = {}) {
  id = String(id);
  if (isCurrent(id)) {
    if (at == null) toggle();
    else {
      seek(at);
      if (!state.playing) play();
    }
    return true;
  }
  return playContext(context ?? collectionIds(), id, { at: at ?? 0 });
}

export function next({ auto = false } = {}) {
  if (!state.trackId) return;
  const wasPlaying = auto || state.playing;
  const index = queue.nextIndex(isPlayable, { auto });
  if (index < 0) {
    if (auto) {
      audio.currentTime = 0;
      audio.pause();
      announce('End of the queue');
    } else {
      toast('That was the last track in the queue.');
    }
    return;
  }
  if (index === queue.index) {
    seek(0);
    if (wasPlaying) play();
    return;
  }
  queue.index = index;
  load(queue.current, { autoplay: wasPlaying });
}

export function previous() {
  if (!state.trackId) return;
  const wasPlaying = state.playing;
  if (currentTime() > 3) {
    seek(0);
    return;
  }
  const index = queue.prevIndex(isPlayable);
  if (index < 0 || index === queue.index) {
    seek(0);
    return;
  }
  queue.index = index;
  load(queue.current, { autoplay: wasPlaying });
}

// Jump to a position in the visible queue.
export function jumpTo(index) {
  const id = queue.items[index];
  if (!isPlayable(id)) {
    emit('unplayable', id ?? null);
    return;
  }
  queue.index = index;
  load(id, { autoplay: true });
}

// Switch between the current render and earlier versions at the same moment.
export function playVersion(trackId, versionId = null) {
  trackId = String(trackId);
  const track = trackById(trackId);
  if (!sourceFor(track, versionId)) {
    toast('That version’s audio isn’t available.', { tone: 'error' });
    return;
  }
  if (isCurrent(trackId)) {
    if (state.versionId === versionId) {
      toggle();
      return;
    }
    load(trackId, { versionId, at: currentTime(), autoplay: true });
    announce(versionId ? `Listening to ${versionLabel()}` : 'Listening to the current version');
    return;
  }
  queue.load(collectionIds(), trackId);
  load(trackId, { versionId, autoplay: true });
}

// --- queue editing ------------------------------------------------------------

export function playNext(id) {
  const track = trackById(id);
  if (!track) return;
  if (!state.trackId) {
    playContext([track.id], track.id);
    return;
  }
  if (!queue.playNext(track.id)) {
    toast(`“${track.title}” is already playing.`);
    return;
  }
  toast(`“${track.title}” plays next.`);
  emit('queue');
}

export function addToQueue(id) {
  const track = trackById(id);
  if (!track) return;
  if (!state.trackId) {
    playContext([track.id], track.id);
    return;
  }
  if (!queue.append(track.id)) {
    toast(`“${track.title}” is already playing.`);
    return;
  }
  toast(`Added “${track.title}” to the queue.`);
  emit('queue');
}

export function removeFromQueue(index) {
  if (queue.removeAt(index)) emit('queue');
}

export function moveInQueue(index, delta) {
  if (queue.move(index, delta)) emit('queue');
}

export function clearUpcoming() {
  queue.clearUpcoming();
  emit('queue');
}

export function setShuffle(on) {
  queue.setShuffle(on);
  updateSettings({ shuffle: on });
  emit('player');
  emit('queue');
  announce(on ? 'Shuffle on' : 'Shuffle off');
}

export function cycleRepeat() {
  const order = ['off', 'all', 'one'];
  const mode = order[(order.indexOf(queue.repeat) + 1) % order.length];
  queue.repeat = mode;
  audio.loop = mode === 'one';
  updateSettings({ repeat: mode });
  emit('player');
  announce(mode === 'off' ? 'Repeat off' : mode === 'all' ? 'Repeat all' : 'Repeat this track');
}

// --- volume -------------------------------------------------------------------

export function setVolume(value) {
  const volume = clamp(value, 0, 1);
  updateSettings({ volume, muted: volume === 0 ? settings.muted : false }, { quiet: true });
  applyVolume();
  emit('volume');
}

export function toggleMute() {
  updateSettings({ muted: !settings.muted }, { quiet: true });
  applyVolume();
  emit('volume');
  announce(settings.muted ? 'Muted' : 'Sound on');
}

// --- session ------------------------------------------------------------------

function remember(time = currentTime()) {
  if (!state.trackId) return;
  lastRemembered = Date.now();
  updateSettings({ last: { trackId: state.trackId, versionId: state.versionId, time: Math.max(0, Math.floor(time)) } }, { quiet: true });
}

// Reload the last track paused where the listener left it. No autoplay.
export function restore() {
  const last = settings.last;
  if (!settings.resume || !last || !isPlayable(last.trackId) || state.trackId) return;
  const track = trackById(last.trackId);
  const versionId = last.versionId && track.versions.some(v => v.id === last.versionId) ? last.versionId : null;
  queue.load(collectionIds(), track.id);
  load(track.id, { versionId, at: last.time < Math.max(0, track.duration - 5) || !track.duration ? last.time : 0 });
}

function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const track = currentTrack();
  if (!track) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: trackLabel(track),
      album: data.collection?.title ?? 'Soundroo',
      artwork: track.artworkUrl ? [{ src: new URL(track.artworkUrl, location.href).href, sizes: '800x800', type: 'image/svg+xml' }] : [],
    });
  } catch { /* metadata is optional */ }
}

function updatePositionState() {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  const total = audio.duration;
  if (!Number.isFinite(total) || total <= 0) return;
  try {
    navigator.mediaSession.setPositionState({ duration: total, position: clamp(audio.currentTime, 0, total), playbackRate: audio.playbackRate || 1 });
  } catch { /* ignore inconsistent states during loading */ }
}

if ('mediaSession' in navigator) {
  const handlers = {
    play: () => play(),
    pause: () => pause(),
    stop: () => { pause(); seek(0); },
    previoustrack: () => previous(),
    nexttrack: () => next(),
    seekbackward: details => skip(-(details?.seekOffset || 10)),
    seekforward: details => skip(details?.seekOffset || 10),
    seekto: details => { if (Number.isFinite(details?.seekTime)) seek(details.seekTime); },
  };
  for (const [action, handler] of Object.entries(handlers)) {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* unsupported action */ }
  }
}

// --- element events -------------------------------------------------------------

audio.addEventListener('play', () => {
  state.playing = true;
  clearTimeout(suspendTimer);
  emit('player');
});
audio.addEventListener('playing', () => {
  state.playing = true;
  state.waiting = false;
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  emit('player');
});
audio.addEventListener('pause', () => {
  state.playing = false;
  state.waiting = false;
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
  remember();
  scheduleSuspend();
  emit('player');
});
audio.addEventListener('waiting', () => {
  state.waiting = true;
  emit('player');
});
audio.addEventListener('canplay', () => {
  if (!state.waiting) return;
  state.waiting = false;
  emit('player');
});
audio.addEventListener('loadedmetadata', () => {
  if (pendingSeek != null) {
    const target = Math.min(pendingSeek, Math.max(0, audio.duration - 0.25));
    pendingSeek = null;
    try { audio.currentTime = target; } catch { /* keep the start */ }
  }
  updatePositionState();
  emit('time');
});
audio.addEventListener('durationchange', () => emit('time'));
audio.addEventListener('seeked', updatePositionState);
audio.addEventListener('timeupdate', () => {
  emit('time');
  const now = Date.now();
  if (now - lastPosition > 1000) {
    lastPosition = now;
    updatePositionState();
  }
  if (now - lastRemembered > 5000) remember();
});
audio.addEventListener('ended', () => next({ auto: true }));
audio.addEventListener('error', () => {
  if (!state.src || !audio.error) return;
  const track = currentTrack();
  const reasons = {
    2: 'The connection to the studio server dropped.',
    3: 'The audio file looks damaged. Rendering it again should fix it.',
    4: 'The audio file is missing or can’t be played. Rendering it again should fix it.',
  };
  state.error = reasons[audio.error.code] ?? 'The audio couldn’t be loaded.';
  state.playing = false;
  state.waiting = false;
  emit('player');
  const src = state.src;
  const at = currentTime();
  toast(`Couldn’t play “${track?.title ?? 'this track'}”. ${state.error}`, {
    tone: 'error',
    action: track ? { label: 'Try again', run: () => { if (state.src === src) load(track.id, { versionId: state.versionId, at, autoplay: true }); } } : null,
  });
});

window.addEventListener('pagehide', () => remember());
document.addEventListener('visibilitychange', () => {
  if (document.hidden && audio.paused) scheduleSuspend(1000);
});

// A finished render replaces the file of the loaded track.
on('library', () => {
  if (!state.trackId) return;
  const track = currentTrack();
  if (!track) {
    state.src = null;
    state.trackId = null;
    state.versionId = null;
    audio.removeAttribute('src');
    audio.load();
    emit('player', { changed: true });
    return;
  }
  updateMediaSession();
  if (state.versionId) {
    emit('player');
    return;
  }
  const url = sourceFor(track, null);
  if (url && url !== state.src) {
    if (!state.playing) {
      load(track.id, { at: currentTime() });
    } else if (offeredSrc !== url) {
      offeredSrc = url;
      toast(`A new render of “${track.title}” is ready.`, {
        action: { label: 'Listen now', run: () => { if (isCurrent(track.id)) load(track.id, { at: currentTime(), autoplay: true }); } },
      });
    }
  }
  emit('player');
});

applyVolume();
