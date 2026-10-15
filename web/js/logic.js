// Pure helpers for the listening studio. Nothing here touches the DOM, so the
// queue, formatting, filtering and score handling can be checked in Node.

export const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export function num(value, fallback = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

const text = value => (typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '');
const HEX = /^#[0-9a-f]{6}$/i;
export const PART_COLORS = ['#e0472b', '#2f8f83', '#e8a923', '#5867d6', '#c4589b', '#5aa469', '#8a6fd1', '#d9822b', '#3a9bc2', '#b5654a'];

// --- library data -------------------------------------------------------------

// Adds a query parameter without disturbing an existing query string.
export function withParam(url, key, value) {
  if (!url || value == null || value === '') return url;
  return `${url}${url.includes('?') ? '&' : '?'}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

export function normalizeTrack(raw, index = 0) {
  if (!raw || typeof raw !== 'object' || raw.id == null) return null;
  const revision = raw.revision == null || raw.revision === '' ? null : String(raw.revision);
  const allVersions = (Array.isArray(raw.versions) ? raw.versions : [])
    .filter(v => v && v.id != null && typeof v.audioUrl === 'string' && v.audioUrl)
    .map((v, i) => ({ id: String(v.id), label: text(v.label) || `Version ${i + 1}`, date: text(v.date), audioUrl: v.audioUrl, order: i }));
  const currentVersion = revision ? allVersions.find(v => v.id === revision) ?? null : null;
  // Play a URL that names the exact render, so a newer render never mixes
  // into a file that is already playing and the player can tell them apart.
  const plainUrl = typeof raw.audioUrl === 'string' && raw.audioUrl ? raw.audioUrl : null;
  const audioUrl = currentVersion?.audioUrl ?? withParam(plainUrl, 'rev', revision);
  const sections = (Array.isArray(raw.sections) ? raw.sections : [])
    .map(s => ({ name: text(s?.name) || 'Section', start: Math.max(0, num(s?.start)), end: num(s?.end, NaN) }))
    .filter(s => Number.isFinite(s.end) && s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const parts = (Array.isArray(raw.parts) ? raw.parts : [])
    .filter(p => p && p.id != null)
    .map((p, i) => ({
      id: String(p.id),
      name: text(p.name) || `Part ${i + 1}`,
      volume: Math.max(0, num(p.volume, 1)),
      pan: clamp(num(p.pan, 0), -1, 1),
      mute: Boolean(p.mute),
      solo: Boolean(p.solo),
      color: HEX.test(p.color ?? '') ? p.color : PART_COLORS[i % PART_COLORS.length],
      instrument: text(p.instrument),
      available: p.available !== false,
    }));
  // Earlier renders, newest first. The current render is not repeated here.
  const versions = allVersions
    .filter(v => v.id !== revision)
    .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0) || b.order - a.order)
    .map(({ order, ...v }) => v);
  const bpm = num(raw.bpm, 0);
  return {
    id: String(raw.id),
    index,
    title: text(raw.title) || 'Untitled',
    description: text(raw.description),
    genre: text(raw.genre),
    mood: text(raw.mood),
    bpm: bpm > 0 ? Math.round(bpm * 10) / 10 : null,
    key: text(raw.key),
    duration: Math.max(0, num(raw.duration)),
    rendered: Boolean(raw.rendered) && Boolean(audioUrl),
    favorite: Boolean(raw.favorite),
    audioUrl,
    artworkUrl: typeof raw.artworkUrl === 'string' && raw.artworkUrl ? raw.artworkUrl : null,
    waveform: (Array.isArray(raw.waveform) ? raw.waveform : []).map(v => clamp(num(v), 0, 1)),
    sections,
    parts,
    versions,
    revision,
    currentLabel: currentVersion?.label ?? '',
    currentDate: currentVersion?.date ?? '',
    origin: raw.origin === 'example' || raw.origin === 'personal' ? raw.origin : '',
    error: text(raw.error),
  };
}

// 'electric-piano' → 'Electric piano'
export function instrumentName(id) {
  const words = String(id ?? '').replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

export function normalizeCollection(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: text(raw.id),
    title: text(raw.title) || 'Untitled collection',
    description: text(raw.description),
    source: raw.source === 'examples' || raw.source === 'personal' ? raw.source : '',
  };
}

// Built-in examples are labelled as such everywhere they are named.
export function collectionLabel(collection) {
  if (collection?.source === 'examples') return 'Example collection';
  if (collection?.source === 'personal') return 'Your collection';
  return 'Collection';
}

const JOB_STATUSES = ['queued', 'running', 'done', 'error'];
export function normalizeJob(raw) {
  if (!raw || typeof raw !== 'object' || raw.id == null) return null;
  let progress = num(raw.progress, NaN);
  if (progress > 1) progress /= 100;
  return {
    id: String(raw.id),
    trackId: raw.trackId == null ? null : String(raw.trackId),
    status: JOB_STATUSES.includes(raw.status) ? raw.status : 'queued',
    type: raw.type === 'stems' ? 'stems' : 'render',
    progress: Number.isFinite(progress) ? clamp(progress, 0, 1) : null,
    error: text(raw.error) || text(raw.error?.message),
  };
}
export const isActiveJob = job => job?.status === 'queued' || job?.status === 'running';

export function normalizeFeedback(list) {
  return (Array.isArray(list) ? list : [])
    .filter(f => f && f.id != null && typeof f.text === 'string')
    .map(f => ({ id: String(f.id), text: f.text, time: Math.max(0, num(f.time)), date: text(f.date) }))
    .sort((a, b) => a.time - b.time);
}

export function normalizeRequest(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: text(raw.id),
    brief: typeof raw.brief === 'string' ? raw.brief : '',
    count: Math.max(1, Math.round(num(raw.count, 10))),
    path: text(raw.path),
    date: text(raw.date ?? raw.createdAt ?? raw.created),
    status: text(raw.status),
  };
}

// --- formatting ---------------------------------------------------------------

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '–:––';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = n => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// Accepts "83", "1:23", "1:23.5" or "0:01:23".
export function parseTime(value) {
  const parts = String(value ?? '').trim().split(':');
  if (!parts[0] || parts.length > 3 || parts.some(p => !/^\d+(\.\d+)?$/.test(p.trim()))) return null;
  if (parts.slice(1).some(p => Number(p) >= 60)) return null;
  return parts.reduce((total, p) => total * 60 + Number(p), 0);
}

export function formatTotal(seconds) {
  if (!(seconds > 0)) return '';
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function formatDb(gain) {
  if (!(gain > 0.0001)) return '−∞ dB';
  const db = 20 * Math.log10(gain);
  const value = Math.abs(db) < 0.05 ? 0 : db;
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)} dB`;
}

export function formatPan(pan, long = false) {
  const p = Math.round(clamp(num(pan), -1, 1) * 100);
  if (Math.abs(p) < 2) return long ? 'center' : 'C';
  return long ? `${Math.abs(p)}% ${p < 0 ? 'left' : 'right'}` : `${p < 0 ? 'L' : 'R'}${Math.abs(p)}`;
}

export function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function trackFacts(track) {
  return [track.genre, track.mood, track.bpm ? `${track.bpm} BPM` : '', track.key].filter(Boolean);
}

// --- browsing -----------------------------------------------------------------

const fold = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function matchesQuery(track, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = fold([track.title, track.description, track.genre, track.mood, track.key, track.bpm ? `${track.bpm} bpm` : ''].join(' '));
  return words.every(word => haystack.includes(word));
}

export function filterTracks(tracks, { query = '', genre = '', mood = '', favorites = false, status = '' } = {}) {
  return tracks.filter(t => matchesQuery(t, query)
    && (!genre || t.genre === genre)
    && (!mood || t.mood === mood)
    && (!favorites || t.favorite)
    && (!status || (status === 'unrendered' ? !t.rendered : t.rendered)));
}

export const SORTS = { collection: 'Collection order', title: 'Title', duration: 'Length', bpm: 'Tempo' };

export function sortTracks(tracks, sort = 'collection') {
  const list = tracks.slice();
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  const byIndex = (a, b) => a.index - b.index;
  if (sort === 'title') list.sort((a, b) => collator.compare(a.title, b.title) || byIndex(a, b));
  else if (sort === 'duration') list.sort((a, b) => a.duration - b.duration || byIndex(a, b));
  else if (sort === 'bpm') list.sort((a, b) => (a.bpm ?? Infinity) - (b.bpm ?? Infinity) || byIndex(a, b));
  else list.sort(byIndex);
  return list;
}

export function facet(tracks, key) {
  const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
  return [...new Set(tracks.map(t => t[key]).filter(Boolean))].sort(collator.compare);
}

export function sectionIndexAt(sections, time) {
  for (let i = sections.length - 1; i >= 0; i--) {
    if (time >= sections[i].start && time < sections[i].end) return i;
  }
  return -1;
}

// Peak-preserving resample of a normalized waveform to `count` bars.
export function resampleMax(values, count) {
  if (!values?.length || !(count > 0)) return [];
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const from = Math.floor((i * values.length) / count);
    const to = Math.max(from + 1, Math.floor(((i + 1) * values.length) / count));
    let peak = 0;
    for (let j = from; j < to && j < values.length; j++) peak = Math.max(peak, values[j]);
    out[i] = peak;
  }
  return out;
}

// --- queue --------------------------------------------------------------------

export function shuffled(items, random = Math.random) {
  const list = items.slice();
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// Play order of track ids. `order` keeps the listening context (collection or
// filtered list plus manual additions) so shuffle can be turned off again;
// `items` is what actually plays, `index` the current position in it.
export class Queue {
  constructor({ shuffle = false, repeat = 'off', random = Math.random } = {}) {
    this.items = [];
    this.order = [];
    this.index = -1;
    this.shuffle = shuffle;
    this.repeat = repeat;
    this.random = random;
  }

  get current() {
    return this.index >= 0 ? this.items[this.index] ?? null : null;
  }

  load(ids, startId = null, shuffle = this.shuffle) {
    const start = startId == null ? null : String(startId);
    const order = [...new Set(ids.map(String))];
    if (start && !order.includes(start)) order.unshift(start);
    this.order = order;
    this.shuffle = shuffle;
    if (shuffle) {
      const rest = shuffled(order.filter(id => id !== start), this.random);
      this.items = start ? [start, ...rest] : rest;
      this.index = this.items.length ? 0 : -1;
    } else {
      this.items = order.slice();
      this.index = this.items.length ? Math.max(0, start ? this.items.indexOf(start) : 0) : -1;
    }
    return this.current;
  }

  setShuffle(on) {
    if (on === this.shuffle) return;
    this.shuffle = on;
    const current = this.current;
    if (on) {
      const rest = shuffled(this.order.filter(id => id !== current), this.random);
      this.items = current ? [current, ...rest] : rest;
      this.index = current ? 0 : -1;
    } else {
      this.items = this.order.slice();
      this.index = current ? this.items.indexOf(current) : -1;
    }
  }

  nextIndex(playable, { auto = false } = {}) {
    if (auto && this.repeat === 'one' && this.current && playable(this.current)) return this.index;
    for (let i = this.index + 1; i < this.items.length; i++) if (playable(this.items[i])) return i;
    if (this.repeat !== 'off') {
      for (let i = 0; i <= this.index && i < this.items.length; i++) if (playable(this.items[i])) return i;
    }
    return -1;
  }

  prevIndex(playable) {
    for (let i = this.index - 1; i >= 0; i--) if (playable(this.items[i])) return i;
    if (this.repeat !== 'off') {
      for (let i = this.items.length - 1; i > this.index; i--) if (playable(this.items[i])) return i;
    }
    return -1;
  }

  playNext(id) {
    id = String(id);
    if (id === this.current) return false;
    this.#remove(id);
    this.items.splice(this.index + 1, 0, id);
    const at = this.current ? this.order.indexOf(this.current) + 1 : 0;
    this.order.splice(at, 0, id);
    return true;
  }

  append(id) {
    id = String(id);
    if (id === this.current) return false;
    this.#remove(id);
    this.items.push(id);
    this.order.push(id);
    return true;
  }

  removeAt(i) {
    if (i === this.index || i < 0 || i >= this.items.length) return false;
    this.#remove(this.items[i]);
    return true;
  }

  move(i, delta) {
    const j = i + delta;
    if (i <= this.index || j <= this.index || i >= this.items.length || j >= this.items.length) return false;
    [this.items[i], this.items[j]] = [this.items[j], this.items[i]];
    if (!this.shuffle) this.order = this.items.slice();
    return true;
  }

  clearUpcoming() {
    const removed = new Set(this.items.slice(this.index + 1));
    this.items = this.items.slice(0, this.index + 1);
    this.order = this.order.filter(id => !removed.has(id));
  }

  upcoming() {
    return this.items.slice(this.index + 1);
  }

  #remove(id) {
    const i = this.items.indexOf(id);
    if (i >= 0) {
      this.items.splice(i, 1);
      if (i < this.index) this.index--;
    }
    const j = this.order.indexOf(id);
    if (j >= 0) this.order.splice(j, 1);
  }
}

// --- mixing -------------------------------------------------------------------

// Matches the studio server's accepted range: linear gain 0–2, 1 = as composed.
export const VOLUME_MAX = 2;

// Saved mix values win, then the part's own defaults.
export function normalizeMix(mix, parts) {
  const out = { parts: {}, master: { volume: clamp(num(mix?.master?.volume, 1), 0, VOLUME_MAX) } };
  for (const part of parts) {
    const saved = mix?.parts?.[part.id] ?? {};
    out.parts[part.id] = {
      volume: clamp(num(saved.volume, part.volume ?? 1), 0, VOLUME_MAX),
      pan: clamp(num(saved.pan, part.pan ?? 0), -1, 1),
      mute: Boolean(saved.mute ?? part.mute),
      solo: Boolean(saved.solo ?? part.solo),
    };
  }
  return out;
}

export const sameMix = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Whether a part is heard once mute and solo are applied.
export function audibleParts(mix) {
  const entries = Object.entries(mix.parts);
  const soloing = entries.some(([, p]) => p.solo);
  return new Set(entries.filter(([, p]) => !p.mute && (!soloing || p.solo)).map(([id]) => id));
}

// --- arrangement --------------------------------------------------------------

// Note events for the arrangement view. Accepts {pitch, beat, duration} in
// quarter-note beats (the MIDI encoder's shape) or {pitch, time|start,
// duration|length} in seconds, from detail.arrangement.parts, score.parts or
// score.tracks.
export function arrangementLanes(track, detail, { maxNotes = 24000 } = {}) {
  const source = [detail?.arrangement?.parts, detail?.score?.parts, detail?.score?.tracks].find(Array.isArray) ?? [];
  const bpm = num(detail?.arrangement?.bpm, num(detail?.score?.bpm, num(track?.bpm, 120))) || 120;
  const secondsPerBeat = 60 / bpm;
  const parts = track?.parts?.length
    ? track.parts
    : source.filter(p => p && (p.id != null || p.name)).map((p, i) => ({ id: String(p.id ?? p.name), name: text(p.name) || `Part ${i + 1}`, color: PART_COLORS[i % PART_COLORS.length] }));
  let budget = maxNotes;
  let hasNotes = false;
  const lanes = parts.map(part => {
    const match = source.find(p => p && p.id != null && String(p.id) === part.id)
      ?? source.find(p => p && text(p.name).toLowerCase() === part.name.toLowerCase());
    const notes = [];
    for (const raw of partEvents(match, maxNotes)) {
      if (budget <= 0) break;
      const note = noteEvent(raw, secondsPerBeat);
      if (note) { notes.push(note); budget--; }
    }
    if (notes.length) hasNotes = true;
    const pitches = notes.map(n => n.pitch).filter(Number.isFinite);
    return { id: part.id, name: part.name, color: part.color, instrument: part.instrument ?? '', notes, low: pitches.length ? Math.min(...pitches) : 0, high: pitches.length ? Math.max(...pitches) : 0 };
  });
  return { lanes, hasNotes, bpm };
}

// A part's own notes plus its pattern clips, as the score compiler expands them.
function partEvents(part, limit) {
  if (!part || typeof part !== 'object') return [];
  const events = Array.isArray(part.notes) ? part.notes.slice(0, limit) : [];
  const patterns = part.patterns && typeof part.patterns === 'object' ? part.patterns : {};
  for (const clip of Array.isArray(part.clips) ? part.clips : []) {
    const pattern = patterns[clip?.pattern];
    if (!pattern || !Array.isArray(pattern.notes)) continue;
    const length = num(pattern.beats, 0);
    const repeat = Math.max(1, Math.floor(num(clip.repeat, 1)));
    const start = num(clip.beat, 0);
    const transpose = num(clip.transpose, 0);
    const velocity = num(clip.velocity, 1);
    for (let r = 0; r < repeat && events.length < limit; r++) {
      for (const n of pattern.notes) {
        if (events.length >= limit) break;
        const pitch = parsePitch(n?.pitch);
        events.push({ ...n, pitch: pitch == null ? null : pitch + transpose, beat: start + r * length + num(n?.beat, 0), velocity: num(n?.velocity, 0.7) * velocity });
      }
    }
  }
  return events;
}

// MIDI number or scientific pitch name such as 'C#4'.
export function parsePitch(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const match = /^([A-Ga-g])([#b]?)(-?\d{1,2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1].toUpperCase()];
  return (Number(match[3]) + 1) * 12 + pc + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
}

function noteEvent(raw, secondsPerBeat) {
  if (!raw || typeof raw !== 'object') return null;
  const pitch = parsePitch(raw.pitch ?? raw.midi ?? raw.note) ?? NaN;
  let start;
  let length;
  if (raw.beat != null) {
    start = num(raw.beat, NaN) * secondsPerBeat;
    length = num(raw.duration ?? raw.length ?? raw.dur, 0.25) * secondsPerBeat;
  } else {
    start = num(raw.time ?? raw.start, NaN);
    length = num(raw.duration ?? raw.length ?? raw.dur, 0.2);
  }
  if (!Number.isFinite(start) || start < 0) return null;
  return { pitch: Number.isFinite(pitch) ? pitch : null, start, length: Math.max(0.02, length), velocity: clamp(num(raw.velocity, 0.7), 0, 1) };
}

// --- making music -------------------------------------------------------------

export const FEELS = ['Driving', 'Bright', 'Playful', 'Funky', 'Dark', 'Dreamy', 'Cinematic', 'Warm', 'Calm'];
export const LENGTHS = { '': 'Let the agent decide', short: 'About 2 minutes each', medium: 'About 3 to 4 minutes each', long: 'About 5 minutes or longer each' };
export const VOICES = { auto: 'Let the agent decide', instrumental: 'Instrumental only', spoken: 'Spoken-word textures welcome' };

export function trackCount(value) {
  return clamp(Math.round(num(value, 1)), 1, 20);
}

// The brief as stored with a saved request: the user's words plus the options
// they picked, without the generic working instructions.
export function composeBrief({ brief = '', feel = [], length = '', voice = 'auto' } = {}) {
  const lines = [String(brief).trim()];
  if (feel.length) lines.push(`Feel: ${feel.map(f => f.toLowerCase()).join(', ')}.`);
  if (length && LENGTHS[length]) lines.push(`Length: ${LENGTHS[length].toLowerCase()}.`);
  if (voice === 'spoken') lines.push('Voice: spoken-word textures, rhythmic chops or vocoder effects are welcome. No sung vocals.');
  else if (voice === 'instrumental') lines.push('Voice: instrumental only.');
  return lines.filter(Boolean).join('\n');
}

const WORKING_NOTES = "Work in the Soundroo repository and follow its AGENTS.md. Compose original motifs and develop them; don't recreate existing melodies. Keep every score editable, render and check each track, then start the studio and send me its URL.";

export function buildPrompt(options = {}) {
  const count = trackCount(options.count);
  return [
    count === 1 ? 'Make one original Soundroo track.' : `Make a Soundroo collection of ${plural(count, 'original track')}.`,
    '',
    'Brief:',
    String(options.brief ?? '').trim() ? composeBrief(options) : '(Describe the music here.)',
    '',
    options.library ? `The current music library is ${JSON.stringify(options.library)}. Keep it intact and create a new personal collection beside it.` : null,
    WORKING_NOTES,
  ].filter(line => line !== null).join('\n');
}

export function followUpPrompt(request) {
  const where = request.path ? `saved at ${JSON.stringify(request.path)}` : 'I saved in the Soundroo studio';
  return `Please compose the music request ${where} (${plural(request.count || 1, 'track')}). ${WORKING_NOTES}`;
}

// --- color --------------------------------------------------------------------

// The dominant color and two distinct vivid accents of an RGBA pixel array.
export function paletteFromPixels(pixels) {
  const buckets = new Map();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const key = ((pixels[i] >> 4) << 8) | ((pixels[i + 1] >> 4) << 4) | (pixels[i + 2] >> 4);
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    bucket.r += pixels[i];
    bucket.g += pixels[i + 1];
    bucket.b += pixels[i + 2];
    bucket.n++;
    buckets.set(key, bucket);
  }
  const colors = [...buckets.values()].map(b => ({ r: b.r / b.n, g: b.g / b.n, b: b.b / b.n, n: b.n })).sort((a, b) => b.n - a.n);
  if (!colors.length) return null;
  const distance = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
  const vivid = c => {
    const max = Math.max(c.r, c.g, c.b);
    const min = Math.min(c.r, c.g, c.b);
    return ((max - min) / 255) * 0.7 + (max / 255) * 0.3;
  };
  const background = colors[0];
  const candidates = colors.filter(c => distance(c, background) > 70)
    .sort((a, b) => vivid(b) * Math.sqrt(b.n) - vivid(a) * Math.sqrt(a.n));
  const accent = candidates[0] ?? { r: 255 - background.r, g: 255 - background.g, b: 255 - background.b };
  const accent2 = candidates.find(c => distance(c, accent) > 60) ?? accent;
  const css = c => `rgb(${Math.round(c.r)} ${Math.round(c.g)} ${Math.round(c.b)})`;
  return { background: css(background), accent: css(accent), accent2: css(accent2), dark: luminance(background) < 0.35 };
}

export function luminance({ r, g, b }) {
  const channel = v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function hashHue(value) {
  let hash = 0;
  for (const char of String(value ?? '')) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return hash % 360;
}
