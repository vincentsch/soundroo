"""Merges the manifests of packs built separately (build.py --manifest) into
assets/samples/samples.json, and records where each pack is published.

    python scripts/samples/merge.py [--release TAG] [MANIFEST ...]

--release TAG sets the download address of every pack without one to that
release of the toolkit repository on GitHub, where the packs are uploaded as
<name>-<first 16 hex digits of the SHA-256>.pack."""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TARGET = os.path.join(ROOT, 'assets', 'samples', 'samples.json')


RELEASES = 'https://github.com/vincentsch/soundroo/releases/download'


def main():
    args = sys.argv[1:]
    tag = None
    if args[:1] == ['--release']:
        tag, args = args[1], args[2:]
    merged = json.load(open(TARGET)) if os.path.exists(TARGET) else {'version': 2, 'packs': {}, 'instruments': {}}
    for path in args:
        part = json.load(open(path))
        merged['packs'].update(part['packs'])
        merged['instruments'].update(part['instruments'])
    if tag:
        for name, pack in merged['packs'].items():
            pack.setdefault('url', f'{RELEASES}/{tag}/{name}-{pack["sha256"][:16]}.pack')
    with open(TARGET, 'w') as handle:
        json.dump(merged, handle, indent=1, sort_keys=True)
        handle.write('\n')
    print(', '.join(f'{name} {pack["size"] / 1e9:.2f} GB' for name, pack in sorted(merged['packs'].items())))


if __name__ == '__main__':
    main()
