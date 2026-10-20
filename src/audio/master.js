// The last stage of every render: a high-pass below 30 Hz, the same integrated
// loudness for every track, and a look-ahead limiter 1 dB below full scale.
import { biquadCoefs } from './synth.js';
import { dbToGain, limitInPlace } from './dsp.js';
import { integratedLoudness } from './loudness.js';

// Streaming services play music at about -14 LUFS; at the default master
// volume every render lands there, so tracks sit at the same level.
export const TARGET_LUFS = -14;
const MAX_BOOST_DB = 20, MAX_CUT_DB = 24;
// A track with sharp peaks backs off in 1 dB steps, up to 6 dB, until the
// limiter turns at most 0.5% of it down by more than 3 dB: a little quieter
// rather than squashed.
const SQUASH_LIMIT = 0.005, MAX_BACKOFF_DB = 6;

function highpassInPlace(channel, sampleRate, freq) {
  const c = {};
  biquadCoefs('highpass', freq, 0.707, sampleRate, c);
  const { b0, b1, b2, a1, a2 } = c;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < channel.length; i++) {
    const x = channel[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    channel[i] = y;
  }
}

/** Master stereo channels in place. volume can only lower the result below the
 * target (1 or more = target loudness), so a loud master setting never squashes it. Returns {loudness, gainDb, limited}: the integrated
 * loudness after mastering in LUFS (null when silent), the gain applied before
 * the limiter, and the fraction of samples the limiter turned down by more
 * than 3 dB. */
export function masterInPlace(channels, sampleRate, { volume = 1 } = {}) {
  for (const channel of channels) highpassInPlace(channel, sampleRate, 30);
  const before = integratedLoudness(channels, sampleRate);
  const trimDb = volume > 0 ? Math.min(0, 20 * Math.log10(volume)) : -Infinity;
  let gainDb = Number.isFinite(before) ? Math.max(-MAX_CUT_DB, Math.min(MAX_BOOST_DB, TARGET_LUFS - before)) + trimDb : trimDb;
  let heavy = 0, mastered = channels;
  for (let backoff = 0; backoff <= MAX_BACKOFF_DB; backoff++) {
    const gain = Number.isFinite(gainDb) ? dbToGain(gainDb) : 0;
    mastered = channels.map(channel => channel.map(value => value * gain));
    ({ heavy } = limitInPlace(mastered, sampleRate, { ceilingDb: -1, lookaheadMs: 5, attackMs: 1, releaseMs: 120 }));
    if (heavy <= SQUASH_LIMIT || !Number.isFinite(gainDb)) break;
    if (backoff < MAX_BACKOFF_DB) gainDb -= 1;
  }
  mastered.forEach((channel, index) => channels[index].set(channel));
  const after = integratedLoudness(channels, sampleRate);
  return { loudness: Number.isFinite(after) ? Math.round(after * 10) / 10 : null, gainDb: Number.isFinite(gainDb) ? Math.round(gainDb * 10) / 10 : null, limited: heavy };
}
