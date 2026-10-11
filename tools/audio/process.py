"""Turn the picked candidates (picks.json) into the game's audio files.

    python3 tools/audio/process.py

For every pick: decode, filter, trim, fade, make loops seamless, normalise loudness to the bus target
(EBU R128 measured by ffmpeg, linear gain, peak-safe), encode mp3 into public/audio/<bus>/, and write
src/client/audio/assets.gen.ts (file list, lengths, loop points) plus tools/audio/assets.json (levels).
"""
import array
import json
import math
import os
import subprocess
import tempfile

from measure import RATE, db, loudness
from sounds import SOUNDS

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
RAW = os.path.join(HERE, "raw")
PUBLIC = os.path.join(ROOT, "public", "audio")
MANIFEST_TS = os.path.join(ROOT, "src", "client", "audio", "assets.gen.ts")
REPORT = os.path.join(HERE, "assets.json")

# Loudness targets per bus. One-shots are measured by their loudest 400 ms (max momentary), beds and
# music by integrated loudness. The mix between sounds is set in code (src/client/audio/catalog.ts).
TARGET = {"ui": -20.0, "sfx": -18.0, "amb": -24.0, "music": -20.0}
STING_TARGET = -19.0
PEAK_CEIL = -1.0  # dBTP after encoding
CHANNELS = {"ui": 1, "sfx": 1, "amb": 2, "music": 2}
QUALITY = {"ui": "4", "sfx": "4", "amb": "6", "music": "5"}  # LAME VBR quality (lower = better)
LOOP_XFADE = 2.0  # seconds folded over to make ambience loops seamless
LOOP_PAD = 0.25  # seconds of wrapped audio before and after the loop (decoder delay safety)


# ------------------------------------------------------------------------------------------ I/O

def decode(path: str, channels: int, hp: float | None, lp: float | None) -> array.array:
    filters = []
    if hp:
        filters.append(f"highpass=f={hp}:poles=2")
    if lp:
        filters.append(f"lowpass=f={lp}:poles=2")
    cmd = ["ffmpeg", "-v", "error", "-i", path]
    if filters:
        cmd += ["-af", ",".join(filters)]
    cmd += ["-f", "f32le", "-ac", str(channels), "-ar", str(RATE), "-"]
    a = array.array("f")
    a.frombytes(subprocess.run(cmd, capture_output=True, check=True).stdout)
    return a


def encode(samples: array.array, channels: int, gain_db: float, out: str, quality: str):
    os.makedirs(os.path.dirname(out), exist_ok=True)
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(RATE), "-ac", str(channels), "-i", "-",
           "-af", f"volume={gain_db:.3f}dB", "-c:a", "libmp3lame", "-q:a", quality, "-map_metadata", "-1", out]
    subprocess.run(cmd, input=samples.tobytes(), check=True)


def measure_samples(samples: array.array, channels: int) -> dict:
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tmp = f.name
    try:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(RATE), "-ac", str(channels), "-i", "-", tmp],
                       input=samples.tobytes(), check=True)
        return loudness(tmp)
    finally:
        os.unlink(tmp)


# ------------------------------------------------------------------------------------- shaping

def frames(x: array.array, ch: int) -> int:
    return len(x) // ch


def peak_of(x: array.array) -> float:
    return max((abs(s) for s in x), default=0.0)


def envelope(x: array.array, hop: int) -> list[float]:
    """RMS per hop (mono input)."""
    out = []
    for i in range(0, len(x), hop):
        seg = x[i:i + hop]
        out.append(math.sqrt(sum(s * s for s in seg) / max(1, len(seg))))
    return out


def fade(x: array.array, ch: int, fin: float, fout: float):
    """Cosine fade-in over fin seconds and fade-out over the last fout seconds, in place."""
    n = frames(x, ch)
    a = min(n, int(fin * RATE))
    b = min(n, int(fout * RATE))
    for i in range(a):
        g = 0.5 - 0.5 * math.cos(math.pi * i / a)
        for c in range(ch):
            x[i * ch + c] *= g
    for i in range(b):
        g = 0.5 + 0.5 * math.cos(math.pi * (i + 1) / b)
        j = n - b + i
        for c in range(ch):
            x[j * ch + c] *= g


def oneshot(x: array.array, spec: dict) -> array.array:
    """Trim a mono one-shot to its sound, keep at most `tail` seconds, fade the end."""
    hop = int(0.005 * RATE)
    env = envelope(x, hop)
    pk_i = max(range(len(env)), key=lambda i: env[i])
    pk = env[pk_i]
    if spec.get("mode") == "hit":
        # Walk back from the loudest moment to where the transient begins, and forward to the next one.
        i = pk_i
        while i > 0 and env[i - 1] > pk * 10 ** (-30 / 20) and env[i - 1] <= env[i] * 1.5:
            i -= 1
        start = max(0, i * hop - int(0.002 * RATE))
        stop = len(x)
        for j in range(pk_i + 6, len(env) - 2):
            if env[j + 2] > env[j] * 4 and env[j + 2] > pk * 10 ** (-24 / 20):
                stop = j * hop
                break
    else:
        th = peak_of(x) * 10 ** (-40 / 20)
        start = next((i for i, s in enumerate(x) if abs(s) > th), 0)
        start = max(0, start - int(0.003 * RATE))
        stop = len(x)
    th_end = peak_of(x) * 10 ** (-50 / 20)
    natural = next((i for i in range(stop - 1, start, -1) if abs(x[i]) > th_end), stop - 1) + int(0.02 * RATE)
    tail = spec.get("tail")
    want = start + int(tail * RATE) if tail else stop
    end = min(stop, natural, want, len(x))
    y = x[start:end]
    cut_early = end < natural
    length = len(y) / RATE
    fade(y, 1, 0.0015 if start > 0 else 0.0005, length * 0.4 if cut_early else min(0.03, length * 0.2))
    return y


def seamless(x: array.array, ch: int, xfade: float) -> array.array:
    """Fold the last `xfade` seconds over the start (equal-power), so the result loops without a seam."""
    n = frames(x, ch)
    X = int(xfade * RATE)
    L = n - X
    y = array.array("f", x[X * ch:n * ch])  # frames X..n-1, length L
    for i in range(X):
        t = (i + 0.5) / X
        gin = math.sin(0.5 * math.pi * t)  # head fades in
        gout = math.cos(0.5 * math.pi * t)  # tail fades out
        j = L - X + i  # position in y of tail frame n-X+i
        for c in range(ch):
            y[j * ch + c] = x[(n - X + i) * ch + c] * gout + x[i * ch + c] * gin
    return y


def wrap_pad(y: array.array, ch: int, pad: float) -> array.array:
    P = int(pad * RATE) * ch
    return y[-P:] + y + y[:P]


def trim_music(x: array.array, ch: int) -> array.array:
    th = peak_of(x) * 10 ** (-50 / 20)
    n = frames(x, ch)
    first = next((i for i in range(n) if any(abs(x[i * ch + c]) > th for c in range(ch))), 0)
    last = next((i for i in range(n - 1, -1, -1) if any(abs(x[i * ch + c]) > th for c in range(ch))), n - 1)
    first = max(0, first - int(0.01 * RATE))
    last = min(n - 1, last + int(0.25 * RATE))
    return x[first * ch:(last + 1) * ch]


# ---------------------------------------------------------------------------------------- main

def normalise_and_encode(y: array.array, ch: int, bus: str, target: float, metric: str, out: str) -> dict:
    m = measure_samples(y, ch)
    level = m[metric]
    gain = target - level
    pk = db(peak_of(y))
    gain = min(gain, PEAK_CEIL - 0.5 - pk)
    for _ in range(4):
        encode(y, ch, gain, out, QUALITY[bus])
        after = loudness(out)
        if after["TP"] <= PEAK_CEIL:
            break
        gain -= after["TP"] - PEAK_CEIL + 0.2
    return {"gain": round(gain, 2), "I": after["I"], "Mmax": after["Mmax"], "TP": after["TP"], "LRA": after["LRA"]}


def main():
    picks = json.load(open(os.path.join(HERE, "picks.json")))
    manifest, report = {}, {}
    for sid, chosen in picks.items():
        spec = SOUNDS[sid]
        bus = spec["bus"]
        ch = CHANNELS[bus]
        files = []
        for k, idx in enumerate(chosen):
            src = os.path.join(RAW, sid, f"{idx}.mp3")
            x = decode(src, ch, spec.get("hp"), spec.get("lp"))
            loop = None
            if bus in ("ui", "sfx"):
                y = oneshot(x, spec)
                target, metric = TARGET[bus], "Mmax"
            elif bus == "amb":
                y = seamless(x, ch, LOOP_XFADE)
                target, metric = TARGET[bus], "I"
            else:
                y = trim_music(x, ch)
                fade(y, ch, 0.03, 3.0)
                target, metric = (STING_TARGET if sid.startswith("sting") else TARGET[bus]), "I"
            length = frames(y, ch) / RATE
            if bus == "amb":
                loop = [LOOP_PAD, round(LOOP_PAD + length, 6)]
                y = wrap_pad(y, ch, LOOP_PAD)
            name = f"{sid}-{k + 1}.mp3" if len(chosen) > 1 else f"{sid}.mp3"
            rel = f"{bus}/{name}"
            out = os.path.join(PUBLIC, bus, name)
            r = normalise_and_encode(y, ch, bus, target, metric, out)
            r.update(src=f"{sid}/{idx}", len=round(length, 3), bytes=os.path.getsize(out), target=target, metric=metric)
            report[rel] = r
            files.append(rel)
            print(f"{rel:32} {length:7.2f}s  {metric}={r[metric]:6.1f}  TP={r['TP']:5.1f}  {r['bytes'] // 1024:5d} KB", flush=True)
            if loop:
                manifest.setdefault(sid, {})["loop"] = loop
        manifest.setdefault(sid, {}).update(bus=bus, files=files, dur=round(max(report[f]["len"] for f in files), 3))

    # a short silent clip used to unlock media elements on iOS
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "0.2",
                    "-c:a", "libmp3lame", "-q:a", "9", os.path.join(PUBLIC, "silence.mp3")], check=True)

    json.dump(report, open(REPORT, "w"), indent=1)
    lines = [
        "// Generated by tools/audio/process.py from tools/audio/picks.json. Do not edit by hand.",
        "",
        "export type Bus = 'ui' | 'sfx' | 'amb' | 'music'",
        "",
        "export interface AssetInfo {",
        "  bus: Bus",
        "  /** Paths under /audio/. Several files = random variations. */",
        "  files: readonly string[]",
        "  /** Seconds (the longest variation). */",
        "  dur: number",
        "  /** Seamless loop region in seconds (ambience). */",
        "  loop?: readonly [number, number]",
        "}",
        "",
        "export const ASSETS = {",
    ]
    for sid, m in manifest.items():
        loop = f", loop: [{m['loop'][0]}, {m['loop'][1]}]" if "loop" in m else ""
        files = ", ".join(f"'{f}'" for f in m["files"])
        lines.append(f"  {sid}: {{ bus: '{m['bus']}', files: [{files}], dur: {m['dur']}{loop} }},")
    lines += ["} as const satisfies Record<string, AssetInfo>", "", "export type AssetId = keyof typeof ASSETS", ""]
    os.makedirs(os.path.dirname(MANIFEST_TS), exist_ok=True)
    open(MANIFEST_TS, "w").write("\n".join(lines))
    total = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(PUBLIC) for f in fs)
    print(f"total {total / 1024 / 1024:.2f} MB")


if __name__ == "__main__":
    main()
