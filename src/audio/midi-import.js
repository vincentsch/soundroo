// Standard MIDI files into Soundroo scores (version 3). Notes keep their exact
// timing, velocity and length; tempo changes, the sustain pedal (controller
// 64) and markers come along; General MIDI programs pick the closest Soundroo
// instrument and channel 10 is split into the pieces of the drum kit.

function readVariable(bytes, at) {
  let value = 0, length = 0;
  for (;;) {
    const byte = bytes[at + length++];
    if (byte === undefined) throw new Error('The MIDI file ends in the middle of an event.');
    value = (value << 7) | (byte & 127);
    if (!(byte & 128)) return [value, length];
    if (length > 4) throw new Error('The MIDI file has an invalid length field.');
  }
}

/** Parses SMF bytes: {division, tracks: [[{tick, type, ...}]]}. */
export function parseMidi(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const text = (at, length) => String.fromCharCode(...bytes.subarray(at, at + length));
  const u32 = at => ((bytes[at] << 24) >>> 0) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];
  const u16 = at => (bytes[at] << 8) | bytes[at + 1];
  if (bytes.length < 14 || text(0, 4) !== 'MThd') throw new Error('This is not a standard MIDI file (no MThd header).');
  const headerLength = u32(4), format = u16(8), count = u16(10), division = u16(12);
  if (format > 1) throw new Error('Only MIDI format 0 and 1 files are supported.');
  if (division & 0x8000) throw new Error('MIDI files timed in SMPTE frames are not supported; export with ticks per quarter note.');
  const tracks = [];
  let at = 8 + headerLength;
  for (let t = 0; t < count && at + 8 <= bytes.length; t++) {
    if (text(at, 4) !== 'MTrk') throw new Error('The MIDI file has a damaged track.');
    const length = u32(at + 4), end = Math.min(bytes.length, at + 8 + length);
    let p = at + 8, tick = 0, status = 0;
    const events = [];
    while (p < end) {
      const [delta, used] = readVariable(bytes, p);
      p += used; tick += delta;
      let byte = bytes[p];
      if (byte === 0xff) {
        const type = bytes[p + 1];
        const [size, sizeLength] = readVariable(bytes, p + 2);
        const data = bytes.subarray(p + 2 + sizeLength, p + 2 + sizeLength + size);
        p += 2 + sizeLength + size;
        if (type === 0x51 && size === 3) events.push({ tick, type: 'tempo', bpm: 60000000 / ((data[0] << 16) | (data[1] << 8) | data[2]) });
        else if (type === 0x03) events.push({ tick, type: 'name', text: new TextDecoder().decode(data) });
        else if (type === 0x06) events.push({ tick, type: 'marker', text: new TextDecoder().decode(data) });
        else if (type === 0x2f) break;
        continue;
      }
      if (byte === 0xf0 || byte === 0xf7) {
        const [size, sizeLength] = readVariable(bytes, p + 1);
        p += 1 + sizeLength + size;
        continue;
      }
      if (byte & 0x80) { status = byte; p++; } else if (!status) throw new Error('The MIDI file uses running status without a status byte.');
      const kind = status & 0xf0, channel = status & 0x0f;
      const one = bytes[p], two = bytes[p + 1];
      if (kind === 0xc0 || kind === 0xd0) { p += 1; if (kind === 0xc0) events.push({ tick, type: 'program', channel, program: one }); continue; }
      p += 2;
      if (kind === 0x90 && two > 0) events.push({ tick, type: 'on', channel, pitch: one, velocity: two });
      else if (kind === 0x80 || kind === 0x90) events.push({ tick, type: 'off', channel, pitch: one });
      else if (kind === 0xb0) events.push({ tick, type: 'control', channel, control: one, value: two });
    }
    tracks.push(events);
    at = at + 8 + length;
  }
  return { division, tracks };
}

// General MIDI program families to Soundroo instruments.
function instrumentFor(program) {
  if (program <= 3 || program === 6 || program === 7) return 'piano';
  if (program <= 5) return 'electric-piano';
  if (program === 12 || program === 13) return 'marimba';
  if (program <= 15) return 'bell';
  if (program <= 23) return 'organ';
  if (program <= 28) return 'guitar-clean';
  if (program <= 31) return 'guitar-crunch';
  if (program <= 37) return 'electric-bass';
  if (program <= 39) return 'bass';
  if (program <= 51) return program === 47 ? 'tom' : 'strings';
  if (program <= 54) return 'pad';
  if (program <= 63) return 'brass';
  if (program <= 79) return 'fm-lead';
  if (program <= 87) return program === 80 ? 'chip-lead' : 'analog-lead';
  if (program <= 103) return 'pad';
  if (program <= 111) return 'pluck';
  if (program <= 119) return 'marimba';
  return 'noise';
}

// General MIDI drum notes (channel 10) to the pieces of the kit.
function drumFor(pitch) {
  if (pitch === 35 || pitch === 36) return 'rock-kick';
  if (pitch === 37 || pitch === 38 || pitch === 40) return 'rock-snare';
  if (pitch === 39) return 'clap';
  if (pitch === 42 || pitch === 44) return 'closed-hat';
  if (pitch === 46) return 'open-hat';
  if ([41, 43, 45, 47, 48, 50].includes(pitch)) return 'tom';
  if ([49, 52, 55, 57].includes(pitch)) return 'crash';
  if ([51, 53, 59].includes(pitch)) return 'ride';
  if ([54, 69, 70, 82].includes(pitch)) return 'shaker';
  return null;
}

const COLORS = ['#e0472b', '#3e7cb1', '#f2a541', '#5b8c5a', '#9b5de5', '#00a6a6', '#f15bb5', '#8d6346'];
const slug = value => String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'imported';
const round = (value, places = 6) => Math.round(value * 10 ** places) / 10 ** places;

/** A version 3 score from MIDI bytes. Options: id, title. Returns {score,
 * skipped}, where skipped counts drum notes with no kit piece. */
export function midiToScore(buffer, { id, title } = {}) {
  const { division, tracks } = parseMidi(buffer);
  const beat = tick => round(tick / division);
  const all = tracks.flatMap((events, track) => events.map(event => ({ ...event, track })));
  const tempos = all.filter(e => e.type === 'tempo').sort((a, b) => a.tick - b.tick);
  const bpm = round(Math.min(400, Math.max(20, tempos.find(e => e.tick === 0)?.bpm ?? tempos[0]?.bpm ?? 120)), 3);
  const tempo = [];
  for (const event of tempos) {
    const at = beat(event.tick), value = round(Math.min(400, Math.max(20, event.bpm)), 3);
    if (at <= 0) continue;
    const last = tempo[tempo.length - 1]?.bpm ?? bpm;
    if (Math.abs(value - last) < 0.01) continue;
    if (tempo.length && tempo[tempo.length - 1].beat === at) tempo[tempo.length - 1].bpm = value;
    else tempo.push({ beat: at, bpm: value });
  }
  const names = new Map();
  for (const event of all) if (event.type === 'name' && !names.has(event.track)) names.set(event.track, event.text.trim());
  // Notes per (track, channel) for melodic parts and per kit piece for drums.
  const groups = new Map(), open = new Map(), programs = new Map(), pedals = new Map();
  let skipped = 0, lastTick = 0;
  const events = all.sort((a, b) => a.tick - b.tick || (a.type === 'off' ? -1 : 0) - (b.type === 'off' ? -1 : 0));
  for (const event of events) {
    if (event.type === 'program') programs.set(`${event.track}:${event.channel}`, event.program);
    if (event.type === 'control' && event.control === 64) {
      const key = `${event.track}:${event.channel}`, list = pedals.get(key) ?? [];
      const down = event.value >= 64, last = list[list.length - 1];
      if (down && (!last || last.end !== undefined)) list.push({ start: event.tick });
      else if (!down && last && last.end === undefined) last.end = event.tick;
      pedals.set(key, list);
    }
    if (event.type === 'on') open.set(`${event.track}:${event.channel}:${event.pitch}`, [...(open.get(`${event.track}:${event.channel}:${event.pitch}`) ?? []), event]);
    if (event.type === 'off') {
      const key = `${event.track}:${event.channel}:${event.pitch}`, starts = open.get(key);
      const start = starts?.shift();
      if (!start) continue;
      lastTick = Math.max(lastTick, event.tick);
      const drum = event.channel === 9;
      const instrument = drum ? drumFor(event.pitch) : instrumentFor(programs.get(`${event.track}:${event.channel}`) ?? 0);
      if (!instrument) { skipped++; continue; }
      const group = drum ? `drums:${instrument}` : `${event.track}:${event.channel}`;
      if (!groups.has(group)) groups.set(group, { instrument, track: event.track, channel: event.channel, drum, notes: [] });
      groups.get(group).notes.push({ pitch: event.pitch, beat: beat(start.tick), duration: Math.max(1 / 64, beat(event.tick - start.tick)), velocity: round(Math.max(1, start.velocity) / 127, 4) });
    }
  }
  if (!groups.size) throw new Error('The MIDI file has no notes Soundroo can play.');
  const end = Math.max(beat(lastTick), ...[...pedals.values()].flat().map(span => beat(span.end ?? lastTick)));
  // Room after the last note for releases and ringing strings.
  const beats = Math.ceil((end + 2) / 4) * 4;
  const used = new Set();
  const parts = [...groups.values()].map((group, index) => {
    const base = slug(group.drum ? group.instrument : names.get(group.track) || group.instrument);
    let partId = base, n = 2;
    while (used.has(partId)) partId = `${base}-${n++}`;
    used.add(partId);
    const pedal = group.drum ? [] : (pedals.get(`${group.track}:${group.channel}`) ?? []).map(span => ({ beat: beat(span.start), beats: round(beat(span.end ?? lastTick) - beat(span.start)) })).filter(span => span.beats > 0);
    return { id: partId, name: group.drum ? group.instrument : names.get(group.track) || group.instrument, instrument: group.instrument, volume: group.drum ? 0.8 : 0.9, color: COLORS[index % COLORS.length], notes: group.notes.sort((a, b) => a.beat - b.beat || a.pitch - b.pitch), ...(pedal.length ? { pedal } : {}) };
  });
  const markers = all.filter(e => e.type === 'marker').sort((a, b) => a.tick - b.tick);
  const sections = markers.map((marker, i) => ({ id: `${slug(marker.text) || 'section'}-${i + 1}`, name: marker.text.trim() || `Section ${i + 1}`, beat: beat(marker.tick), beats: round((markers[i + 1] ? beat(markers[i + 1].tick) : beats) - beat(marker.tick)) })).filter(s => s.beats > 0 && s.beat < beats);
  const score = { version: 3, id: slug(id ?? title ?? 'imported'), title: title ?? 'Imported MIDI', bpm, beats, ...(tempo.length ? { tempo } : {}), master: { volume: 0.8, reverb: 0.25 }, ...(sections.length ? { sections } : {}), parts };
  return { score, skipped };
}
