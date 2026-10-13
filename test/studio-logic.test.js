import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../web/js/logic.js';

test('time formatting and parsing', () => {
  assert.equal(L.formatTime(0), '0:00');
  assert.equal(L.formatTime(83.9), '1:23');
  assert.equal(L.formatTime(3723), '1:02:03');
  assert.equal(L.formatTime(NaN), '–:––');
  assert.equal(L.parseTime('1:23'), 83);
  assert.equal(L.parseTime('83'), 83);
  assert.equal(L.parseTime('0:01:05'), 65);
  assert.equal(L.parseTime('1:23.5'), 83.5);
  assert.equal(L.parseTime('1:75'), null);
  assert.equal(L.parseTime('abc'), null);
  assert.equal(L.parseTime(''), null);
  assert.equal(L.formatTotal(2280), '38 min');
  assert.equal(L.formatTotal(3900), '1 hr 5 min');
  assert.equal(L.formatTotal(0), '');
});

test('db and pan labels', () => {
  assert.equal(L.formatDb(1), '0.0 dB');
  assert.equal(L.formatDb(0.5), '−6.0 dB');
  assert.equal(L.formatDb(1.5), '+3.5 dB');
  assert.equal(L.formatDb(0), '−∞ dB');
  assert.equal(L.formatPan(0), 'C');
  assert.equal(L.formatPan(-0.4), 'L40');
  assert.equal(L.formatPan(0.25, true), '25% right');
});

test('track normalization is defensive', () => {
  const t = L.normalizeTrack({ id: 7, title: '  ', rendered: true, audioUrl: '', bpm: '92', waveform: [0.2, 'x', 3], sections: [{ name: 'A', start: 10, end: 5 }, { name: 'Intro', start: 0, end: 10 }], parts: [{ id: 'p', color: 'red' }], versions: [{ id: 1, audioUrl: '/v1' }, { id: 2 }] }, 3);
  assert.equal(t.id, '7');
  assert.equal(t.title, 'Untitled');
  assert.equal(t.rendered, false, 'rendered needs an audio url');
  assert.equal(t.bpm, 92);
  assert.deepEqual(t.waveform, [0.2, 0, 1]);
  assert.deepEqual(t.sections.map(s => s.name), ['Intro']);
  assert.match(t.parts[0].color, /^#[0-9a-f]{6}$/i);
  assert.equal(t.versions.length, 1);
  assert.equal(L.normalizeTrack(null), null);
  assert.equal(L.collectionLabel({ source: 'examples' }), 'Example collection');
  assert.equal(L.collectionLabel({ source: 'personal' }), 'Your collection');
});

test('jobs normalize progress to 0..1', () => {
  assert.equal(L.normalizeJob({ id: 1, status: 'running', progress: 45 }).progress, 0.45);
  assert.equal(L.normalizeJob({ id: 1, status: 'running', progress: 0.3 }).progress, 0.3);
  assert.equal(L.normalizeJob({ id: 1, status: 'weird' }).status, 'queued');
  assert.equal(L.normalizeJob({ id: 1, status: 'error', error: { message: 'boom' } }).error, 'boom');
  assert.ok(L.isActiveJob({ status: 'queued' }));
  assert.ok(!L.isActiveJob({ status: 'done' }));
});

test('queue: order, next/prev and repeat', () => {
  const q = new L.Queue();
  q.load(['a', 'b', 'c', 'd'], 'b');
  assert.equal(q.current, 'b');
  const all = () => true;
  assert.equal(q.nextIndex(all), 2);
  assert.equal(q.prevIndex(all), 0);
  q.index = 3;
  assert.equal(q.nextIndex(all), -1);
  q.repeat = 'all';
  assert.equal(q.nextIndex(all), 0);
  q.repeat = 'one';
  assert.equal(q.nextIndex(all, { auto: true }), 3);
  assert.equal(q.nextIndex(all), 0, 'manual next with repeat one still moves on');
  q.repeat = 'off';
  q.index = 0;
  assert.equal(q.nextIndex(id => id !== 'b' && id !== 'c'), 3, 'skips unplayable');
});

test('queue: shuffle keeps the current track and restores order', () => {
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const q = new L.Queue({ random });
  q.load(['a', 'b', 'c', 'd', 'e'], 'c');
  q.setShuffle(true);
  assert.equal(q.current, 'c');
  assert.equal(q.index, 0);
  assert.deepEqual([...q.items].sort(), ['a', 'b', 'c', 'd', 'e']);
  q.index = 2;
  const playing = q.current;
  q.setShuffle(false);
  assert.deepEqual(q.items, ['a', 'b', 'c', 'd', 'e']);
  assert.equal(q.current, playing);
  const s = new L.Queue({ random });
  s.load(['a', 'b', 'c'], null, true);
  assert.equal(s.items.length, 3);
  assert.equal(s.index, 0);
});

test('queue: play next, append, remove, move, clear', () => {
  const q = new L.Queue();
  q.load(['a', 'b', 'c', 'd'], 'a');
  assert.ok(q.playNext('d'));
  assert.deepEqual(q.items, ['a', 'd', 'b', 'c']);
  assert.deepEqual(q.order, ['a', 'd', 'b', 'c']);
  assert.ok(!q.playNext('a'), 'current track cannot be queued next');
  assert.ok(q.append('b'));
  assert.deepEqual(q.items, ['a', 'd', 'c', 'b']);
  assert.ok(q.move(2, 1));
  assert.deepEqual(q.items, ['a', 'd', 'b', 'c']);
  assert.ok(!q.move(1, -1), 'cannot move above the current track');
  assert.ok(q.removeAt(1));
  assert.deepEqual(q.items, ['a', 'b', 'c']);
  assert.ok(!q.removeAt(0));
  q.index = 1;
  q.clearUpcoming();
  assert.deepEqual(q.items, ['a', 'b']);
  assert.equal(q.current, 'b');
  // removing before the current index keeps the same current track
  const r = new L.Queue();
  r.load(['a', 'b', 'c'], 'c');
  r.removeAt(0);
  assert.equal(r.current, 'c');
  // nothing loaded yet
  const e = new L.Queue();
  assert.ok(e.playNext('x'));
  assert.equal(e.current, null);
  assert.equal(e.nextIndex(() => true), 0);
});

test('filtering and sorting', () => {
  const tracks = [
    { id: '1', index: 0, title: 'Café Lights', description: '', genre: 'Ambient', mood: 'Calm', key: 'D', bpm: 80, duration: 200, favorite: true, rendered: true },
    { id: '2', index: 1, title: 'Night Bus', description: 'late city', genre: 'House', mood: 'Driving', key: 'F', bpm: 122, duration: 150, favorite: false, rendered: false },
    { id: '3', index: 2, title: 'amber', description: '', genre: 'Ambient', mood: 'Warm', key: 'A', bpm: null, duration: 300, favorite: false, rendered: true },
  ];
  assert.deepEqual(L.filterTracks(tracks, { query: 'cafe' }).map(t => t.id), ['1']);
  assert.deepEqual(L.filterTracks(tracks, { query: 'late house' }).map(t => t.id), ['2']);
  assert.deepEqual(L.filterTracks(tracks, { query: '122 bpm' }).map(t => t.id), ['2']);
  assert.deepEqual(L.filterTracks(tracks, { genre: 'Ambient' }).map(t => t.id), ['1', '3']);
  assert.deepEqual(L.filterTracks(tracks, { favorites: true }).map(t => t.id), ['1']);
  assert.deepEqual(L.filterTracks(tracks, { status: 'unrendered' }).map(t => t.id), ['2']);
  assert.deepEqual(L.sortTracks(tracks, 'title').map(t => t.id), ['3', '1', '2']);
  assert.deepEqual(L.sortTracks(tracks, 'duration').map(t => t.id), ['2', '1', '3']);
  assert.deepEqual(L.sortTracks(tracks, 'bpm').map(t => t.id), ['1', '2', '3']);
  assert.deepEqual(L.facet(tracks, 'genre'), ['Ambient', 'House']);
});

test('sections and waveform helpers', () => {
  const sections = [{ name: 'A', start: 0, end: 10 }, { name: 'B', start: 10, end: 20 }];
  assert.equal(L.sectionIndexAt(sections, 0), 0);
  assert.equal(L.sectionIndexAt(sections, 10), 1);
  assert.equal(L.sectionIndexAt(sections, 25), -1);
  assert.deepEqual(L.resampleMax([0.1, 0.9, 0.2, 0.4], 2), [0.9, 0.4]);
  assert.equal(L.resampleMax([0.5], 4).length, 4);
  assert.deepEqual(L.resampleMax([], 4), []);
});

test('mix normalization and audibility', () => {
  const parts = [{ id: 'piano', volume: 0.8, pan: -0.2 }, { id: 'drums', volume: 1, pan: 0 }];
  const mix = L.normalizeMix({ parts: { drums: { volume: 3, mute: true } }, master: { volume: 0.9 } }, parts);
  assert.deepEqual(mix.parts.piano, { volume: 0.8, pan: -0.2, mute: false, solo: false });
  assert.equal(mix.parts.drums.volume, L.VOLUME_MAX);
  assert.equal(mix.master.volume, 0.9);
  assert.deepEqual([...L.audibleParts(mix)], ['piano']);
  mix.parts.drums.solo = true;
  assert.deepEqual([...L.audibleParts(mix)], [], 'muted soloed part stays silent; others are not soloed');
  assert.ok(L.sameMix(L.normalizeMix(null, parts), L.normalizeMix(undefined, parts)));
});

test('arrangement reads beat or second based note events', () => {
  const track = { bpm: 120, parts: [{ id: 'bass', name: 'Bass', color: '#123456' }, { id: 'keys', name: 'Keys', color: '#654321' }] };
  const beats = L.arrangementLanes(track, { score: { bpm: 60, parts: [{ id: 'bass', notes: [{ pitch: 40, beat: 2, duration: 1, velocity: 0.5 }] }] } });
  assert.equal(beats.hasNotes, true);
  assert.deepEqual(beats.lanes[0].notes[0], { pitch: 40, start: 2, length: 1, velocity: 0.5 });
  assert.equal(beats.lanes[1].notes.length, 0);
  const seconds = L.arrangementLanes(track, { arrangement: { parts: [{ name: 'keys', notes: [{ midi: 60, time: 1.5, length: 0.5 }] }] } });
  assert.equal(seconds.lanes[1].notes[0].start, 1.5);
  assert.equal(L.arrangementLanes(track, { score: 'opaque text' }).hasNotes, false);
  const fromScore = L.arrangementLanes({ bpm: 100, parts: [] }, { score: { tracks: [{ name: 'Lead', notes: [{ pitch: 70, beat: 0, duration: 1 }] }] } });
  assert.equal(fromScore.lanes[0].name, 'Lead');
  assert.equal(fromScore.lanes[0].notes[0].length, 0.6);
});

test('prompts for the coding agent', () => {
  const prompt = L.buildPrompt({ brief: 'Rainy jazz for reading', count: 3, feel: ['Calm', 'Warm'], length: 'short', voice: 'spoken' });
  assert.match(prompt, /^Make a Soundroo collection of 3 original tracks\./);
  assert.match(prompt, /Rainy jazz for reading/);
  assert.match(prompt, /Feel: calm, warm\./);
  assert.match(prompt, /Length: about 2 minutes each\./);
  assert.match(prompt, /No sung vocals/);
  assert.match(prompt, /AGENTS\.md/);
  assert.match(L.buildPrompt({ brief: '' }), /Describe the music here/);
  assert.match(L.buildPrompt({ brief: 'x', count: 1 }), /1 original track\./);
  assert.equal(L.trackCount(99), 20);
  assert.equal(L.trackCount('abc'), 10);
  const brief = L.composeBrief({ brief: 'Glass and steam', voice: 'instrumental' });
  assert.equal(brief, 'Glass and steam\nVoice: instrumental only.');
  const followUp = L.followUpPrompt({ path: 'requests/brief.json', count: 10 });
  assert.ok(followUp.includes('requests/brief.json'));
  assert.ok(followUp.includes('10 tracks'));
});

test('palette from pixels finds background and a distinct accent', () => {
  const px = [];
  for (let i = 0; i < 90; i++) px.push(16, 46, 53, 255); // teal background
  for (let i = 0; i < 25; i++) px.push(182, 224, 197, 255); // mint
  for (let i = 0; i < 10; i++) px.push(241, 240, 215, 255); // cream
  const palette = L.paletteFromPixels(new Uint8ClampedArray(px));
  assert.equal(palette.background, 'rgb(16 46 53)');
  assert.notEqual(palette.accent, palette.background);
  assert.equal(palette.dark, true);
  assert.equal(L.paletteFromPixels(new Uint8ClampedArray([0, 0, 0, 0])), null);
});
