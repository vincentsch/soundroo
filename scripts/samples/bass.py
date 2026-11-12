"""Electric bass: Fashionbass by Karoryfer Lecolds (CC0), a Killer KB-Simmony
bass played and mapped by D. Smolken, recorded direct. Mapped exactly as its
own fashionbass.sfz: five velocity layers with three takes each, and string
release sounds. The 44.1 kHz float recordings are stored at 24 bits."""
import os

import numpy as np
import soundfile as sf

import sfz

PROGRAM = os.path.join('fashionbass', 'fashionbass.sfz')


def build(sources, pack):
    root = os.path.join(sources, 'fashionbass')
    _, regions = sfz.parse(os.path.join(sources, PROGRAM))
    names = {}

    def add(sample):
        path = sample.replace('\\', '/')
        name = os.path.splitext(os.path.basename(path))[0]
        if name not in names:
            data, rate = sf.read(os.path.join(root, path), dtype='float64', always_2d=True)
            assert rate == 44100, path
            frames = np.clip(np.round(data * 8388607), -8388608, 8388607).astype(np.int32)
            pack.add(name, frames, rate, 24)
            names[name] = True
        return name

    notes, releases = [], []
    for region in regions:
        sample = region.get('sample', '')
        if not sample or 'noises' in sample.replace('\\', '/'):
            continue  # fingering and muted-string noises live on keys 84 and up; not played
        lokey, hikey, key = int(region['lokey']), int(region['hikey']), int(region['pitch_keycenter'])
        lovel, hivel = int(region.get('lovel', 1)), int(region.get('hivel', 127))
        entry = {'sample': add(sample), 'lokey': lokey, 'hikey': hikey, 'key': key, 'lovel': lovel, 'hivel': hivel,
                 'tune': float(region.get('tune', 0)), 'gain': float(region.get('volume', 0)), 'release': float(region.get('ampeg_release', 0.05))}
        if region.get('trigger') == 'release':
            entry['rtDecay'] = float(region.get('rt_decay', 0))
            releases.append(entry)
        else:
            # amp_velcurve_N=1: the level rises in a straight line from 0 to full at the layer's top velocity.
            tops = [int(k.split('_')[-1]) for k in region if k.startswith('amp_velcurve_')]
            if tops:
                entry['velTop'] = tops[0]
            notes.append(entry)
    notes.sort(key=lambda r: (r['lokey'], r['lovel'], r['sample']))
    releases.sort(key=lambda r: (r['lokey'], r['sample']))
    assert len(notes) == 15 * len({r['lokey'] for r in notes}), len(notes)
    return {'electric-bass': {'model': 'regions', 'veltrack': 1.0, 'oneShot': False, 'release': 0.05, 'regions': notes, 'releaseRegions': releases}}
