// Deterministic sample-level synthesis core. Everything is plain JavaScript:
// voices are summed in scheduling order, so the same schedule always produces
// the same samples (Web Audio sums node inputs in an unspecified order).
//
// A Synth owns lanes (mono instrument buses with filter, pump, pan and a
// reverb send, or stereo buses for sound effects) and voices (short-lived
// oscillator/noise stacks with their own envelopes and optional filter).
// It renders block by block into caller-provided stereo buffers.

export const BLOCK = 256;
const TWO_PI = Math.PI * 2;

// --- sine table ----------------------------------------------------------------

const TABLE = 4096;
const SINE = new Float64Array(TABLE + 1);
for (let i = 0; i <= TABLE; i++) SINE[i] = Math.sin((TWO_PI * i) / TABLE);

// --- envelopes (AudioParam-style automation, evaluated per sample) --------------

const HOLD = 0;
const LIN = 1;
const EXP = 2;
const TARGET = 3;

export class Env {
  constructor(initial = 0) {
    this.initial = initial;
    this.events = [];
  }
  set(v, t) {
    this.events.push([HOLD, t, v, 0]);
    return this;
  }
  lin(v, t) {
    this.events.push([LIN, t, v, 0]);
    return this;
  }
  exp(v, t) {
    this.events.push([EXP, t, v, 0]);
    return this;
  }
  target(v, t, tau) {
    this.events.push([TARGET, t, v, tau]);
    return this;
  }

  // Prepare for sequential evaluation starting at absolute sample `from`.
  begin(sr, from) {
    this.ev = this.events
      .map((e, i) => ({ k: e[0], s: Math.max(0, Math.round(e[1] * sr)), v: e[2], c: e[0] === TARGET ? Math.exp(-1 / (Math.max(1e-5, e[3]) * sr)) : 0, i }))
      .sort((a, b) => a.s - b.s || a.i - b.i);
    this.idx = 0;
    this.n = from;
    this.v = this.initial;
    this.mode = HOLD;
    this.dv = 0;
    this.ratio = 1;
    this.tv = 0;
    this.tc = 0;
    this.targeting = false;
    this._process();
  }

  _process() {
    const ev = this.ev;
    while (this.idx < ev.length && ev[this.idx].s <= this.n) {
      const e = ev[this.idx++];
      if (e.k === TARGET) {
        this.targeting = true;
        this.tv = e.v;
        this.tc = e.c;
      } else {
        this.v = e.v;
        this.targeting = false;
      }
    }
    const next = ev[this.idx];
    this.nextS = next ? next.s : Infinity;
    this.mode = this.targeting ? TARGET : HOLD;
    if (next && (next.k === LIN || next.k === EXP)) {
      const len = next.s - this.n;
      if (next.k === EXP && this.v > 0 && next.v > 0) {
        this.mode = EXP;
        this.ratio = Math.pow(next.v / this.v, 1 / len);
      } else {
        this.mode = LIN;
        this.dv = (next.v - this.v) / len;
      }
    }
  }

  fill(out, count) {
    let v = this.v;
    let n = this.n;
    let mode = this.mode;
    for (let k = 0; k < count; k++) {
      if (n >= this.nextS) {
        this.v = v;
        this.n = n;
        this._process();
        v = this.v;
        mode = this.mode;
      }
      out[k] = v;
      if (mode === LIN) v += this.dv;
      else if (mode === EXP) v *= this.ratio;
      else if (mode === TARGET) v = this.tv + (v - this.tv) * this.tc;
      n++;
    }
    this.v = v;
    this.n = n;
  }
}

// --- oscillator helpers -----------------------------------------------------------

// Recordings are pitched with 16-point Kaiser-windowed sinc interpolation:
// flat to 16 kHz and free of the treble loss and aliasing a short polynomial
// adds. SINC holds the 16 weights for each of 2048 fractional positions.
export const SINC_TAPS = 16;
const SINC_PHASES = 2048;
const SINC = (() => {
  const half = SINC_TAPS / 2, cutoff = 0.46, beta = 8;
  const bessel = x => { let sum = 1, term = 1; for (let k = 1; k < 32; k++) { term *= (x / (2 * k)) ** 2; sum += term; } return sum; };
  const table = new Float32Array((SINC_PHASES + 1) * SINC_TAPS);
  for (let p = 0; p <= SINC_PHASES; p++) {
    const f = p / SINC_PHASES, weights = [];
    for (let j = 0; j < SINC_TAPS; j++) {
      const x = j - half + 1 - f;
      const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
      weights.push(Math.abs(x) >= half ? 0 : sinc * bessel(beta * Math.sqrt(1 - (x / half) ** 2)) / bessel(beta));
    }
    const sum = weights.reduce((a, b) => a + b, 0);
    weights.forEach((w, j) => { table[p * SINC_TAPS + j] = w / sum; });
  }
  return table;
})();

// 4-point, 3rd-order Hermite interpolation between d[j] and d[j + 1].
function hermite(d, jm, j, f) {
  const xm1 = d[jm], x0 = d[j], x1 = d[j + 1], x2 = d[j + 2];
  const c1 = 0.5 * (x1 - xm1), c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2, c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
  return ((c3 * f + c2) * f + c1) * f + x0;
}

function polyblep(t, dt) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

export const WAVES = { sine: 0, saw: 1, tri: 2, square: 3, noise: 4, pink: 5, sample: 6, string: 7, stream: 8 };

// --- biquad (RBJ cookbook) ------------------------------------------------------------

export function biquadCoefs(type, freq, q, sr, c) {
  const f = Math.min(Math.max(freq, 10), sr * 0.45);
  const w0 = (TWO_PI * f) / sr;
  const cs = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.max(0.05, q));
  let b0;
  let b1;
  let b2;
  if (type === 'highpass') {
    b0 = (1 + cs) / 2;
    b1 = -(1 + cs);
    b2 = (1 + cs) / 2;
  } else if (type === 'bandpass') {
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
  } else {
    b0 = (1 - cs) / 2;
    b1 = 1 - cs;
    b2 = (1 - cs) / 2;
  }
  const a0 = 1 + alpha;
  c.b0 = b0 / a0;
  c.b1 = b1 / a0;
  c.b2 = b2 / a0;
  c.a1 = (-2 * cs) / a0;
  c.a2 = (1 - alpha) / a0;
}

// Transposed direct form II, in place over buf[0..count).
function biquadRun(c, buf, from, to) {
  const { b0, b1, b2, a1, a2 } = c;
  let z1 = c.z1;
  let z2 = c.z2;
  for (let k = from; k < to; k++) {
    const x = buf[k];
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    buf[k] = y;
  }
  c.z1 = z1;
  c.z2 = z2;
}

export function makeFilter(type, freq, q = 0.707) {
  return { type, freq, q, b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, z1: 0, z2: 0, lastF: -1 };
}

// --- voices ---------------------------------------------------------------------------

// A voice is a stack of layers summed, optionally filtered, then written to its
// lane (mono) or panned into it (stereo lanes).
//   layer: { wave, freq: number, freqEnv?: Env (Hz, overrides freq), detune (cents),
//            amp: Env, fm?: { ratio, depth: Env (Hz) }, seed }
//   sample layer: { wave: WAVES.sample, data: Float32Array, step (source frames per
//            output frame), start?: first source frame, loop?: [start, end] source frames,
//            detune, amp: Env }
//   filter: { type, freq, freqEnv?: Env, q }
export class Voice {
  constructor(t0, t1) {
    this.t0 = t0;
    this.t1 = t1;
    this.layers = [];
    this.filter = null;
    this.pan = 0;
    this.panEnv = null;
    // A stereo voice plays a recording's two channels into a stereo lane.
    this.stereo = false;
  }
  layer(spec) {
    this.layers.push(spec);
    return this;
  }
}

// --- reverb (Freeverb topology, block processed) ---------------------------------------------

const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASSES = [556, 441, 341, 225];
const SPREAD = 23;

export class Reverb {
  constructor(sr, { room = 0.8, damp = 0.35, preDelay = 0.02, lowCut = 200 } = {}) {
    const scale = sr / 44100;
    const line = (d) => ({ buf: new Float32Array(Math.max(1, Math.round(d * scale))), i: 0, fs: 0 });
    this.combs = COMBS.map(line);
    this.aps = [ALLPASSES.map(line), ALLPASSES.map((d) => line(d + SPREAD))];
    this.fb = room * 0.28 + 0.7;
    this.damp = damp * 0.4;
    this.pre = new Float32Array(Math.max(1, Math.round(preDelay * sr)));
    this.preI = 0;
    this.hpA = Math.exp((-TWO_PI * lowCut) / sr);
    this.hpX = 0;
    this.hpY = 0;
    this.inBuf = new Float32Array(BLOCK);
    this.wet = new Float32Array(BLOCK);
    this.chBuf = new Float32Array(BLOCK);
    // after this many silent input samples the tail is below -100 dB: skip work
    this.tailSamples = Math.round(sr * (0.4 + 12 * (1 / (1 - this.fb)) * (1116 * scale) / sr));
    this.silent = this.tailSamples;
  }

  // Adds the wet signal (times `level`) for mono `input[0..n)` into outL/outR.
  process(input, n, outL, outR, level) {
    let loud = false;
    for (let k = 0; k < n; k++) {
      if (input[k] !== 0) {
        loud = true;
        break;
      }
    }
    if (loud) this.silent = 0;
    else if (this.silent >= this.tailSamples) return;
    else this.silent += n;

    const x = this.inBuf;
    const pre = this.pre;
    let pi = this.preI;
    let hx = this.hpX;
    let hy = this.hpY;
    const a = this.hpA;
    for (let k = 0; k < n; k++) {
      const d = pre[pi];
      pre[pi] = input[k];
      pi = pi + 1 === pre.length ? 0 : pi + 1;
      hy = a * (hy + d - hx);
      hx = d;
      x[k] = hy * 0.015;
    }
    this.preI = pi;
    this.hpX = hx;
    this.hpY = hy;

    const fb = this.fb;
    const damp = this.damp;
    const damp1 = 1 - damp;
    const wet = this.wet;
    wet.fill(0, 0, n);
    for (const c of this.combs) {
      const buf = c.buf;
      const len = buf.length;
      let i = c.i;
      let fs = c.fs;
      for (let k = 0; k < n; k++) {
        const o = buf[i];
        fs = o * damp1 + fs * damp;
        buf[i] = x[k] + fs * fb;
        if (++i === len) i = 0;
        wet[k] += o;
      }
      c.i = i;
      c.fs = fs;
    }
    const outs = [outL, outR];
    const g = level * 3;
    for (let ch = 0; ch < 2; ch++) {
      const y = this.chBuf;
      y.set(wet.subarray(0, n));
      for (const ap of this.aps[ch]) {
        const buf = ap.buf;
        const len = buf.length;
        let i = ap.i;
        for (let k = 0; k < n; k++) {
          const bo = buf[i];
          const inp = y[k];
          buf[i] = inp + bo * 0.5;
          y[k] = bo - inp;
          if (++i === len) i = 0;
        }
        ap.i = i;
      }
      const out = outs[ch];
      for (let k = 0; k < n; k++) out[k] += y[k] * g;
    }
  }
}

// --- glue compressor (stereo linked, feed-forward, soft knee) ---------------------------------

export class Compressor {
  constructor(sr, { threshold = -20, ratio = 2, knee = 10, attack = 0.02, release = 0.3, makeupDb = 0 } = {}) {
    this.t = threshold;
    this.r = ratio;
    this.k = knee;
    this.att = Math.exp(-1 / (attack * sr));
    this.rel = Math.exp(-1 / (release * sr));
    this.env = 0;
    this.makeup = Math.pow(10, makeupDb / 20);
    this.gain = 1;
  }
  process(L, R, n) {
    let env = this.env;
    let g = this.gain;
    for (let k = 0; k < n; k++) {
      const p = Math.max(Math.abs(L[k]), Math.abs(R[k]));
      env = p > env ? p + (env - p) * this.att : p + (env - p) * this.rel;
      if ((k & 7) === 0) {
        const lvl = 20 * Math.log10(env + 1e-9);
        const over = lvl - this.t;
        let gr = 0;
        if (over > this.k / 2) gr = (1 / this.r - 1) * over;
        else if (over > -this.k / 2) {
          const x = over + this.k / 2;
          gr = ((1 / this.r - 1) * x * x) / (2 * this.k);
        }
        g = Math.pow(10, gr / 20) * this.makeup;
      }
      L[k] *= g;
      R[k] *= g;
    }
    this.env = env;
    this.gain = g;
  }
}

// --- lanes ---------------------------------------------------------------------------------

export class Lane {
  constructor(synth, spec = {}) {
    this.synth = synth;
    this.stereo = !!spec.stereo;
    this.gain = spec.gain ?? 1;
    this.panBase = spec.pan ?? 0;
    this.panLfo = spec.panLfo || null;
    this.send = spec.reverb || 0;
    this.filter = spec.filter ? makeFilter(spec.filter.type, spec.filter.freq, spec.filter.q ?? 0.707) : null;
    this.filterR = spec.filter && this.stereo ? makeFilter(spec.filter.type, spec.filter.freq, spec.filter.q ?? 0.707) : null;
    this.filterLfo = spec.filter && spec.filter.lfo ? spec.filter.lfo : null;
    this.overdrive = spec.overdrive ?? null;
    this.drivePrevious = 0;
    this.pumpTimes = spec.pump ? [] : null;
    this.pumpI = 0;
    this.pumpD = 0;
    this.mono = new Float32Array(BLOCK);
    this.L = this.stereo ? new Float32Array(BLOCK) : null;
    this.R = this.stereo ? new Float32Array(BLOCK) : null;
  }

  // Ducks the lane at time t (tech-style pumping); decays back to 1.
  pump(t, depth = 0.55) {
    if (this.pumpTimes) this.pumpTimes.push([Math.round(t * this.synth.sr), depth]);
  }

  clear(n) {
    this.dirty = false;
    if (this.stereo) {
      this.L.fill(0, 0, n);
      this.R.fill(0, 0, n);
    } else {
      this.mono.fill(0, 0, n);
    }
  }

  // Mixes the block into the synth's dry buffers and the reverb input.
  mix(i0, n, dryL, dryR, send) {
    const quiet = f => !f || (Math.abs(f.z1) < 1e-12 && Math.abs(f.z2) < 1e-12);
    if (!this.dirty && !this.pumpTimes && quiet(this.filter) && quiet(this.filterR)) return;
    const sr = this.synth.sr;
    const tMid = (i0 + n / 2) / sr;
    const g = this.gain;
    if (this.stereo) {
      const L = this.L;
      const R = this.R;
      if (this.filter) {
        for (const [f, buffer] of [[this.filter, L], [this.filterR, R]]) {
          if (f.freq !== f.lastF) { biquadCoefs(f.type, f.freq, f.q, sr, f); f.lastF = f.freq; }
          biquadRun(f, buffer, 0, n);
        }
      }
      // Panning a stereo recording moves its whole picture: toward the right,
      // the left channel blends into the right one rather than disappearing.
      const p = Math.max(-1, Math.min(1, this.panBase));
      const ll = g * (p > 0 ? 1 - p : 1), lr = g * (p < 0 ? -p : 0), rr = g * (p < 0 ? 1 + p : 1), rl = g * (p > 0 ? p : 0);
      const s = this.send;
      for (let k = 0; k < n; k++) {
        const l = L[k] * ll + R[k] * lr;
        const r = R[k] * rr + L[k] * rl;
        dryL[k] += l;
        dryR[k] += r;
        if (s) send[k] += (l + r) * 0.5 * s;
      }
      return;
    }
    const m = this.mono;
    // Soft overdrive before the fader/pan; the existing low-pass acts as a
    // cabinet. A midpoint sub-sample reduces high-frequency folding.
    if (this.overdrive != null) {
      const amount = 8 + this.overdrive * 48;
      let previous = this.drivePrevious;
      for (let k = 0; k < n; k++) {
        const input = m[k];
        m[k] = 0.14 * (Math.tanh(amount * (previous + input) / 2) + Math.tanh(amount * input)) / 2;
        previous = input;
      }
      this.drivePrevious = previous;
    }
    if (this.filter) {
      const f = this.filter;
      const freq = this.filterLfo ? f.freq + this.filterLfo.depth * Math.sin(TWO_PI * this.filterLfo.rate * tMid) : f.freq;
      if (freq !== f.lastF) {
        biquadCoefs(f.type, freq, f.q, sr, f);
        f.lastF = freq;
      }
      biquadRun(f, m, 0, n);
    }
    if (this.pumpTimes) {
      const times = this.pumpTimes;
      const c = Math.exp(-1 / (0.07 * sr));
      let d = this.pumpD;
      let pi = this.pumpI;
      for (let k = 0; k < n; k++) {
        while (pi < times.length && times[pi][0] <= i0 + k) d = times[pi++][1];
        m[k] *= 1 - d;
        d *= c;
      }
      this.pumpD = d;
      this.pumpI = pi;
    }
    let pan = this.panBase;
    if (this.panLfo) pan += this.panLfo.depth * Math.sin(TWO_PI * this.panLfo.rate * tMid);
    pan = Math.max(-1, Math.min(1, pan));
    const x = ((pan + 1) / 2) * (Math.PI / 2);
    const gl = Math.cos(x) * g * Math.SQRT2;
    const gr = Math.sin(x) * g * Math.SQRT2;
    const s = this.send * g;
    for (let k = 0; k < n; k++) {
      const v = m[k];
      dryL[k] += v * gl;
      dryR[k] += v * gr;
      if (s) send[k] += v * s;
    }
  }
}

// --- the synth ---------------------------------------------------------------------------------

export class Synth {
  constructor(sampleRate, length, { reverb = null, reverbLevel = 0, gain = 1, highpass = 0 } = {}) {
    this.sr = sampleRate;
    this.length = length;
    this.lanes = [];
    this.pending = [];
    this.sorted = null;
    this.active = [];
    this.next = 0;
    this.reverb = reverb ? new Reverb(sampleRate, reverb) : null;
    this.reverbLevel = reverbLevel;
    this.gain = gain;
    this.hp = null;
    if (highpass > 0) {
      this.hp = [makeFilter('highpass', highpass, 0.707), makeFilter('highpass', highpass, 0.707)];
      for (const f of this.hp) biquadCoefs('highpass', highpass, 0.707, sampleRate, f);
    }
    this.send = new Float32Array(BLOCK);
    this.acc = new Float32Array(BLOCK);
    this.accR = new Float32Array(BLOCK);
    this.tmp = new Float32Array(BLOCK);
    this.amp = new Float32Array(BLOCK);
    this.fq = new Float32Array(BLOCK);
    this.dep = new Float32Array(BLOCK);
    this.pan = new Float32Array(BLOCK);
  }

  lane(spec) {
    const lane = new Lane(this, spec);
    this.lanes.push(lane);
    return lane;
  }

  add(lane, voice) {
    voice.lane = lane;
    voice.start = Math.max(0, Math.round(voice.t0 * this.sr));
    voice.end = Math.min(this.length, Math.round(voice.t1 * this.sr));
    voice.order = this.pending.length;
    if (voice.end > voice.start) this.pending.push(voice);
    return voice;
  }

  _begin(v) {
    const sr = this.sr;
    for (const L of v.layers) {
      L.amp.begin(sr, v.start);
      if (L.freqEnv) L.freqEnv.begin(sr, v.start);
      if (L.fm) L.fm.depth.begin(sr, v.start);
      L.ph = 0;
      L.mph = 0;
      L.rs = (L.seed >>> 0) || 0x9e3779b9;
      L.b0 = 0;
      L.b1 = 0;
      L.b2 = 0;
      L.mul = L.detune ? Math.pow(2, L.detune / 1200) : 1;
      L.pos = L.start ?? 0;
      if (L.wave === 7) {
        const delay = Math.max(2, sr / L.freq - 0.5);
        const length = Math.ceil(delay);
        L.string = new Float32Array(length);
        L.stringFraction = length - delay;
        L.stringIndex = 0;
        L.stringPrevious = 0;
        let sum = 0, seed = L.rs;
        for (let i = 0; i < length; i++) {
          seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
          L.string[i] = (seed >>> 0) / 2147483648 - 1;
          sum += L.string[i];
        }
        for (let i = 0; i < length; i++) L.string[i] -= sum / length;
        L.stringLoss = Math.exp(-1 / (L.freq * (L.decay ?? 2)));
      }
    }
    if (v.filter) {
      const f = v.filter;
      Object.assign(f, { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, z1: 0, z2: 0, lastF: -1 });
      if (f.freqEnv) f.freqEnv.begin(sr, v.start);
      if (v.stereo) {
        v.filterR = { ...f, z1: 0, z2: 0, lastF: -1 };
        if (f.freqEnv) v.filterR.freqEnv = null;
      }
    }
    if (v.panEnv) v.panEnv.begin(sr, v.start);
  }

  _renderVoice(v, i0, n) {
    const a = Math.max(v.start, i0);
    const b = Math.min(v.end, i0 + n);
    const cnt = b - a;
    if (cnt <= 0) return;
    const sr = this.sr;
    const acc = this.acc;
    const accR = this.accR;
    const amp = this.amp;
    const fq = this.fq;
    acc.fill(0, 0, cnt);
    if (v.stereo) accR.fill(0, 0, cnt);
    for (const L of v.layers) {
      L.amp.fill(amp, cnt);
      if (L.freqEnv) L.freqEnv.fill(fq, cnt);
      const mul = L.mul;
      const fixed = L.freq * mul;
      let ph = L.ph;
      switch (L.wave) {
        case 0: { // sine, optional FM
          if (L.fm) {
            const dep = this.dep;
            L.fm.depth.fill(dep, cnt);
            let mph = L.mph;
            const ratio = L.fm.ratio;
            for (let k = 0; k < cnt; k++) {
              const f = L.freqEnv ? fq[k] * mul : fixed;
              let x = mph * TABLE;
              let i = x | 0;
              const mod = SINE[i] + (SINE[i + 1] - SINE[i]) * (x - i);
              mph += (f * ratio) / sr;
              mph -= Math.floor(mph);
              x = ph * TABLE;
              i = x | 0;
              acc[k] += (SINE[i] + (SINE[i + 1] - SINE[i]) * (x - i)) * amp[k];
              ph += (f + dep[k] * mod) / sr;
              ph -= Math.floor(ph);
            }
            L.mph = mph;
          } else if (L.freqEnv) {
            for (let k = 0; k < cnt; k++) {
              const x = ph * TABLE;
              const i = x | 0;
              acc[k] += (SINE[i] + (SINE[i + 1] - SINE[i]) * (x - i)) * amp[k];
              ph += (fq[k] * mul) / sr;
              ph -= Math.floor(ph);
            }
          } else {
            const inc = fixed / sr;
            for (let k = 0; k < cnt; k++) {
              const x = ph * TABLE;
              const i = x | 0;
              acc[k] += (SINE[i] + (SINE[i + 1] - SINE[i]) * (x - i)) * amp[k];
              ph += inc;
              if (ph >= 1) ph -= 1;
            }
          }
          break;
        }
        case 1: { // saw (PolyBLEP)
          const env = L.freqEnv;
          let dt = fixed / sr;
          for (let k = 0; k < cnt; k++) {
            if (env) dt = (fq[k] * mul) / sr;
            let v = 2 * ph - 1;
            if (ph < dt) {
              const u = ph / dt;
              v -= u + u - u * u - 1;
            } else if (ph > 1 - dt) {
              const u = (ph - 1) / dt;
              v -= u * u + u + u + 1;
            }
            acc[k] += v * amp[k];
            ph += dt;
            if (ph >= 1) ph -= 1;
          }
          break;
        }
        case 3: { // pulse: difference of two band-limited saws; duty 0.5 is a square
          const env = L.freqEnv;
          const duty = L.duty ?? 0.5;
          let dt = fixed / sr;
          for (let k = 0; k < cnt; k++) {
            if (env) dt = (fq[k] * mul) / sr;
            let p2 = ph + duty;
            if (p2 >= 1) p2 -= 1;
            const s = (2 * ph - 1 - polyblep(ph, dt) - (2 * p2 - 1 - polyblep(p2, dt))) * 0.5;
            acc[k] += s * amp[k];
            ph += dt;
            if (ph >= 1) ph -= 1;
          }
          break;
        }
        case 2: { // triangle
          const env = L.freqEnv;
          let dt = fixed / sr;
          for (let k = 0; k < cnt; k++) {
            if (env) dt = (fq[k] * mul) / sr;
            acc[k] += (4 * Math.abs(ph - 0.5) - 1) * amp[k];
            ph += dt;
            if (ph >= 1) ph -= 1;
          }
          break;
        }
        case 4: { // white noise
          let s = L.rs;
          for (let k = 0; k < cnt; k++) {
            s ^= s << 13;
            s ^= s >>> 17;
            s ^= s << 5;
            acc[k] += ((s >>> 0) / 2147483648 - 1) * amp[k];
          }
          L.rs = s;
          break;
        }
        case 5: { // pink noise (Paul Kellet economy filter)
          let s = L.rs;
          let b0 = L.b0;
          let b1 = L.b1;
          let b2 = L.b2;
          for (let k = 0; k < cnt; k++) {
            s ^= s << 13;
            s ^= s >>> 17;
            s ^= s << 5;
            const w = (s >>> 0) / 2147483648 - 1;
            b0 = 0.99765 * b0 + w * 0.099046;
            b1 = 0.963 * b1 + w * 0.2965164;
            b2 = 0.57 * b2 + w * 1.0526913;
            acc[k] += (b0 + b1 + b2 + w * 0.1848) * 0.22 * amp[k];
          }
          L.rs = s;
          L.b0 = b0;
          L.b1 = b1;
          L.b2 = b2;
          break;
        }
        case 6: { // recorded sample, 4-point Hermite interpolation, optional sustain loop
          const data = L.data, last = data.length - 2, step = L.step * mul, loop = L.loop;
          let pos = L.pos;
          for (let k = 0; k < cnt; k++) {
            if (loop && pos >= loop[1]) pos -= loop[1] - loop[0];
            const i = pos | 0;
            if (i >= last) break;
            const f = pos - i, xm1 = data[i > 0 ? i - 1 : 0], x0 = data[i], x1 = data[i + 1], x2 = data[i + 2];
            const c1 = 0.5 * (x1 - xm1), c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2, c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
            acc[k] += (((c3 * f + c2) * f + c1) * f + x0) * amp[k];
            pos += step;
          }
          L.pos = pos;
          break;
        }
        case 8: { // recording read from its pack while it plays, windowed-sinc pitching, optional loop, mono or stereo
          const source = L.source, step = L.step * mul, loop = L.loop, last = source.frames;
          let pos = L.pos;
          if (!loop) source.ensure(Math.floor(pos) - SINC_TAPS / 2, Math.ceil(pos + step * cnt) + SINC_TAPS / 2 + 1);
          const base = source.base, left = source.data[0], right = source.data[1] ?? left, S = SINC;
          // Stereo voices fill both accumulators; a mono lane takes the average of the channels.
          const both = v.stereo, two = right !== left, exact = step === 1 && pos === Math.floor(pos);
          const offset = 1 - SINC_TAPS / 2 - base;
          for (let k = 0; k < cnt; k++) {
            if (loop !== null && loop !== undefined && pos >= loop[1]) pos -= loop[1] - loop[0];
            const i = pos | 0;
            if (i >= last) break;
            const a = amp[k];
            let l, r;
            if (exact) { l = left[i - base]; r = right[i - base]; } else {
              const w = ((pos - i) * SINC_PHASES + 0.5 | 0) * SINC_TAPS, f = i + offset;
              l = S[w + 0] * left[f + 0] + S[w + 1] * left[f + 1] + S[w + 2] * left[f + 2] + S[w + 3] * left[f + 3] + S[w + 4] * left[f + 4] + S[w + 5] * left[f + 5] + S[w + 6] * left[f + 6] + S[w + 7] * left[f + 7] + S[w + 8] * left[f + 8] + S[w + 9] * left[f + 9] + S[w + 10] * left[f + 10] + S[w + 11] * left[f + 11] + S[w + 12] * left[f + 12] + S[w + 13] * left[f + 13] + S[w + 14] * left[f + 14] + S[w + 15] * left[f + 15];
              r = two ? S[w + 0] * right[f + 0] + S[w + 1] * right[f + 1] + S[w + 2] * right[f + 2] + S[w + 3] * right[f + 3] + S[w + 4] * right[f + 4] + S[w + 5] * right[f + 5] + S[w + 6] * right[f + 6] + S[w + 7] * right[f + 7] + S[w + 8] * right[f + 8] + S[w + 9] * right[f + 9] + S[w + 10] * right[f + 10] + S[w + 11] * right[f + 11] + S[w + 12] * right[f + 12] + S[w + 13] * right[f + 13] + S[w + 14] * right[f + 14] + S[w + 15] * right[f + 15] : l;
            }
            if (both) { acc[k] += l * a; accR[k] += r * a; } else acc[k] += 0.5 * (l + r) * a;
            pos += step;
          }
          L.pos = pos;
          break;
        }
        case 7: { // fractional-delay Karplus–Strong plucked string
          const buffer = L.string, length = buffer.length;
          let index = L.stringIndex, previous = L.stringPrevious;
          const fraction = L.stringFraction, loss = L.stringLoss;
          for (let k = 0; k < cnt; k++) {
            const next = index + 1 === length ? 0 : index + 1;
            const value = buffer[index] * (1 - fraction) + buffer[next] * fraction;
            buffer[index] = (value + previous) * 0.5 * loss;
            previous = value;
            acc[k] += value * amp[k];
            index = next;
          }
          L.stringIndex = index; L.stringPrevious = previous;
          break;
        }
        default:
          break;
      }
      L.ph = ph;
    }

    if (v.filter) {
      const f = v.filter;
      if (f.freqEnv) {
        f.freqEnv.fill(fq, cnt);
        for (let k = 0; k < cnt; k += 16) {
          const e = Math.min(cnt, k + 16);
          if (fq[k] !== f.lastF) {
            const { z1, z2 } = f;
            biquadCoefs(f.type, fq[k], f.q, sr, f);
            f.z1 = z1;
            f.z2 = z2;
            f.lastF = fq[k];
          }
          biquadRun(f, acc, k, e);
        }
      } else {
        if (f.lastF !== f.freq) {
          biquadCoefs(f.type, f.freq, f.q, sr, f);
          f.lastF = f.freq;
        }
        biquadRun(f, acc, 0, cnt);
        if (v.stereo) {
          const g = v.filterR;
          if (g.lastF !== g.freq) { biquadCoefs(g.type, g.freq, g.q, sr, g); g.lastF = g.freq; }
          biquadRun(g, accR, 0, cnt);
        }
      }
    }

    const lane = v.lane;
    lane.dirty = true;
    const off = a - i0;
    if (v.stereo) {
      if (lane.stereo) {
        const L = lane.L, R = lane.R;
        for (let k = 0; k < cnt; k++) { L[off + k] += acc[k]; R[off + k] += accR[k]; }
      } else {
        const m = lane.mono;
        for (let k = 0; k < cnt; k++) m[off + k] += 0.5 * (acc[k] + accR[k]);
      }
    } else if (lane.stereo) {
      const pan = this.pan;
      if (v.panEnv) v.panEnv.fill(pan, cnt);
      const L = lane.L;
      const R = lane.R;
      for (let k = 0; k < cnt; k++) {
        const p = v.panEnv ? pan[k] : v.pan;
        const x = ((Math.max(-1, Math.min(1, p)) + 1) / 2) * (Math.PI / 2);
        L[off + k] += acc[k] * Math.cos(x) * Math.SQRT2;
        R[off + k] += acc[k] * Math.sin(x) * Math.SQRT2;
      }
    } else {
      const m = lane.mono;
      for (let k = 0; k < cnt; k++) m[off + k] += acc[k];
    }
  }

  // Renders samples [i0, i0 + n) (n <= BLOCK) and ADDS them into outL/outR.
  renderBlock(i0, n, outL, outR) {
    if (!this.sorted) {
      this.sorted = this.pending.slice().sort((x, y) => x.start - y.start || x.order - y.order);
      this.next = 0;
    }
    const end = i0 + n;
    const sorted = this.sorted;
    while (this.next < sorted.length && sorted[this.next].start < end) {
      const v = sorted[this.next++];
      this._begin(v);
      this.active.push(v);
    }
    for (const lane of this.lanes) lane.clear(n);
    for (const v of this.active) this._renderVoice(v, i0, n);
    if (this.active.length) {
      // A finished voice lets go of the recording window it was reading.
      for (const v of this.active) if (v.end <= end) for (const layer of v.layers) if (layer.source && !layer.source.whole) layer.source.data = null;
      this.active = this.active.filter((v) => v.end > end);
    }

    const send = this.send;
    send.fill(0, 0, n);
    const dryL = this.tmp;
    const dryR = this.acc;
    dryL.fill(0, 0, n);
    dryR.fill(0, 0, n);
    for (const lane of this.lanes) lane.mix(i0, n, dryL, dryR, send);
    if (this.reverb) this.reverb.process(send, n, dryL, dryR, this.reverbLevel);
    if (this.hp) {
      biquadRun(this.hp[0], dryL, 0, n);
      biquadRun(this.hp[1], dryR, 0, n);
    }
    const g = this.gain;
    for (let k = 0; k < n; k++) {
      outL[k] += dryL[k] * g;
      outR[k] += dryR[k] * g;
    }
  }
}
