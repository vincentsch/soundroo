const DIVISION = 480;

function variable(value) {
  const bytes = [value & 127];
  while ((value >>= 7)) bytes.unshift((value & 127) | 128);
  return Buffer.from(bytes);
}
function chunk(name, bytes) {
  const header = Buffer.alloc(8); header.write(name, 0, 'ascii'); header.writeUInt32BE(bytes.length, 4);
  return Buffer.concat([header, bytes]);
}
function metadata(type, text) {
  const bytes = Buffer.from(text, 'utf8');
  return Buffer.concat([Buffer.from([255, type]), variable(bytes.length), bytes]);
}

// A standard format-1 MIDI file with a conductor track and one track per part.
// Callers pass normalized note events in quarter-note beats.
export function encodeMidi({ title = 'Soundroo', bpm = 120, tracks = [], sections = [] }) {
  if (!Number.isFinite(bpm) || bpm < 20 || bpm > 400) throw new Error('MIDI tempo must be between 20 and 400 BPM.');
  if (tracks.length > 64) throw new Error('MIDI export supports at most 64 instrument tracks.');
  const tempo = Buffer.alloc(6); tempo.set([255, 81, 3]); tempo.writeUIntBE(Math.round(60000000 / bpm), 3, 3);
  const conductor = [{ tick: 0, bytes: metadata(3, title), order: 0 }, { tick: 0, bytes: tempo, order: 1 }];
  for (const section of sections) conductor.push({ tick: Math.round(section.beat * DIVISION), bytes: metadata(6, section.name), order: 2 });
  const makeTrack = events => {
    events.sort((a, b) => a.tick - b.tick || a.order - b.order);
    let previous = 0;
    const bytes = [];
    for (const event of events) {
      if (!Number.isSafeInteger(event.tick) || event.tick < 0 || event.tick > 0x0fffffff) throw new Error('A MIDI event has an invalid time.');
      bytes.push(variable(event.tick - previous), event.bytes); previous = event.tick;
    }
    bytes.push(Buffer.from([0, 255, 47, 0]));
    return chunk('MTrk', Buffer.concat(bytes));
  };
  const body = [makeTrack(conductor)];
  let melodicChannel = 0;
  for (const track of tracks) {
    const channel = track.drums ? 9 : melodicChannel++ % 15;
    const resolved = !track.drums && channel >= 9 ? channel + 1 : channel;
    const program = Math.round(track.program ?? 0);
    if (program < 0 || program > 127) throw new Error('MIDI instrument programs must be between 0 and 127.');
    const events = [{ tick: 0, bytes: metadata(3, track.name ?? 'Instrument'), order: 0 }];
    if (!track.drums) events.push({ tick: 0, bytes: Buffer.from([192 | resolved, program]), order: 1 });
    for (const note of track.notes ?? []) {
      const { pitch, beat, duration, velocity = 0.7 } = note;
      if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127 || !Number.isFinite(beat) || beat < 0 || !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(velocity) || velocity <= 0 || velocity > 1) {
        throw new Error('MIDI notes need a valid pitch, beat, duration and velocity.');
      }
      const start = Math.round(beat * DIVISION);
      const end = Math.max(start + 1, Math.round((beat + duration) * DIVISION));
      events.push({ tick: start, bytes: Buffer.from([144 | resolved, pitch, Math.max(1, Math.round(velocity * 127))]), order: 3 });
      events.push({ tick: end, bytes: Buffer.from([128 | resolved, pitch, 0]), order: 2 });
    }
    body.push(makeTrack(events));
  }
  const header = Buffer.alloc(6); header.writeUInt16BE(1, 0); header.writeUInt16BE(body.length, 2); header.writeUInt16BE(DIVISION, 4);
  return Buffer.concat([chunk('MThd', header), ...body]);
}
