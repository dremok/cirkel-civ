"""Loudness and level measurements with ffmpeg (no Python dependencies).

    python3 tools/audio/measure.py file.mp3 [...]
"""
import array
import math
import re
import subprocess
import sys

RATE = 44100


def pcm(path: str, mono: bool = True) -> array.array:
    """Decode to 32-bit float samples (mono mixdown unless mono=False, then interleaved stereo)."""
    cmd = ["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1" if mono else "2", "-ar", str(RATE), "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    a = array.array("f")
    a.frombytes(raw)
    return a


def loudness(path: str) -> dict:
    """Integrated loudness, max momentary loudness (400 ms) and true peak, via ebur128."""
    cmd = ["ffmpeg", "-hide_banner", "-nostats", "-v", "verbose", "-i", path, "-af", "apad=pad_dur=0.5,ebur128=peak=true:framelog=verbose", "-f", "null", "-"]
    err = subprocess.run(cmd, capture_output=True, text=True).stderr
    moments = [float(m) for m in re.findall(r"M:\s*(-?[\d.]+)", err)]
    summary = err[err.rfind("Summary:"):]
    i = re.search(r"I:\s*(-?[\d.]+) LUFS", summary)
    lra = re.search(r"LRA:\s*(-?[\d.]+) LU", summary)
    tp = re.search(r"Peak:\s*(-?[\d.inf]+) dBFS", summary)
    return {
        "I": float(i.group(1)) if i else None,
        "Mmax": max(moments) if moments else None,
        "LRA": float(lra.group(1)) if lra else None,
        "TP": float(tp.group(1)) if tp and tp.group(1) != "-inf" else -120.0,
    }


def db(x: float) -> float:
    return 20 * math.log10(x) if x > 1e-9 else -180.0


def levels(samples: array.array) -> dict:
    """Peak, clipped samples, where the sound starts and ends (relative to its peak), and a crude brightness."""
    n = len(samples)
    peak = max((abs(s) for s in samples), default=0.0)
    clipped = sum(1 for s in samples if abs(s) >= 0.999)
    start_th, end_th = peak * 10 ** (-40 / 20), peak * 10 ** (-50 / 20)
    start = next((i for i in range(n) if abs(samples[i]) > start_th), 0)
    end = next((i for i in range(n - 1, -1, -1) if abs(samples[i]) > end_th), n - 1)
    zc = sum(1 for i in range(1, n) if (samples[i - 1] < 0) != (samples[i] < 0))
    return {
        "dur": n / RATE,
        "peak": db(peak),
        "clipped": clipped,
        "start": start / RATE,
        "end": end / RATE,
        "zcr_hz": zc / 2 / (n / RATE) if n else 0.0,
    }


def describe(path: str) -> dict:
    d = levels(pcm(path))
    d.update(loudness(path))
    return d


if __name__ == "__main__":
    for p in sys.argv[1:]:
        d = describe(p)
        print(f"{p}: " + "  ".join(f"{k}={v:.2f}" if isinstance(v, float) else f"{k}={v}" for k, v in d.items()))
