"""String section and brass: VSCO 2 Community Edition (Versilian Studios /
Sam Gossner and Ivy Audio / Simon Dalzell, CC0), the same notes as the
October build, now with every dynamic layer and round robin, in stereo at the
recordings' own 44.1 kHz and full length.

Each recording is trimmed at its first bow or breath sound, measured for
pitch (VSCO names notes one octave low), and given a sustain loop: chosen
inside the steady sustain, crossfaded with an equal-power curve, and followed
in the file by the material after the loop start, so a held note loops
seamlessly and the natural release stays at the end. Sections and instruments
recorded at different gains are matched where they meet; inside each source
the natural dynamics between layers stay. Stored at 24 bits, because the
loops and gains change the sample values."""
import json
import os
import re

import numpy as np
import soundfile as sf
from scipy.signal import lfilter

SOURCE_FOLDER = 'vsco'
RATE = 44100
NAMES = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}

# Roots of the October build: (source folder, file prefix, VSCO note name, root).
STRINGS = [
    ('Strings/Cello Section/susvib', 'susvib', 'C1', 36), ('Strings/Cello Section/susvib', 'susvib', 'E1', 40),
    ('Strings/Cello Section/susvib', 'susvib', 'G1', 43), ('Strings/Cello Section/susvib', 'susvib', 'B1', 47),
    ('Strings/Cello Section/susvib', 'susvib', 'D2', 50), ('Strings/Cello Section/susvib', 'susvib', 'F2', 53),
    ('Strings/Viola Section/susvib', 'ViolaEns_susvib', 'G2', 55), ('Strings/Viola Section/susvib', 'ViolaEns_susvib', 'B2', 59),
    ('Strings/Viola Section/susvib', 'ViolaEns_susvib', 'D3', 62), ('Strings/Viola Section/susvib', 'ViolaEns_susvib', 'F3', 65),
    ('Strings/Violin Section/susVib', 'VlnEns_susVib', 'A3', 69), ('Strings/Violin Section/susVib', 'VlnEns_susVib', 'C4', 72),
    ('Strings/Violin Section/susVib', 'VlnEns_susVib', 'E4', 76), ('Strings/Violin Section/susVib', 'VlnEns_susVib', 'G4', 79),
    ('Strings/Violin Section/susVib', 'VlnEns_susVib', 'B4', 83), ('Strings/Violin Section/susVib', 'VlnEns_susVib', 'D5', 86),
]
BRASS = [
    ('Brass/Tenor Trombone/sus', 'tenortbn_sus', 'D#1', 39), ('Brass/Tenor Trombone/sus', 'tenortbn_sus', 'F1', 41),
    ('Brass/OldTrombone/Sustain', 'Trombone_Sustain', 'A1', 45), ('Brass/Tenor Trombone/sus', 'tenortbn_sus', 'A#1', 46),
    ('Brass/Tenor Trombone/sus', 'tenortbn_sus', 'D2', 50), ('Brass/Tenor Trombone/sus', 'tenortbn_sus', 'F2', 53),
    ('Brass/OldTrombone/Sustain', 'Trombone_Sustain', 'A2', 57), ('Brass/Trumpet/sus', 'Sum_SHTrumpet_sus', 'C3', 60),
    ('Brass/Trumpet/sus', 'Sum_SHTrumpet_sus', 'D#3', 63), ('Brass/Trumpet/sus', 'Sum_SHTrumpet_sus', 'G3', 67),
    ('Brass/Trumpet/sus', 'Sum_SHTrumpet_sus', 'A#3', 70), ('Brass/Trumpet/sus', 'Sum_SHTrumpet_sus', 'D4', 74),
    ('Brass/Trumpet/sus', 'Sum_SHTrumpet_sus', 'F4', 77), ('Brass/Trumpet/sus', 'Sum_SHTrumpet_sus', 'A4', 81),
]
SECTION = {'Cello': 'cello', 'Viola': 'viola', 'Violin': 'violin', 'Tenor Trombone': 'trombone', 'OldTrombone': 'olds', 'Trumpet': 'trumpet'}


def source_of(folder):
    return next(value for key, value in SECTION.items() if f'/{key}' in f'/{folder}')


def takes(root_folder, folder, prefix, note):
    """[(layer number, take number, path)] for one note, every layer and take."""
    pattern = re.compile(re.escape(prefix) + '_' + re.escape(note) + r'_v(\d+)(?:_(?:rr)?(\d+))?\.wav$')
    found = []
    for name in sorted(os.listdir(os.path.join(root_folder, folder))):
        match = pattern.match(name)
        if match:
            found.append((int(match.group(1)), int(match.group(2) or 1), os.path.join(root_folder, folder, name)))
    assert found, (folder, note)
    return found


def velocity_ranges(layers):
    """Splits MIDI velocities 1-127 evenly over the sorted layer numbers."""
    count = len(layers)
    edges = [round(127 * i / count) for i in range(count + 1)]
    return {layer: (edges[i] + 1, edges[i + 1]) for i, layer in enumerate(layers)}


# --- analysis ---------------------------------------------------------------------------------

def k_weighted_power(x, rate=RATE):
    """Mean K-weighted power (ITU-R BS.1770) summed over channels."""
    f0, gain, q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    k = np.tan(np.pi * f0 / rate)
    vh, vb = 10 ** (gain / 20), (10 ** (gain / 20)) ** 0.4996667741545416
    a0 = 1 + k / q + k * k
    shelf_b = [(vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0]
    shelf_a = [1, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0]
    f0, q = 38.13547087602444, 0.5003270373238773
    k = np.tan(np.pi * f0 / rate)
    hp_a = [1, 2 * (k * k - 1) / (1 + k / q + k * k), (1 - k / q + k * k) / (1 + k / q + k * k)]
    y = lfilter([1, -2, 1], hp_a, lfilter(shelf_b, shelf_a, x, axis=0), axis=0)
    return float(np.mean(np.sum(y ** 2, axis=1)))


def yin(signal, lo, hi, rate=RATE, threshold=0.12):
    """Fundamental (Hz) of a mono frame by YIN, searched between lo and hi Hz."""
    x = signal - signal.mean()
    n = len(x)
    max_lag = min(n // 2, int(rate / lo) + 2)
    min_lag = max(2, int(rate / hi))
    w = n - max_lag
    size = 1 << int(np.ceil(np.log2(2 * n)))
    # r[lag] = sum over j < w of x[j] * x[j + lag]
    r = np.fft.irfft(np.fft.rfft(x, size) * np.conj(np.fft.rfft(x[:w], size)), size)[:max_lag + 1]
    energy = np.concatenate([[0], np.cumsum(x ** 2)])
    lags = np.arange(max_lag + 1)
    diff = energy[w] + (energy[lags + w] - energy[lags]) - 2 * r
    cmnd = np.ones_like(diff)
    cmnd[1:] = diff[1:] * np.arange(1, len(diff)) / np.maximum(np.cumsum(diff[1:]), 1e-12)
    best = None
    for lag in range(min_lag, max_lag - 1):
        if cmnd[lag] < threshold and cmnd[lag] <= cmnd[lag + 1]:
            best = lag
            break
    if best is None:
        best = min_lag + int(np.argmin(cmnd[min_lag:max_lag - 1]))
    a, b, c = cmnd[best - 1], cmnd[best], cmnd[best + 1]
    denominator = a - 2 * b + c
    shift = 0.5 * (a - c) / denominator if denominator != 0 else 0
    return rate / (best + shift)


def pitch(mono, start, end, expected, rate=RATE):
    """Median fundamental over the steady stretch [start, end) near `expected` Hz."""
    frame = max(4096, int(4 * rate / expected))
    values = []
    for at in range(start, max(start + 1, end - frame), frame // 2):
        chunk = mono[at:at + frame]
        if len(chunk) < frame or np.sqrt(np.mean(chunk ** 2)) < 1e-4:
            continue
        values.append(yin(chunk, expected / 1.35, expected * 1.35, rate))
    return float(np.median(values))


def frame_rms_db(mono, hop, window):
    power = np.concatenate([[0], np.cumsum(mono.astype(np.float64) ** 2)])
    starts = np.arange(0, len(mono) - window, hop)
    return starts, 10 * np.log10((power[starts + window] - power[starts]) / window + 1e-20)


def trim_lead_in(x, below_peak_db):
    """Cuts silence and noise before the first bow or breath sound, 1.5 ms before
    the onset, with a 1 ms fade-in when the cut lands on sound."""
    env = np.abs(x).max(axis=1)
    peak = env.max()
    noise = np.sqrt(np.mean(env[: int(0.02 * RATE)] ** 2)) + 1e-12
    threshold = max(peak * 10 ** (-below_peak_db / 20), noise * 10 ** (12 / 20))
    onset = int(np.argmax(env > threshold))
    start = max(0, onset - int(0.0015 * RATE))
    y = x[start:].copy()
    if start > 0 and np.abs(y[0]).max() > 10 ** (-66 / 20):
        fade = int(0.001 * RATE)
        y[:fade] *= (0.5 - 0.5 * np.cos(np.pi * np.arange(fade) / fade))[:, None]
    return y, start / RATE


def find_loop(x, f0, xfade_s):
    """find_loop_with with the October rules (0.25 s margins, at least 1.6 s);
    for the few short recordings without such a stretch, smaller margins and
    then a 1.2 s minimum."""
    for margin, minimum in ((0.25, 1.6), (0.1, 1.6), (0.1, 1.2)):
        found = find_loop_with(x, f0, xfade_s, minimum, margin)
        if found:
            found[2]['margin_s'], found[2]['min_loop_s'] = margin, minimum
            return found
    raise ValueError('no sustain loop found')


def find_loop_with(x, f0, xfade_s, min_loop_s, margin_s):
    """A sustain loop [start, end) in frames: inside the steady sustain after
    the attack, at least min_loop_s long, the most even level over the loop,
    matching level and pitch at both ends, and a near-zero correlation between
    the two crossfaded parts (both channels)."""
    mono = x.mean(axis=1)
    hop, window = int(0.01 * RATE), int(0.05 * RATE)
    starts, rms = frame_rms_db(mono, hop, window)
    steady = np.median(rms[len(rms) // 4: 3 * len(rms) // 4])
    loud = np.nonzero(rms > steady - 6)[0]
    first = loud[0] + int(margin_s / 0.01)  # after the attack
    last = loud[-1] - int(margin_s / 0.01)  # before the release
    last = min(last, first + int(12 / 0.01))  # long holds: search the first 12 s of the sustain
    xf = int(xfade_s * RATE)
    s_frames = np.arange(first + int(np.ceil(xf / hop)), last)
    e_frames = s_frames.copy()
    min_gap = int(min_loop_s / 0.01)
    centre = rms + 0.0
    c1 = np.concatenate([[0], np.cumsum(centre)])
    c2 = np.concatenate([[0], np.cumsum(centre ** 2)])
    S, E = np.meshgrid(s_frames, e_frames, indexing='ij')
    valid = E - S >= min_gap
    count = np.maximum(E - S, 1)
    mean = (c1[E] - c1[S]) / count
    std = np.sqrt(np.maximum((c2[E] - c2[S]) / count - mean ** 2, 0))
    # level just before the end vs just after the start (50 ms windows)
    level_at_start = rms[np.minimum(S, len(rms) - 1)]
    level_before_end = rms[np.maximum(E - window // hop, 0)]
    score = std + 0.5 * np.abs(level_at_start - level_before_end) - 0.08 * (E - S) * 0.01
    score[~valid] = np.inf
    order = np.argsort(score, axis=None)[:60]
    best = None
    for flat in order:
        i, j = np.unravel_index(flat, score.shape)
        if not np.isfinite(score[i, j]):
            break
        s, e = int(starts[s_frames[i]]), int(starts[e_frames[j]])
        seg = int(0.12 * RATE)
        p_start = pitch(mono, s, s + seg + 8192, f0)
        p_end = pitch(mono, e - seg - 8192, e, f0)
        cents = abs(1200 * np.log2(p_end / p_start))
        corr = np.mean([abs(np.corrcoef(x[s - xf:s, c], x[e - xf:e, c])[0, 1]) for c in range(x.shape[1])])
        total = score[i, j] + 0.05 * cents + 2 * corr
        if best is None or total < best[0]:
            best = (total, s, e, cents, corr, std[i, j])
    if best is None:
        return None
    _, s, e, cents, corr, spread = best
    return s, e, {'pitch_step_cents': round(cents, 2), 'xfade_corr': round(float(corr), 3), 'level_spread_db': round(float(spread), 2)}


def apply_loop(x, start, end, xfade_s):
    """Crossfades the xfade before `start` into the last xfade of the loop
    (equal power) and continues after `end` with the material after `start`."""
    xf = int(xfade_s * RATE)
    theta = (np.pi / 2) * (np.arange(xf) + 0.5) / xf
    fade = x[end - xf:end] * np.cos(theta)[:, None] + x[start - xf:start] * np.sin(theta)[:, None]
    return np.concatenate([x[:end - xf], fade, x[start:]])


def seam_check(y, start, end, seconds=10.0):
    """Plays the loop to `seconds` and compares each junction with the note's own
    variation inside the loop: the sample step (relative to the 99.9th
    percentile step) and the 50 ms level step in dB (relative to the largest
    step between neighbouring 50 ms windows inside the loop)."""
    loop = y[start:end]
    reps = max(2, int(np.ceil((seconds * RATE - end) / len(loop))) + 1)
    played = np.concatenate([y[:end]] + [loop] * reps)
    junctions = [end + k * len(loop) for k in range(reps)]
    steps = np.abs(np.diff(loop, axis=0)).max(axis=1)
    typical = np.percentile(steps, 99.9)
    w = int(0.05 * RATE)
    inner = [10 * np.log10(np.mean(loop[i:i + w] ** 2) + 1e-20) for i in range(0, len(loop) - w, w)]
    inner_step = max(abs(a - b) for a, b in zip(inner, inner[1:]))
    worst_sample, worst_level = 0.0, 0.0
    for j in junctions:
        if j + w >= len(played):
            break
        worst_sample = max(worst_sample, float(np.abs(played[j] - played[j - 1]).max() / typical))
        before = 10 * np.log10(np.mean(played[j - w:j] ** 2) + 1e-20)
        after = 10 * np.log10(np.mean(played[j:j + w] ** 2) + 1e-20)
        worst_level = max(worst_level, abs(after - before))
    return {'sample_step_vs_p999': round(worst_sample, 2), 'level_step_db': round(worst_level, 2), 'inner_level_step_db': round(float(inner_step), 2)}


# --- building ---------------------------------------------------------------------------------

def midi_of(note):
    match = re.match(r'([A-G]#?)(-?\d)$', note)
    return (int(match.group(2)) + 1) * 12 + NAMES[match.group(1)]


def prepare(root, folder, prefix, note, root_key, kind):
    """Every take of one note, trimmed, measured and looped."""
    xfade = 0.25 if kind == 'strings' else 0.2
    below = 40 if kind == 'strings' else 36
    out = []
    files = takes(root, folder, prefix, note)
    ranges = velocity_ranges(sorted({layer for layer, _, _ in files}))
    for layer, take, path in files:
        x, rate = sf.read(path, dtype='float64', always_2d=True)
        info = sf.info(path)
        assert rate == RATE and x.shape[1] == 2, path
        x, trimmed = trim_lead_in(x, below)
        # VSCO note names are one octave low: the root is the named note + 12, confirmed by measurement.
        named = midi_of(note) + 12
        assert named == root_key, (path, named, root_key)
        expected = 440 * 2 ** ((root_key - 69) / 12)
        mono = x.mean(axis=1)
        steady_a, steady_b = int(0.6 * RATE), int(min(len(x) - 0.3 * RATE, 4.0 * RATE))
        measured = pitch(mono, steady_a, steady_b, expected)
        # a broad search from 40 Hz to 1.6 kHz must agree with the octave
        broad = yin(mono[steady_a:steady_a + 16384], 40, 1600)
        assert abs(1200 * np.log2(broad / expected)) < 100 or abs(1200 * np.log2(2 * broad / expected)) < 100 or abs(1200 * np.log2(broad / 2 / expected)) < 100, (path, broad, expected)
        deviation = 1200 * np.log2(measured / expected)
        assert abs(deviation) < 60, (path, deviation)
        start, end, loop_facts = find_loop(x, measured, xfade)
        y = apply_loop(x, start, end, xfade)
        y[-int(0.01 * RATE):] *= np.cos(np.linspace(0, np.pi / 2, int(0.01 * RATE)))[:, None] ** 2
        out.append({
            'path': path, 'source': source_of(folder), 'layer': layer, 'take': take, 'velocity': ranges[layer], 'key': root_key,
            'deviation': deviation, 'trimmed': trimmed, 'loop': (start, end), 'loop_facts': loop_facts, 'audio': y,
            'depth': info.subtype, 'power': k_weighted_power(y[start:end]), 'seam': seam_check(y, start, end),
        })
    return out


def match_gain(groups, a_keys, b_keys, a_source, b_source):
    """dB that brings source b to source a: K-weighted power inside the loop of
    the loudest layers of the notes on each side of where they meet."""
    def level(source, keys):
        values = []
        for key in keys:
            entries = [e for e in groups[key] if e['source'] == source]
            loudest = max(e['layer'] for e in entries)
            values += [e['power'] for e in entries if e['layer'] == loudest]
        return 10 * np.log10(np.mean(values))
    return level(a_source, a_keys) - level(b_source, b_keys)


def assemble(pack, entries, gains, name_prefix, release, report_key):
    """Applies the source gains and one common gain (loudest peak at -1 dBFS),
    writes the recordings at 24 bits and returns the instrument spec."""
    for entry in entries:
        entry['audio'] = entry['audio'] * 10 ** (gains[entry['source']] / 20)
    common = -1 - 20 * np.log10(max(np.abs(e['audio']).max() for e in entries))
    roots = sorted({e['key'] for e in entries})
    regions = []
    for entry in sorted(entries, key=lambda e: (e['key'], e['layer'], e['take'])):
        audio = entry['audio'] * 10 ** (common / 20)
        frames = np.round(np.clip(audio, -1, 1 - 2 ** -23) * 8388608).astype(np.int32)
        name = f"{name_prefix}-{entry['key']}-{entry['source']}-v{entry['layer']}-{entry['take']}"
        pack.add(name, frames, RATE, 24)
        index = roots.index(entry['key'])
        # A key plays the nearest recorded root; a tie goes to the lower one (as before).
        lokey = 0 if index == 0 else (roots[index - 1] + entry['key']) // 2 + 1
        hikey = 127 if index == len(roots) - 1 else (entry['key'] + roots[index + 1]) // 2
        lovel, hivel = entry['velocity']
        regions.append({'sample': name, 'lokey': lokey, 'hikey': hikey, 'key': entry['key'], 'lovel': lovel, 'hivel': hivel,
                        'tune': round(-entry['deviation'], 1), 'gain': 0.0, 'loop': [int(entry['loop'][0]), int(entry['loop'][1])]})
        entry['name'] = name
    report[report_key] = {'common_gain_db': round(common, 2), 'source_gains_db': {k: round(v, 2) for k, v in gains.items()}, 'entries': [
        {k: entry[k] for k in ('name', 'path', 'layer', 'take', 'velocity', 'key', 'trimmed', 'loop', 'loop_facts', 'seam', 'depth')} | {'deviation': round(entry['deviation'], 1)}
        for entry in entries]}
    qa = os.path.join(os.path.dirname(pack.file.name), f'{report_key}-qa.json')
    with open(qa, 'w') as handle:
        json.dump(report[report_key], handle, indent=1, default=float)
    return {'model': 'regions', 'veltrack': 0.3, 'oneShot': False, 'release': release, 'regions': regions}


report = {}


def build_strings(sources, pack):
    root = os.path.join(sources, SOURCE_FOLDER)
    groups = {key: prepare(root, folder, prefix, note, key, 'strings') for folder, prefix, note, key in STRINGS}
    gains = {'cello': 0.0}
    gains['viola'] = match_gain(groups, [50, 53], [55, 59], 'cello', 'viola')
    gains['violin'] = match_gain(groups, [62, 65], [69, 72], 'viola', 'violin') + gains['viola']
    entries = [e for key in groups for e in groups[key]]
    return {'strings': assemble(pack, entries, gains, 'strings', 0.8, 'strings')}


def build_brass(sources, pack):
    root = os.path.join(sources, SOURCE_FOLDER)
    groups = {key: prepare(root, folder, prefix, note, key, 'brass') for folder, prefix, note, key in BRASS}
    gains = {'trombone': 0.0}
    # The Olds A2 (root 45) against the average of its tenor trombone neighbours (41, 46).
    gains['olds'] = match_gain(groups, [41, 46], [45], 'trombone', 'olds')
    # The lowest trumpet notes (60, 63) against the two trombone notes below the split (53 tenor, 57 Olds).
    below = 10 * np.log10(np.mean([
        np.mean([e['power'] for e in groups[53] if e['layer'] == max(x['layer'] for x in groups[53])]),
        np.mean([e['power'] for e in groups[57] if e['layer'] == max(x['layer'] for x in groups[57])]) * 10 ** (gains['olds'] / 10),
    ]))
    trumpet = 10 * np.log10(np.mean([e['power'] for key in (60, 63) for e in groups[key] if e['layer'] == max(x['layer'] for x in groups[key])]))
    gains['trumpet'] = below - trumpet
    entries = [e for key in groups for e in groups[key]]
    return {'brass': assemble(pack, entries, gains, 'brass', 0.2, 'brass')}
