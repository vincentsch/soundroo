// Recorded instruments come from sample packs: one file per instrument with
// its recordings as ordinary WAVs one after another (assets/samples/SOURCES.md).
// assets/samples/samples.json maps notes to recordings and records where each
// recording's audio starts in its pack, with the pack's size and SHA-256.
//
// The packs are large (the piano alone is about 2 GB), so they are not part of
// the repository. prepareSamples (samples-install.js) downloads the packs a
// score needs into a samples folder once and checks them; renders read the
// recordings from there while they play, so a render holds only the stretch of
// each note it is playing in memory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MANIFEST = new URL('../../assets/samples/samples.json', import.meta.url);
let manifest;

export function sampleManifest() {
  manifest ??= JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  return manifest;
}

/** Where packs are kept unless a render names a folder: SOUNDROO_SAMPLES_DIR,
 * then the user's cache folder. */
export function defaultSamplesDir(env = process.env) {
  if (env.SOUNDROO_SAMPLES_DIR) return path.resolve(env.SOUNDROO_SAMPLES_DIR);
  const cache = process.platform === 'win32' ? (env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'))
    : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches')
      : (env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'));
  return path.join(cache, 'soundroo', 'samples');
}

/** The file name of a pack: its name and the start of its SHA-256, so packs of
 * different engine versions sit side by side. */
export function packFileName(name) {
  const pack = sampleManifest().packs[name];
  if (!pack) throw new Error(`Unknown sample pack ${name}.`);
  return `${name}-${pack.sha256.slice(0, 16)}.pack`;
}

/** The packs an instrument plays from. */
export function instrumentPacks(instrument) {
  const spec = sampleManifest().instruments[instrument];
  return spec ? [spec.pack] : [];
}

export class MissingSamplesError extends Error {
  constructor(packs, dir) {
    super(`The recordings for ${packs.join(', ')} are not installed in ${dir}. Run "node bin/soundroo.js samples --all" once to download them, or render with --sound synthesized.`);
    this.name = 'MissingSamplesError';
    this.code = 'samples_missing';
    this.packs = packs;
  }
}

// Short recordings (drum hits, release noises) are read whole once and kept;
// longer ones are read in windows while they play.
const WHOLE_FRAMES = 96000;
const WINDOW_FRAMES = 16384;
const kept = new Map();
let keptValues = 0;
const KEPT_LIMIT = 48_000_000;

// PCM bytes into per-channel Float32Arrays, written at `at` in `out` (new arrays when out is omitted).
function decode(buffer, frames, channels, bits, out = Array.from({ length: channels }, () => new Float32Array(frames)), at = 0) {
  if (bits === 24) {
    for (let c = 0; c < channels; c++) {
      const target = out[c];
      for (let i = 0, p = c * 3; i < frames; i++, p += channels * 3) target[at + i] = (((buffer[p] | (buffer[p + 1] << 8) | (buffer[p + 2] << 16)) << 8) >> 8) * (1 / 8388608);
    }
  } else if (bits === 16) {
    for (let c = 0; c < channels; c++) {
      const target = out[c];
      for (let i = 0, p = c * 2; i < frames; i++, p += channels * 2) target[at + i] = ((buffer[p] | (buffer[p + 1] << 8)) << 16 >> 16) * (1 / 32768);
    }
  } else throw new Error(`Unsupported sample depth ${bits}.`);
  return out;
}

/** The recordings of one samples folder. Open packs stay open for the render. */
export class SampleLibrary {
  constructor(dir = defaultSamplesDir()) {
    this.dir = dir;
    this.files = new Map();
  }

  instrument(id) {
    const spec = sampleManifest().instruments[id];
    if (!spec) throw new Error(`No recorded samples for ${id}.`);
    return spec;
  }

  missing(packs) {
    return [...new Set(packs)].sort().filter(name => {
      const file = path.join(this.dir, packFileName(name));
      try { return fs.statSync(file).size !== sampleManifest().packs[name].size; } catch { return true; }
    });
  }

  fd(pack) {
    if (!this.files.has(pack)) {
      const file = path.join(this.dir, packFileName(pack));
      const missing = this.missing([pack]);
      if (missing.length) throw new MissingSamplesError(missing, this.dir);
      this.files.set(pack, fs.openSync(file, 'r'));
    }
    return this.files.get(pack);
  }

  /** A playable recording: {frames, channels, rate, read(start, count)}. read
   * returns per-channel Float32Arrays for frames [start, start + count). */
  recording(packName, name) {
    const info = sampleManifest().packs[packName].samples[name];
    if (!info) throw new Error(`The ${packName} pack has no recording ${name}.`);
    const fd = this.fd(packName), width = info.bits / 8 * info.channels;
    const read = (start, count, out, at) => {
      const buffer = Buffer.allocUnsafe(count * width);
      const got = fs.readSync(fd, buffer, 0, buffer.length, info.offset + start * width);
      if (got !== buffer.length) throw new Error(`The ${packName} pack is shorter than expected; install it again.`);
      return decode(buffer, count, info.channels, info.bits, out, at);
    };
    return { ...info, key: `${packName}/${name}`, read };
  }

  close() {
    for (const fd of this.files.values()) fs.closeSync(fd);
    this.files.clear();
  }
}

// Interpolation reads a few frames on either side of the playback position;
// outside the recording they are silence.
const PAD = 16;

// Frames [from, from + count) of a recording, silent outside it.
function framesAround(recording, from, count) {
  const start = Math.max(0, from), stop = Math.min(recording.frames, from + count);
  const out = Array.from({ length: recording.channels }, () => new Float32Array(count));
  if (stop > start) recording.read(start, stop - start, out, start - from);
  return out;
}

/** Frames of a recording as a voice plays it: short recordings whole, long
 * ones through a window that moves forward with the playback position.
 * data[channel][frame - base] holds the frames; reads may reach PAD frames
 * outside the recording. */
export class SampleStream {
  constructor(recording) {
    this.recording = recording;
    this.frames = recording.frames;
    this.channels = recording.channels;
    this.base = 0;
    this.data = null;
    if (recording.frames <= WHOLE_FRAMES || recording.loop) {
      let whole = kept.get(recording.key);
      if (!whole) {
        whole = framesAround(recording, -PAD, recording.frames + 2 * PAD);
        keptValues += recording.frames * recording.channels;
        if (keptValues > KEPT_LIMIT) { kept.clear(); keptValues = recording.frames * recording.channels; }
        kept.set(recording.key, whole);
      }
      this.data = whole;
      this.base = -PAD;
      this.whole = true;
    }
  }

  /** Makes frames [from, to) available in this.data (offset by this.base). */
  ensure(from, to) {
    if (this.whole) return;
    if (this.data && from >= this.base && to <= this.base + this.data[0].length) return;
    const count = Math.max(WINDOW_FRAMES, to - from);
    this.base = from;
    this.data = framesAround(this.recording, from, count);
  }
}
