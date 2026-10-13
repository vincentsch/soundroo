// Shared library data, locally persisted settings and a tiny event bus.
import { normalizeTrack, normalizeCollection, normalizeJob, collectionLabel, isActiveJob, clamp } from './logic.js';

const listeners = new Map();

export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type)?.delete(fn);
}

export function emit(type, detail) {
  for (const fn of [...(listeners.get(type) ?? [])]) {
    try { fn(detail); } catch (error) { console.error(error); }
  }
}

export const data = {
  loaded: false,
  collection: null,
  directory: '',
  tracks: [],
  byId: new Map(),
  jobs: [],
  fetchedAt: 0,
};

export function setLibrary(payload) {
  const tracks = (Array.isArray(payload?.tracks) ? payload.tracks : []).map(normalizeTrack).filter(Boolean);
  // Keep collection order stable even if the server repeats an id.
  const byId = new Map();
  for (const track of tracks) if (!byId.has(track.id)) byId.set(track.id, track);
  data.tracks = [...byId.values()].map((track, index) => ({ ...track, index }));
  data.byId = new Map(data.tracks.map(track => [track.id, track]));
  data.collection = normalizeCollection(payload?.collection);
  data.directory = typeof payload?.directory === 'string' ? payload.directory : '';
  data.loaded = true;
  data.fetchedAt = Date.now();
  emit('library');
}

export function setJobList(list) {
  data.jobs = (Array.isArray(list) ? list : []).map(normalizeJob).filter(Boolean);
}

export const trackById = id => (id == null ? null : data.byId.get(String(id)) ?? null);
export const isPlayable = id => Boolean(trackById(id)?.rendered);
export const label = () => collectionLabel(data.collection);
// Built-in examples stay labelled as examples inside a personal collection.
export const isExampleInPersonal = track => track?.origin === 'example' && data.collection?.source !== 'examples';
export const trackLabel = track => (isExampleInPersonal(track) ? 'Example track' : label());
export const activeJob = trackId => data.jobs.find(job => job.trackId === String(trackId) && isActiveJob(job)) ?? null;
// The most recent render for a track, if it failed.
export function failedJob(trackId) {
  const latest = data.jobs.filter(job => job.trackId === String(trackId)).at(-1);
  return latest?.status === 'error' ? latest : null;
}

// --- settings -----------------------------------------------------------------

const SETTINGS_KEY = 'soundroo.settings.v1';
const DEFAULTS = {
  theme: 'system',
  visualizer: 'rings',
  reduceMotion: false,
  resume: true,
  volume: 0.8,
  muted: false,
  shuffle: false,
  repeat: 'off',
  sort: 'collection',
  last: null,
};
const CHOICES = {
  theme: ['system', 'light', 'dark'],
  visualizer: ['rings', 'bars', 'wave'],
  repeat: ['off', 'all', 'one'],
  sort: ['collection', 'title', 'duration', 'bpm'],
};

function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') ?? {}; } catch { saved = {}; }
  const out = { ...DEFAULTS };
  for (const [key, choices] of Object.entries(CHOICES)) if (choices.includes(saved[key])) out[key] = saved[key];
  for (const key of ['reduceMotion', 'resume', 'muted', 'shuffle']) if (typeof saved[key] === 'boolean') out[key] = saved[key];
  if (Number.isFinite(saved.volume)) out.volume = clamp(saved.volume, 0, 1);
  if (saved.last && typeof saved.last.trackId === 'string') {
    out.last = {
      trackId: saved.last.trackId,
      versionId: typeof saved.last.versionId === 'string' ? saved.last.versionId : null,
      time: Number.isFinite(saved.last.time) ? Math.max(0, saved.last.time) : 0,
    };
  }
  return out;
}

export const settings = loadSettings();

export function updateSettings(patch, { quiet = false } = {}) {
  Object.assign(settings, patch);
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode: keep in memory */ }
  if (!quiet) emit('settings', patch);
}

// Unsent brief on the Make music page.
const DRAFT_KEY = 'soundroo.brief-draft.v1';
export function loadDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null');
    return draft && typeof draft === 'object' ? draft : null;
  } catch {
    return null;
  }
}
export function saveDraft(draft) {
  try {
    if (draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else localStorage.removeItem(DRAFT_KEY);
  } catch { /* ignore */ }
}
