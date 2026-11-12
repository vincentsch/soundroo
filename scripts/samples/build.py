"""Builds the recorded-instrument packs and their manifest.

    python scripts/samples/build.py --sources DIR --out DIR [--manifest FILE] [pack ...]

DIR for --sources holds the source libraries (see assets/samples/SOURCES.md).
Each pack becomes <out>/<pack>.pack; the instrument mappings and the place of
every recording in its pack go into assets/samples/samples.json (or FILE).
Needs Python 3.11+, numpy and soundfile.

A builder module has build(sources, pack) -> {instrument id: spec}. It adds
its recordings to `pack` (pack.PackWriter) and returns one spec per
instrument that plays from the pack. Specs other than the piano's use the
"regions" model, an SFZ-like map the engine plays generically:

    {
      "model": "regions",
      "veltrack": 1.0,     # share of the level that follows velocity along a
                           # square curve (SFZ amp_veltrack / 100); the
                           # recorded layers carry the rest of the dynamics
      "oneShot": false,    # true for drums: notes ring out whatever their length
      "unpitched": false,  # true for drums other than toms: pitch never retunes
      "maxShift": 3,       # optional: retune by at most this many semitones
      "release": 0.3,      # seconds to fade after the note ends (not one-shot)
      "layerVelocity": "linear",  # optional: in each region the level rises
                           # in a straight line to full at its hivel (SFZ
                           # amp_velcurve_<hivel>=1); a region's own "velTop"
                           # does the same for one region
      "regions": [{
        "sample": "name in the pack",
        "lokey": 40, "hikey": 42,    # MIDI keys the recording plays
        "key": 41,                   # MIDI pitch it was recorded at
        "lovel": 1, "hivel": 127,    # MIDI velocities (1-127) it plays
        "tune": 0.0,                 # cents to retune it by
        "gain": 0.0,                 # dB applied at playback
        "loop": [start, end]         # optional sustain loop in frames, end
                                     # exclusive; the material after `end`
                                     # continues from `start`
      }]
    }

Regions with the same key and velocity ranges are alternative takes (round
robins); the engine picks one at random and avoids repeating the last one.
Recordings keep their own sample rate, channel count and level; store them
at 24 bits when processing (mixing microphones, matching levels, loops)
changed them, otherwise at their source depth."""
import argparse
import importlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from pack import PackWriter  # noqa: E402

# Pack name -> (builder module, function).
BUILDERS = {
    'piano': ('piano', 'build'),
    'drums': ('drums', 'build'),
    'strings': ('vsco', 'build_strings'),
    'brass': ('vsco', 'build_brass'),
    'electric-bass': ('bass', 'build'),
    'guitar-clean': ('guitars', 'build_clean'),
    'guitar-crunch': ('guitars', 'build_crunch'),
}
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, 'assets', 'samples', 'samples.json')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sources', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--manifest', default=MANIFEST)
    parser.add_argument('packs', nargs='*')
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)
    manifest = {'version': 2, 'packs': {}, 'instruments': {}}
    if os.path.exists(args.manifest):
        current = json.load(open(args.manifest))
        if current.get('version') == 2:
            manifest = current
    for name in args.packs or BUILDERS:
        pack = PackWriter(os.path.join(args.out, f'{name}.pack'))
        module, function = BUILDERS[name]
        specs = getattr(importlib.import_module(module), function)(args.sources, pack)
        facts = pack.close()
        manifest['packs'][name] = {**facts, 'samples': pack.index}
        for instrument, spec in specs.items():
            manifest['instruments'][instrument] = {'pack': name, **spec}
        print(f'{name}: {len(pack.index)} recordings, {facts["size"] / 1e9:.2f} GB, sha256 {facts["sha256"]}', flush=True)
    with open(args.manifest, 'w') as handle:
        json.dump(manifest, handle, indent=1, sort_keys=True)
        handle.write('\n')


if __name__ == '__main__':
    main()
