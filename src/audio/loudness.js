// Integrated loudness after ITU-R BS.1770-4 (LUFS): K-weighting, 400 ms blocks
// with 75% overlap, an absolute gate at -70 LUFS and a relative gate 10 LU below.

function biquad(channel, [b0, b1, b2, a1, a2]) {
  const out = new Float32Array(channel.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < channel.length; i++) {
    const x = channel[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

// The two K-weighting stages for any sample rate, as libebur128 derives them.
function kWeighting(sampleRate) {
  let k = Math.tan(Math.PI * 1681.974450955533 / sampleRate);
  const q = 0.7071752369554196, vh = Math.pow(10, 3.999843853973347 / 20), vb = Math.pow(vh, 0.4996667741545416);
  let a0 = 1 + k / q + k * k;
  const shelf = [(vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0];
  k = Math.tan(Math.PI * 38.13547087602444 / sampleRate);
  const q2 = 0.5003270373238773;
  a0 = 1 + k / q2 + k * k;
  const highpass = [1, -2, 1, 2 * (k * k - 1) / a0, (1 - k / q2 + k * k) / a0];
  return [shelf, highpass];
}

/** Integrated loudness of stereo or mono channels in LUFS, or -Infinity for silence. */
export function integratedLoudness(channels, sampleRate) {
  const [shelf, highpass] = kWeighting(sampleRate);
  const weighted = channels.map(channel => biquad(biquad(channel, shelf), highpass));
  const size = Math.round(sampleRate * 0.4), step = Math.round(sampleRate * 0.1);
  const blocks = [];
  for (let start = 0; start + size <= weighted[0].length; start += step) {
    let sum = 0;
    for (const channel of weighted) {
      let squares = 0;
      for (let i = start; i < start + size; i++) squares += channel[i] * channel[i];
      sum += squares / size;
    }
    blocks.push(sum);
  }
  const loudness = power => -0.691 + 10 * Math.log10(power);
  const mean = list => list.reduce((total, value) => total + value, 0) / list.length;
  const audible = blocks.filter(power => power > 0 && loudness(power) > -70);
  if (!audible.length) return -Infinity;
  const relative = loudness(mean(audible)) - 10;
  const gated = audible.filter(power => loudness(power) > relative);
  return loudness(mean(gated.length ? gated : audible));
}
