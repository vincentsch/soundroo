"""The acoustic drum kit: Big Rusty Drums by Karoryfer Lecolds (CC0), every
velocity layer and round robin of the articulations the engine plays, mixed
from the close and overhead microphones into stereo as the library's default
program (Programs/default/01-full.sfz) sets them up. Overheads stay stereo,
close microphones are panned where the program pans them, full length, native
44.1 kHz, written at 24 bits because mixing changes the values."""
import os
import re

import numpy as np
import soundfile as sf
from scipy.signal import butter, lfilter

SOURCE_FOLDER = 'big-rusty-drums'
RATE = 44100
CEILING = 10 ** (-1 / 20)

# Mic level = amplitude_ccN / 100 x set_ccN / 127 in the default program.
CC = lambda amplitude, value: amplitude / 100 * value / 127  # noqa: E731
# Close-mic pan from pan_ccN=100 and the program's bipolar curve 9 (0 at cc 63).
PAN = lambda value: (value - 63) / (64 if value >= 63 else 63)  # noqa: E731

# Each kit piece: the mapping file that holds its velocity groups and round
# robins (close mic), and the microphones summed for each hit:
# (folder, level, pan or None for a stereo pair, options).
KIT = {
    'rock-kick': {'key': 36, 'map': 'kick_24/k_kick.sfz', 'mics': [
        ('kick_24/kick/kick', CC(100, 100), 0.0, {}),
        # The default program has the kick's overhead and snare-mic faders at 0; as in the October build
        # they are mixed in at levels the bundled presets use, the overheads through the program's
        # 300 Hz 2-pole high-pass for this layer.
        ('kick_24/kick/oh', 0.40, None, {'highpass': 300}),
        ('kick_24/kick/sn', 0.40 * 0.20, 0.0, {}),
    ]},
    'rock-snare': {'key': 38, 'map': 'snare_14/sn_center_btm.sfz', 'mics': [
        # Bottom mic inverted: with it the snare's 100-500 Hz body adds up instead of cancelling.
        ('snare_14/center/btm', CC(100, 100), PAN(63), {'invert': True}),
        ('snare_14/center/top', CC(100, 40), PAN(63), {}),
        ('snare_14/center/oh', CC(100, 60), None, {}),
    ]},
    'closed-hat': {'key': 42, 'map': 'hihat_14/ht_tc_cl.sfz', 'mics': [
        ('hihat_14/tc/cl', CC(70, 100), PAN(63), {}),
        ('hihat_14/tc/oh', CC(70, 100), None, {}),
    ]},
    # Half-open hat: the fully open one rings for about 7 s before it is 40 dB down.
    'open-hat': {'key': 46, 'map': 'hihat_14/ht_ho_cl.sfz', 'mics': [
        ('hihat_14/ho/cl', CC(70, 100), PAN(63), {}),
        ('hihat_14/ho/oh', CC(70, 100), None, {}),
    ]},
    'crash': {'key': 49, 'map': 'crash_17/cr_cl.sfz', 'mics': [
        ('crash_17/cr/cl', CC(70, 40), PAN(30), {}),
        ('crash_17/cr/oh', CC(70, 100), None, {}),
    ]},
    'ride': {'key': 51, 'map': 'ride_22/rd_cl.sfz', 'mics': [
        ('ride_22/rd/cl', CC(60, 40), PAN(97), {}),
        ('ride_22/rd/oh', CC(60, 100), None, {}),
    ]},
}
# Toms: GM key, drum, close-mic pan cc, MIDI keys it plays (35-60 split to the nearest drum,
# a tie going to the lower one as in earlier engines). The snare-mic "dirt" layer is 0 in the program.
TOMS = [(41, 'tom_22', 't22', 107, 35, 43), (45, 'tom_18', 't18', 87, 44, 46), (48, 'tom_15', 't15', 40, 47, 49), (50, 'tom_14', 't14', 20, 50, 60)]


def groups(mapping):
    """[(lovel, hivel, rr, file name)] of a mapping file's regions."""
    text = open(mapping, encoding='utf-8').read()
    out = []
    for block in re.split(r'<group>', text)[1:]:
        lovel = int(re.search(r'lovel=(\d+)', block).group(1)) if 'lovel=' in block else 1
        hivel = int(re.search(r'hivel=(\d+)', block).group(1)) if 'hivel=' in block else 127
        for rr, sample in enumerate(re.findall(r'sample=(\S+)', block), 1):
            out.append((max(1, lovel), hivel, rr, os.path.basename(sample)))
    return out


def stereo(mono, pan):
    # Equal power, unity per channel at the centre (the engine's own pan law), so the mid of a
    # centred close mic is its mono level.
    angle = (pan + 1) * np.pi / 4
    return np.stack([mono * np.cos(angle) * np.sqrt(2), mono * np.sin(angle) * np.sqrt(2)], axis=1)


def mix(root, mics, name):
    parts = []
    for folder, level, pan, options in mics:
        data, rate = sf.read(os.path.join(root, 'Samples', folder, name), dtype='float64', always_2d=True)
        assert rate == RATE, (folder, name, rate)
        if options.get('highpass'):
            b, a = butter(2, options['highpass'], 'highpass', fs=RATE)
            data = lfilter(b, a, data, axis=0)
        if options.get('invert'):
            data = -data
        if pan is None:
            assert data.shape[1] == 2, (folder, name)
            parts.append(data * level)
        else:
            assert data.shape[1] == 1, (folder, name)
            parts.append(stereo(data[:, 0], pan) * level)
    length = max(len(p) for p in parts)
    out = np.zeros((length, 2))
    for p in parts:
        out[: len(p)] += p
    return out


def instrument_hits(root, piece):
    hits = []
    for lovel, hivel, rr, name in groups(os.path.join(root, 'Programs', 'mappings', piece['map'])):
        layer = int(re.search(r'_vl(\d+)_rr', name).group(1))
        hits.append({'lovel': lovel, 'hivel': hivel, 'rr': rr, 'layer': layer, 'file': name})
    return hits


def write(pack, instrument, hits, root):
    """Two passes: the loudest hit sets one common gain for the instrument, then every hit is written."""
    peak = max(np.abs(mix(root, h['mics'], h['file'])).max() for h in hits)
    gain = CEILING / peak
    regions = []
    for h in hits:
        data = mix(root, h['mics'], h['file']) * gain
        frames = np.clip(np.round(data * (1 << 23)), -(1 << 23), (1 << 23) - 1).astype(np.int32)
        pack.add(h['sample'], frames, RATE, 24)
        regions.append({'sample': h['sample'], 'lokey': h['lokey'], 'hikey': h['hikey'], 'key': h['key'],
                        'lovel': h['lovel'], 'hivel': h['hivel'], 'tune': 0.0, 'gain': 0.0})
    return regions, 20 * np.log10(gain)


POLYPHONY = {'rock-kick': 4, 'rock-snare': 6, 'closed-hat': 4, 'open-hat': 4, 'tom': 4, 'crash': 5, 'ride': 5}


def build(sources, pack):
    root = os.path.join(sources, SOURCE_FOLDER)
    specs, gains = {}, {}
    common = {
        'model': 'regions',
        # The program sets amp_velcurve_<hivel>=1 in every velocity group: inside a group the level
        # follows velocity / hivel, so each recorded layer gets louder up to its top velocity.
        # "layerVelocity": "linear" asks for exactly that; veltrack 0 keeps the plain recorded
        # levels for a player that does not know it.
        'veltrack': 0.0,
        'layerVelocity': 'linear',
        'oneShot': True,
    }
    for instrument, piece in KIT.items():
        hits = instrument_hits(root, piece)
        for h in hits:
            h.update(mics=piece['mics'], key=piece['key'], lokey=0, hikey=127,
                     sample=f"{instrument}/vl{h['layer']:02d}-rr{h['rr']}")
        regions, gains[instrument] = write(pack, instrument, hits, root)
        specs[instrument] = {**common, 'unpitched': True, 'regions': regions}
    hits = []
    for key, drum, short, pan_cc, lokey, hikey in TOMS:
        mics = [(f'{drum}/center/cl', CC(100, 100), PAN(pan_cc), {}), (f'{drum}/center/oh', CC(100, 70), None, {})]
        for h in instrument_hits(root, {'map': f'{drum}/{drum}_cl.sfz'}):
            h.update(mics=mics, key=key, lokey=lokey, hikey=hikey, sample=f"tom/{short}-vl{h['layer']:02d}-rr{h['rr']}")
            hits.append(h)
    regions, gains['tom'] = write(pack, 'tom', hits, root)
    specs['tom'] = {**common, 'unpitched': False, 'maxShift': 3, 'regions': regions}
    # Voices one drum may sound at once (the program's group polyphony): a new hit
    # fades the oldest, as a struck cymbal takes over its own ringing.
    for instrument, voices in POLYPHONY.items():
        specs[instrument]['polyphony'] = voices
    for instrument, gain in gains.items():
        print(f'  {instrument}: {len(specs[instrument]["regions"])} regions, common gain {gain:+.2f} dB', flush=True)
    return specs
