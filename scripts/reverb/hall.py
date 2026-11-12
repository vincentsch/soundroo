"""Generates assets/reverb/hall.wav, the impulse response of the master
reverb: a medium concert hall made from decaying noise, so it has no source
to credit. It is deterministic (fixed seed), stereo with independent channels,
and decays faster in the treble, as air and seats absorb high frequencies.

    python scripts/reverb/hall.py

Needs numpy and soundfile."""
import os

import numpy as np
import soundfile as sf

RATE = 48000
LENGTH = 3.6
PREDELAY = 0.018
# Reverberation time (seconds to fall 60 dB) at each octave-band centre.
BANDS = [(63, 2.4), (125, 2.3), (250, 2.1), (500, 1.95), (1000, 1.85), (2000, 1.65), (4000, 1.35), (8000, 0.95), (16000, 0.6)]
# Early reflections: (delay s, gain, pan -1..1) of the first walls, before the tail fills in.
EARLY = [(0.011, 0.55, -0.6), (0.017, 0.48, 0.7), (0.023, 0.42, -0.2), (0.029, 0.38, 0.45), (0.034, 0.33, -0.8),
         (0.041, 0.30, 0.25), (0.047, 0.27, 0.85), (0.053, 0.25, -0.45), (0.061, 0.22, 0.1), (0.068, 0.2, -0.7),
         (0.074, 0.18, 0.6), (0.083, 0.16, -0.15)]
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'assets', 'reverb', 'hall.wav')


def band_weights(freqs):
    """Smooth octave-band weights (raised cosine on a log axis) that sum to 1."""
    centres = np.log2([c for c, _ in BANDS])
    x = np.log2(np.maximum(freqs, 20))
    weights = np.zeros((len(BANDS), len(freqs)))
    for i, c in enumerate(centres):
        d = np.abs(x - c)
        weights[i] = np.where(d < 1, 0.5 + 0.5 * np.cos(np.pi * d), 0)
    weights[0][x < centres[0]] = 1
    weights[-1][x > centres[-1]] = 1
    return weights / np.maximum(weights.sum(axis=0), 1e-9)


def channel(rng):
    n = int(LENGTH * RATE)
    t = np.arange(n) / RATE
    spectrum = np.fft.rfft(rng.standard_normal(n))
    freqs = np.fft.rfftfreq(n, 1 / RATE)
    weights = band_weights(freqs)
    tail = np.zeros(n)
    for (centre, rt60), weight in zip(BANDS, weights):
        band = np.fft.irfft(spectrum * weight, n)
        tail += band * np.exp(-6.9078 * t / rt60)
    # The tail builds up over the first 60 ms instead of starting at full density.
    tail *= 1 - np.exp(-t / 0.025)
    return tail


def main():
    rng = np.random.default_rng(20261112)
    left, right = channel(rng), channel(rng)
    n = len(left)
    tail_energy = np.sqrt(np.mean(left ** 2 + right ** 2))
    left, right = left / tail_energy, right / tail_energy
    out = np.zeros((n, 2))
    start = int(PREDELAY * RATE)
    out[start:, 0] = left[: n - start] * 0.9
    out[start:, 1] = right[: n - start] * 0.9
    for delay, gain, pan in EARLY:
        i = int(delay * RATE)
        angle = (pan + 1) * np.pi / 4
        out[i, 0] += gain * np.cos(angle) * 40
        out[i, 1] += gain * np.sin(angle) * 40
    # Soft treble roll-off of the reflections (a one-pole low-pass at about 9 kHz).
    a = np.exp(-2 * np.pi * 9000 / RATE)
    for c in range(2):
        y, prev = out[:, c].copy(), 0.0
        for i in range(n):
            prev = (1 - a) * y[i] + a * prev
            y[i] = prev
        out[:, c] = y
    fade = int(0.3 * RATE)
    out[-fade:] *= np.cos(np.linspace(0, np.pi / 2, fade))[:, None] ** 2
    out /= np.abs(out).max() / 0.9
    sf.write(OUT, out, RATE, subtype='PCM_24')
    print(OUT, f'{n / RATE:.1f} s')


if __name__ == '__main__':
    main()
