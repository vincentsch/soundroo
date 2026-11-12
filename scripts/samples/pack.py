"""Sample packs: one file per instrument holding its recordings as ordinary WAV
files one after another. The manifest records where each recording's PCM data
starts, so the engine reads any stretch of a note straight from the pack.

A pack is written in a fixed order with fixed headers, so the same recordings
always give the same bytes and the same SHA-256."""
import hashlib
import io
import struct

import numpy as np


def wav_bytes(frames: np.ndarray, rate: int, bits: int) -> tuple[bytes, int]:
    """A canonical PCM WAV (RIFF, fmt, data) and the offset of its data. frames
    is an int32 array (frames x channels) holding samples at `bits` depth."""
    if frames.ndim == 1:
        frames = frames[:, None]
    channels = frames.shape[1]
    width = bits // 8
    if bits == 24:
        flat = frames.astype('<i4').reshape(-1)
        raw = flat.view(np.uint8).reshape(-1, 4)[:, :3].tobytes()
    elif bits == 16:
        raw = frames.astype('<i2').tobytes()
    else:
        raise ValueError(f'unsupported bit depth {bits}')
    fmt = struct.pack('<HHIIHH', 1, channels, rate, rate * channels * width, channels * width, bits)
    body = b'WAVE' + b'fmt ' + struct.pack('<I', len(fmt)) + fmt + b'data' + struct.pack('<I', len(raw)) + raw
    if len(raw) & 1:
        body += b'\0'
    header = b'RIFF' + struct.pack('<I', len(body))
    return header + body, 8 + 4 + 8 + len(fmt) + 8


TAIL_STEPS = list(range(20, 130, 10))


def tails(frames: np.ndarray, bits: int) -> dict:
    """The recording's peak (dBFS) and, for each level 20, 30 ... 120 dB below
    that peak, the frame after which it never rises above that level again.
    A player stops a quiet voice once it can no longer be heard."""
    level = np.abs(frames.reshape(len(frames), -1)).max(axis=1).astype(np.float64) / float(1 << (bits - 1))
    peak = float(level.max()) if len(level) else 0.0
    if peak <= 0:
        return {'peak': -200.0, 'tails': [0] * len(TAIL_STEPS)}
    after = np.maximum.accumulate(level[::-1])[::-1]
    ends = []
    for step in TAIL_STEPS:
        above = np.nonzero(after > peak * 10 ** (-step / 20))[0]
        ends.append(int(above[-1]) + 1 if len(above) else 0)
    return {'peak': round(20 * np.log10(peak), 2), 'tails': ends}


class PackWriter:
    def __init__(self, path):
        self.file = open(path, 'wb')
        self.offset = 0
        self.hash = hashlib.sha256()
        self.index = {}

    def add(self, name: str, frames: np.ndarray, rate: int, bits: int, **extra):
        data, start = wav_bytes(frames, rate, bits)
        if name in self.index:
            raise ValueError(f'duplicate sample {name}')
        channels = 1 if frames.ndim == 1 else frames.shape[1]
        self.index[name] = {'offset': self.offset + start, 'frames': int(frames.shape[0]), 'channels': channels, 'bits': bits, 'rate': rate, **tails(frames, bits), **extra}
        self.file.write(data)
        self.hash.update(data)
        self.offset += len(data)

    def close(self):
        self.file.close()
        return {'size': self.offset, 'sha256': self.hash.hexdigest()}


def read_int(path):
    """A source file as int32 frames at its own depth (24-bit values stay
    24-bit), plus its rate and bit depth."""
    import soundfile as sf
    info = sf.info(path)
    bits = {'PCM_16': 16, 'PCM_24': 24}.get(info.subtype)
    if bits is None:
        raise ValueError(f'{path}: unsupported subtype {info.subtype}')
    data, rate = sf.read(path, dtype='int32', always_2d=True)
    return data >> (32 - bits), rate, bits
