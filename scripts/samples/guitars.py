"""Electric guitars: FreePats Electric Guitar FSBS (CC0), a Fender guitar on
the bridge pickup. Clean: the 48 kHz stereo amp-and-effects version. Crunch:
the 48 kHz mono direct (DI) recording, which the engine overdrives. Mapped as
their SFZ files: a soft layer up to velocity 92 and a normal one above, four
takes each. The source files are each normalized to full scale, which hides
how loud each note was played, so every file is matched on K-weighted
loudness over its first 300 ms; velocity then shapes the level, as the SFZ
does."""
import os

import numpy as np
import soundfile as sf

import sfz

CLEAN = ('fsbs-clean', 'EGuitarFSBS-clean bridge 20260807.sfz')
DIRECT = ('fsbs-direct', 'EGuitarFSBS-direct bridge 20220911.sfz')


def k_weighted_rms(data, rate):
    """RMS after the ITU-R BS.1770 K-weighting (shelf and high-pass)."""
    from scipy.signal import lfilter
    import math
    # BS.1770 pre-filter coefficients, recomputed for the rate.
    f0, g, q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    k = math.tan(math.pi * f0 / rate)
    vh, vb = 10 ** (g / 20), 10 ** (g / 20) ** 0.499666774155
    a0 = 1 + k / q + k * k
    b = [(vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0]
    a = [1, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0]
    f1, q1 = 38.13547087602444, 0.5003270373238773
    k1 = math.tan(math.pi * f1 / rate)
    a1 = [1, 2 * (k1 * k1 - 1) / (1 + k1 / q1 + k1 * k1), (1 - k1 / q1 + k1 * k1) / (1 + k1 / q1 + k1 * k1)]
    b1 = [1, -2, 1]
    y = lfilter(b1, a1, lfilter(b, a, data, axis=0), axis=0)
    return float(np.sqrt(np.mean(y ** 2)))


def build_from(sources, pack, folder, program, instrument, channels):
    root = os.path.join(sources, folder)
    _, regions = sfz.parse(os.path.join(root, program))
    loaded = {}
    for region in regions:
        path = region['sample'].replace('\\', '/')
        if path not in loaded:
            data, rate = sf.read(os.path.join(root, path), dtype='float64', always_2d=True)
            assert rate == 48000 and data.shape[1] == channels, (path, rate, data.shape)
            loaded[path] = data
    window = int(0.3 * 48000)
    loudness = {path: k_weighted_rms(data[:window], 48000) for path, data in loaded.items()}
    target = float(np.median(list(loudness.values())))
    gains = {path: target / loudness[path] for path in loaded}
    peak = max(np.abs(data).max() * gains[path] for path, data in loaded.items())
    common = 10 ** (-1 / 20) / peak
    out = []
    for region in regions:
        path = region['sample'].replace('\\', '/')
        name = os.path.splitext(os.path.basename(path))[0]
        if name not in pack.index:
            frames = np.round(loaded[path] * gains[path] * common * 8388607).astype(np.int32)
            pack.add(name, frames if channels == 2 else frames[:, 0], 48000, 24)
        # SFZ "key=N" sets lokey, hikey and pitch_keycenter at once.
        key = int(region['key']) if 'key' in region else None
        out.append({'sample': name, 'lokey': key if key is not None else int(region['lokey']), 'hikey': key if key is not None else int(region['hikey']),
                    'key': key if key is not None else int(region['pitch_keycenter']),
                    'lovel': int(region.get('lovel', 1)), 'hivel': int(region.get('hivel', 127)), 'tune': float(region.get('tune', 0)), 'gain': 0.0})
    out.sort(key=lambda r: (r['lokey'], r['lovel'], r['sample']))
    return {instrument: {'model': 'regions', 'veltrack': 1.0, 'oneShot': False, 'release': float(regions[0].get('ampeg_release', 1.1)), 'regions': out}}


def build_clean(sources, pack):
    return build_from(sources, pack, *CLEAN, 'guitar-clean', 2)


def build_crunch(sources, pack):
    return build_from(sources, pack, *DIRECT, 'guitar-crunch', 1)
