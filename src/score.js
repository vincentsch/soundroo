import { getCatalog, SAMPLE_ASSETS, SAMPLE_EFFECTS, SCORE_LIMITS, SPEECH_VOICES, DEFAULT_SPEECH_VOICE } from './catalog.js';
import { parsePitch, parseLine, parseSteps } from './notation.js';

export { parsePitch };
export const SCORE_VERSIONS = Object.freeze([1, 2]);
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const instruments = new Map(getCatalog().instruments.map(item => [item.id, item]));

// Speech text is compared and cached after collapsing whitespace.
export function speechText(text) { return text.trim().replace(/\s+/g, ' '); }

// Version 2 adds pattern strings (see notation.js). Both versions compile to
// the same ordinary version 1 note lists; older engines refuse version 2
// instead of silently dropping the notes its strings describe.
function normalize(score) {
  const issues = [];
  const issue = (path, message) => issues.push({ path, message });
  const number = (value, path, min, max, fallback, exclusive = false) => {
    const v = value === undefined ? fallback : value;
    if (!Number.isFinite(v) || (exclusive ? v <= min : v < min) || v > max) {
      issue(path, `Expected a finite number ${exclusive ? 'greater than' : 'at least'} ${min} and at most ${max}.`);
      return fallback ?? min;
    }
    return v;
  };
  const id = (value, path) => { if (typeof value !== 'string' || !slug.test(value) || value.length > 80) issue(path, 'Expected a lowercase slug ID, up to 80 characters.'); return value; };
  const text = (value, path, fallback = '') => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || value.length > 4000) { issue(path, 'Expected text up to 4000 characters.'); return fallback; }
    return value;
  };
  if (!object(score)) return { issues: [{ path: '$', message: 'Expected a score object.' }] };
  if (!SCORE_VERSIONS.includes(score.version)) issue('version', 'Use score version 1, or version 2 for pattern strings.');
  const compact = score.version === 2;
  const bpm = number(score.bpm, 'bpm', 20, 400);
  const beats = number(score.beats, 'beats', 0, SCORE_LIMITS.maxSeconds * bpm / 60, undefined, true);
  const out = { version: 1, id: id(score.id, 'id'), title: text(score.title, 'title'), description: text(score.description, 'description'), genre: text(score.genre, 'genre'), mood: text(score.mood, 'mood'), key: text(score.key, 'key'), bpm, beats, seed: number(score.seed, 'seed', 0, 0xffffffff, 1), master: {}, sections: [], parts: [] };
  if (!out.title.trim()) issue('title', 'A score needs a title.');
  if (!Number.isInteger(out.seed)) issue('seed', 'Expected an integer seed.');
  const master = score.master ?? {};
  if (!object(master)) issue('master', 'Expected a master controls object.');
  out.master.volume = number(master?.volume, 'master.volume', 0, 2, 0.8);
  out.master.reverb = number(master?.reverb, 'master.reverb', 0, 1, 0.2);
  if (score.sections !== undefined && !Array.isArray(score.sections)) issue('sections', 'Expected an array of sections.');
  const sections = Array.isArray(score.sections) ? score.sections : [];
  if (sections.length > 256) issue('sections', 'Use at most 256 sections.');
  const sectionIds = new Set();
  for (const [i, s] of sections.slice(0, 256).entries()) {
    const path = `sections[${i}]`;
    if (!object(s)) { issue(path, 'Expected a section object.'); continue; }
    const normalized = { id: id(s.id, `${path}.id`), name: text(s.name, `${path}.name`), beat: number(s.beat, `${path}.beat`, 0, beats), beats: number(s.beats, `${path}.beats`, 0, beats, undefined, true) };
    if (sectionIds.has(s.id)) issue(`${path}.id`, 'Section IDs must be unique.');
    sectionIds.add(s.id);
    if (normalized.beat + normalized.beats > beats + 1e-8) issue(path, 'Section extends past the score ending.');
    out.sections.push(normalized);
  }
  out.sections.sort((a, b) => a.beat - b.beat);
  if (!Array.isArray(score.parts) || !score.parts.length || score.parts.length > SCORE_LIMITS.maxParts) issue('parts', `Expected 1–${SCORE_LIMITS.maxParts} parts.`);
  let eventCount = 0, sourceNoteCount = 0;
  const partIds = new Set();
  const notes = (list, path, end) => {
    if (list === undefined) return [];
    if (!Array.isArray(list)) { issue(path, 'Expected an array of notes.'); return []; }
    const available = Math.max(0, SCORE_LIMITS.maxEvents - sourceNoteCount);
    sourceNoteCount += list.length;
    if (sourceNoteCount > SCORE_LIMITS.maxEvents) issue(path, 'Score source exceeds 100000 note events, including pattern definitions.');
    return list.slice(0, available).flatMap((note, i) => {
      const p = `${path}[${i}]`;
      if (!object(note)) { issue(p, 'Expected a note object.'); return []; }
      let pitch = 60;
      try { pitch = parsePitch(note.pitch); } catch (error) { issue(`${p}.pitch`, error.message); }
      const beat = number(note.beat, `${p}.beat`, 0, end);
      const duration = number(note.duration, `${p}.duration`, 0, end, undefined, true);
      const velocity = number(note.velocity, `${p}.velocity`, 0, 1, 0.7, true);
      if (beat + duration > end + 1e-8) issue(p, 'Note extends past its score or pattern ending.');
      return [{ pitch, beat, duration, velocity }];
    });
  };
  const strings = (pattern, path, end) => {
    const fields = ['line', 'steps'].filter(field => pattern[field] !== undefined);
    if (!compact) { for (const field of fields) issue(`${path}.${field}`, 'Pattern strings need score version 2.'); return []; }
    if (pattern.pitch !== undefined && pattern.steps === undefined) issue(`${path}.pitch`, 'pitch sets the note of steps hits; use it with steps.');
    const result = [];
    for (const field of fields) {
      const source = pattern[field];
      if (typeof source !== 'string' || source.length > SCORE_LIMITS.maxNotationCharacters) { issue(`${path}.${field}`, `Expected a string up to ${SCORE_LIMITS.maxNotationCharacters} characters.`); continue; }
      let pitch = 60;
      if (field === 'steps' && pattern.pitch !== undefined) { try { pitch = parsePitch(pattern.pitch); } catch (error) { issue(`${path}.pitch`, error.message); } }
      const parsed = field === 'line' ? parseLine(source, end) : parseSteps(source, end, pitch);
      for (const message of parsed.issues) issue(`${path}.${field}`, message);
      result.push(...parsed.notes);
    }
    const available = Math.max(0, SCORE_LIMITS.maxEvents - sourceNoteCount);
    sourceNoteCount += result.length;
    if (sourceNoteCount > SCORE_LIMITS.maxEvents) issue(path, 'Score source exceeds 100000 note events, including pattern definitions.');
    return result.slice(0, available);
  };
  const recipes = new Set();
  const speech = (recipe, path) => {
    if (!object(recipe)) { issue(path, 'Expected a speech recipe {text, voice}.'); return { text: '', voice: DEFAULT_SPEECH_VOICE }; }
    for (const key of Object.keys(recipe)) if (key !== 'text' && key !== 'voice') issue(`${path}.${key}`, 'Speech recipes contain text and voice only.');
    const words = typeof recipe.text === 'string' ? speechText(recipe.text) : '';
    if (!words || words.length > SCORE_LIMITS.maxSpeechCharacters) issue(`${path}.text`, `Write the words to speak, up to ${SCORE_LIMITS.maxSpeechCharacters} characters.`);
    const voice = recipe.voice ?? DEFAULT_SPEECH_VOICE;
    if (!SPEECH_VOICES.includes(voice)) issue(`${path}.voice`, `Use a Kokoro voice such as af_heart or am_michael; the catalog lists all ${SPEECH_VOICES.length}.`);
    recipes.add(JSON.stringify([words, voice]));
    if (recipes.size === SCORE_LIMITS.maxSpeechRecipes + 1) issue(path, `Use at most ${SCORE_LIMITS.maxSpeechRecipes} different speech recipes in one score.`);
    return { text: words, voice };
  };
  for (const [i, part] of (Array.isArray(score.parts) ? score.parts.slice(0, SCORE_LIMITS.maxParts) : []).entries()) {
    const path = `parts[${i}]`;
    if (!object(part)) { issue(path, 'Expected a part object.'); continue; }
    const preset = instruments.get(part.instrument);
    if (!preset) issue(`${path}.instrument`, 'Unknown instrument. Use getCatalog() to discover presets.');
    const p = { id: id(part.id, `${path}.id`), name: text(part.name, `${path}.name`, part.id), instrument: part.instrument, volume: number(part.volume, `${path}.volume`, 0, 2, 1), pan: number(part.pan, `${path}.pan`, -1, 1, 0), color: text(part.color, `${path}.color`, '#8aaea0'), tone: {}, notes: notes(part.notes, `${path}.notes`, beats) };
    if (partIds.has(part.id)) issue(`${path}.id`, 'Part IDs must be unique.');
    partIds.add(part.id);
    for (const field of ['line', 'steps']) if (part[field] !== undefined) issue(`${path}.${field}`, 'Put line and steps strings in a named pattern (score version 2), then place it with a clip.');
    if (part.tone !== undefined && !object(part.tone)) issue(`${path}.tone`, 'Expected a tone controls object.');
    for (const [name, value] of Object.entries(object(part.tone) ? part.tone : {})) {
      const spec = preset?.controls[name];
      if (!spec) issue(`${path}.tone.${name}`, 'This instrument does not support that tone control.');
      else p.tone[name] = number(value, `${path}.tone.${name}`, spec.min, spec.max, spec.default);
    }
    const patterns = part.patterns ?? {};
    if (!object(patterns)) issue(`${path}.patterns`, 'Expected a map of named patterns.');
    const patternMap = new Map();
    if (object(patterns)) {
      if (Object.keys(patterns).length > SCORE_LIMITS.maxPatterns) issue(`${path}.patterns`, 'Use at most 128 patterns per part.');
      for (const [name, pattern] of Object.entries(patterns).slice(0, SCORE_LIMITS.maxPatterns)) {
        const pp = `${path}.patterns.${name}`;
        if (!slug.test(name)) issue(pp, 'Pattern names must be lowercase slug tokens.');
        if (!object(pattern)) { issue(pp, 'Expected a pattern object.'); continue; }
        const length = number(pattern.beats, `${pp}.beats`, 0, beats, undefined, true);
        const patternNotes = notes(pattern.notes, `${pp}.notes`, length);
        patternNotes.push(...strings(pattern, pp, length));
        patternMap.set(name, { beats: length, notes: patternNotes });
      }
    }
    const clips = part.clips ?? [];
    if (!Array.isArray(clips)) issue(`${path}.clips`, 'Expected an array of clips.');
    if (Array.isArray(clips) && clips.length > SCORE_LIMITS.maxClips) issue(`${path}.clips`, 'Too many pattern clips.');
    for (const [j, clip] of (Array.isArray(clips) ? clips.slice(0, SCORE_LIMITS.maxClips) : []).entries()) {
      const cp = `${path}.clips[${j}]`;
      if (!object(clip)) { issue(cp, 'Expected a clip object.'); continue; }
      const pattern = patternMap.get(clip.pattern);
      if (!pattern) { issue(`${cp}.pattern`, 'Unknown pattern name.'); continue; }
      const beat = number(clip.beat, `${cp}.beat`, 0, beats);
      const repeat = number(clip.repeat, `${cp}.repeat`, 1, 4096, 1);
      const transpose = number(clip.transpose, `${cp}.transpose`, -127, 127, 0);
      const velocity = number(clip.velocity, `${cp}.velocity`, 0, 2, 1, true);
      if (!Number.isInteger(repeat)) issue(`${cp}.repeat`, 'Expected an integer repeat count.');
      if (!Number.isInteger(transpose)) issue(`${cp}.transpose`, 'Expected an integer semitone transposition.');
      if (beat + pattern.beats * repeat > beats + 1e-8) issue(cp, 'Clip extends past the score ending.');
      if (eventCount + p.notes.length + pattern.notes.length * repeat > SCORE_LIMITS.maxEvents) { issue(cp, 'Expanded score exceeds 100000 events.'); continue; }
      for (let r = 0; r < repeat; r++) for (const n of pattern.notes) {
        const expanded = { ...n, pitch: n.pitch + transpose, beat: beat + r * pattern.beats + n.beat, velocity: n.velocity * velocity };
        if (expanded.pitch < 0 || expanded.pitch > 127) issue(cp, 'Transposed pitch falls outside MIDI 0–127.');
        if (expanded.velocity > 1) issue(cp, 'Scaled note velocity exceeds 1.');
        p.notes.push(expanded);
      }
    }
    eventCount += p.notes.length;
    if (eventCount > SCORE_LIMITS.maxEvents) issue(`${path}.notes`, 'Expanded score exceeds 100000 events.');
    p.notes.sort((a, b) => a.beat - b.beat || a.pitch - b.pitch);
    if (part.instrument === 'sample') {
      const sample = part.sample;
      if (!object(sample)) issue(`${path}.sample`, 'Sample parts need a sample configuration.');
      else {
        const sp = `${path}.sample`;
        let source;
        if (sample.speech !== undefined) {
          if (sample.asset !== undefined) issue(sp, 'Use either an asset or a speech recipe, not both.');
          source = { speech: speech(sample.speech, `${sp}.speech`) };
        } else {
          const builtin = typeof sample.asset === 'string' && sample.asset.startsWith('builtin:');
          const local = typeof sample.asset === 'string' && /^assets\/(?:[^/\\]+\/)*[^/\\]+\.wav$/i.test(sample.asset) && !sample.asset.split('/').some(s => s === '..' || s === '.');
          if (!(builtin ? SAMPLE_ASSETS.includes(sample.asset.slice(8)) : local)) issue(`${sp}.asset`, 'Use a supported builtin: phrase, a relative assets/ WAV path, or a speech recipe.');
          source = { asset: sample.asset };
        }
        const effect = sample.effect ?? 'dry';
        if (!SAMPLE_EFFECTS.includes(effect)) issue(`${sp}.effect`, 'Unknown sample effect.');
        let pitch = 57;
        try { pitch = parsePitch(sample.pitch ?? 57); } catch (error) { issue(`${sp}.pitch`, error.message); }
        p.sample = { ...source, effect, pitch, semitones: number(sample.semitones, `${sp}.semitones`, -24, 24, 0), stretch: number(sample.stretch, `${sp}.stretch`, 0.25, 4, 1) };
        if (sample.pattern !== undefined) {
          if (!Array.isArray(sample.pattern) || !sample.pattern.length || sample.pattern.length > 128 || sample.pattern.some(v => v !== null && (!Number.isInteger(v) || v < -1 || v > 3))) issue(`${sp}.pattern`, 'Use 1–128 chop steps: slice indices 0–3, or null/-1 for rests.');
          else p.sample.pattern = [...sample.pattern];
        }
      }
    } else if (part.sample !== undefined) issue(`${path}.sample`, 'Sample configuration requires the sample instrument.');
    out.parts.push(p);
  }
  return { normalized: out, issues };
}

export function validateScore(score) {
  const { issues } = normalize(score);
  return { valid: issues.length === 0, issues };
}
export function compileScore(score) {
  const { normalized, issues } = normalize(score);
  if (issues.length) {
    const error = new Error(`Invalid score: ${issues.slice(0, 8).map(i => `${i.path}: ${i.message}`).join('; ')}`);
    error.name = 'ScoreValidationError';
    error.issues = issues;
    throw error;
  }
  return normalized;
}
