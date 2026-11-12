"""Grand piano: Salamander Grand Piano V3 (Alexander Holm, public domain),
mapped exactly as its SFZ edition maps it, with the "Retuned" tuning by Markus
Fiedler. Every recording is copied unchanged: 48 kHz, 24-bit, stereo, full
length."""
import os

import sfz
from pack import read_int

SOURCE_FOLDER = 'salamander'
PROGRAM = 'Salamander Grand Piano V3.sfz'


def number(region, key, default=None, cast=float):
    value = region.get(key)
    return default if value is None else cast(value)


def build(sources, pack):
    root = os.path.join(sources, SOURCE_FOLDER)
    _, regions = sfz.parse(os.path.join(root, PROGRAM))
    notes, releases, pedal = [], [], {'down': [], 'up': []}
    seen = set()

    def add(sample):
        name = os.path.splitext(sample)[0]
        if name not in seen:
            frames, rate, bits = read_int(os.path.join(root, 'Samples', sample))
            assert rate == 48000 and bits == 24 and frames.shape[1] == 2, sample
            pack.add(name, frames, rate, bits)
            seen.add(name)
        return name

    for region in regions:
        sample = region['sample'].replace('\\', '/').split('/')[-1]
        trigger = region.get('trigger', 'attack')
        label = region.get('group_label', '')
        if label in ('pedalD', 'pedalU'):
            pedal['down' if label == 'pedalD' else 'up'].append(add(sample))
            pedal['downGain' if label == 'pedalD' else 'upGain'] = number(region, 'volume', 0)
            continue
        if trigger == 'attack':
            # The SFZ has a "Natural" and a "Retuned" set of the same recordings; we use the retuned one.
            if region.get('sw_last') != 'C#0':
                continue
            notes.append({
                'sample': add(sample), 'lokey': int(region['lokey']), 'hikey': int(region['hikey']), 'key': int(region['pitch_keycenter']),
                'lovel': int(region['lovel']), 'hivel': int(region['hivel']), 'tune': number(region, 'tune', 0),
                # Notes from F#6 up have no dampers: they ring on after the key is released.
                'release': number(region, 'ampeg_release', 1.0),
            })
        else:
            key = number(region, 'key', None, int)
            releases.append({
                'sample': add(sample), 'kind': 'hammer' if label == 'rel' else 'resonance',
                'lokey': key if key is not None else int(region['lokey']), 'hikey': key if key is not None else int(region['hikey']),
                'key': key if key is not None else int(region['pitch_keycenter']),
                'lovel': number(region, 'lovel', 1, int), 'hivel': number(region, 'hivel', 127, int),
                'gain': number(region, 'volume', 0), 'veltrack': number(region, 'amp_veltrack', 100) / 100, 'rtDecay': number(region, 'rt_decay', 0),
            })
    notes.sort(key=lambda r: (r['lokey'], r['lovel']))
    releases.sort(key=lambda r: (r['kind'], r['lokey'], r['lovel']))
    assert len(notes) == 480 and len(releases) == 157 and len(pedal['down']) == 2 and len(pedal['up']) == 2
    return {'piano': {
        'model': 'piano',
        # amp_veltrack 27%: the 16 recorded layers carry the dynamics, velocity only fine-tunes the level.
        'veltrack': 0.27,
        # A key struck again fades the string's earlier sound over 0.5 s (the SFZ's note_polyphony=1, off_time=0.5).
        'restrike': 0.5,
        'regions': notes,
        'releaseRegions': releases,
        'pedal': pedal,
    }}
