// Signal measurements for rendered audio. These diagnose technical problems;
// they do not score musical taste.
export function analyzeAudio(channels, sampleRate, { bins = 360 } = {}) {
  if (!Array.isArray(channels) || !channels.length || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error('Audio analysis needs channels and a positive sample rate.');
  }
  const frames = channels[0].length;
  if (channels.some(c => c.length !== frames)) throw new Error('Audio channels must have the same length.');
  const peaks = new Array(Math.min(bins, frames || 1)).fill(0);
  let peak = 0, squares = 0, nonFinite = 0, clipped = 0, silentFrames = 0;
  for (let i = 0; i < frames; i++) {
    let framePeak = 0;
    for (const channel of channels) {
      const value = channel[i];
      if (!Number.isFinite(value)) { nonFinite++; continue; }
      const absolute = Math.abs(value);
      framePeak = Math.max(framePeak, absolute);
      peak = Math.max(peak, absolute);
      squares += value * value;
      if (absolute >= 1) clipped++;
    }
    if (framePeak < 0.0001) silentFrames++;
    const bin = Math.min(peaks.length - 1, Math.floor(i * peaks.length / Math.max(1, frames)));
    peaks[bin] = Math.max(peaks[bin], framePeak);
  }
  const count = frames * channels.length;
  const rms = count ? Math.sqrt(squares / count) : 0;
  const db = value => value > 0 ? Math.round(20 * Math.log10(value) * 100) / 100 : null;
  return {
    duration: frames / sampleRate,
    sampleRate,
    channels: channels.length,
    frames,
    peak,
    peakDb: db(peak),
    rms,
    rmsDb: db(rms),
    nonFinite,
    clipped,
    silentFraction: frames ? silentFrames / frames : 1,
    waveform: peaks.map(value => Math.round(value * 10000) / 10000),
  };
}

export function technicalWarnings(report) {
  const warnings = [];
  if (report.nonFinite) warnings.push({ code: 'non_finite', message: 'The render contains invalid audio samples.' });
  if (report.clipped) warnings.push({ code: 'clipping', message: 'The render reaches digital full scale. Reduce the mix level.' });
  if (report.peak < 0.0001) warnings.push({ code: 'silent', message: 'The render is silent. Check the notes, mute states and levels.' });
  if (report.duration <= 0) warnings.push({ code: 'empty', message: 'The render has no playable frames.' });
  return warnings;
}
