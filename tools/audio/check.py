"""Check the processed audio: every file decodes, levels, no clipping, loop seams, total size.

    python3 tools/audio/check.py
"""
import json
import math
import os
import re
import subprocess
import sys

from measure import RATE, loudness, pcm

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
PUBLIC = os.path.join(ROOT, "public", "audio")
MANIFEST_TS = os.path.join(ROOT, "src", "client", "audio", "assets.gen.ts")


def probe(path: str) -> dict:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,channels,sample_rate:format=duration,bit_rate",
                          "-of", "json", path], capture_output=True, text=True)
    if out.returncode:
        raise RuntimeError(out.stderr)
    j = json.loads(out.stdout)
    s = j["streams"][0]
    return {"codec": s["codec_name"], "ch": s["channels"], "sr": int(s["sample_rate"]), "dur": float(j["format"]["duration"]),
            "kbps": int(j["format"].get("bit_rate", 0)) // 1000}


def seam(path: str, loop: tuple[float, float]) -> dict:
    """How the decoded loop behaves at its seam. `jump_vs_step` is the step the playback makes when it
    wraps from the loop end back to the start, relative to the signal's ordinary sample-to-sample step
    there (a click shows up as a large ratio). `mismatch_db` compares the wave around both loop points,
    which are the same audio before encoding, so it only measures mp3 coding noise (informational)."""
    x = pcm(path)
    a, b = int(loop[0] * RATE), int(loop[1] * RATE)
    w = int(0.02 * RATE)
    num = sum((x[a - w + i] - x[b - w + i]) ** 2 for i in range(2 * w))
    den = sum(x[b - w + i] ** 2 for i in range(2 * w)) or 1e-12
    # the jump the loop makes at its end, compared with the signal's typical step size there
    jump = abs(x[b] - x[a]) if b < len(x) else float("nan")
    step = sum(abs(x[a + i + 1] - x[a + i]) for i in range(w)) / w
    return {"mismatch_db": 10 * math.log10(num / den + 1e-12), "jump_vs_step": jump / (step or 1e-12)}


def main():
    ts = open(MANIFEST_TS).read()
    loops = {m.group(1): (float(m.group(2)), float(m.group(3))) for m in re.finditer(r"'(amb/[\w-]+\.mp3)'\], dur: [\d.]+, loop: \[([\d.]+), ([\d.]+)\]", ts)}
    referenced = set(re.findall(r"'((?:ui|sfx|amb|music)/[\w-]+\.mp3)'", ts))
    ok = True
    total = 0
    per_bus: dict[str, list[float]] = {}
    print(f"{'file':32} {'codec':5} ch {'sr':>5} {'dur':>7} {'kbps':>4} {'I':>6} {'Mmax':>6} {'TP':>5}")
    for bus in ("ui", "sfx", "amb", "music"):
        d = os.path.join(PUBLIC, bus)
        for f in sorted(os.listdir(d)):
            rel = f"{bus}/{f}"
            p = os.path.join(d, f)
            total += os.path.getsize(p)
            try:
                pr = probe(p)
            except RuntimeError as e:
                print(f"{rel}: DOES NOT DECODE {e}")
                ok = False
                continue
            lv = loudness(p)
            metric = lv["Mmax"] if bus in ("ui", "sfx") else lv["I"]
            per_bus.setdefault(bus, []).append(metric)
            flag = ""
            if lv["TP"] > -0.9:
                flag += "  CLIPPING RISK"
                ok = False
            if rel not in referenced:
                flag += "  (not in manifest)"
            print(f"{rel:32} {pr['codec']:5} {pr['ch']:2} {pr['sr']:5} {pr['dur']:7.2f} {pr['kbps']:4} {lv['I']:6.1f} {lv['Mmax']:6.1f} {lv['TP']:5.1f}{flag}")
            if rel in loops:
                s = seam(p, loops[rel])
                good = s["jump_vs_step"] < 4
                ok &= good
                print(f"{'':32} loop {loops[rel]}: mismatch {s['mismatch_db']:.1f} dB, end jump {s['jump_vs_step']:.2f}x typical step {'ok' if good else 'SEAM'}")
    missing = [r for r in referenced if not os.path.exists(os.path.join(PUBLIC, r))]
    if missing:
        print("missing:", missing)
        ok = False
    for bus, vals in per_bus.items():
        print(f"bus {bus:5}: {len(vals):2} files, {'max momentary' if bus in ('ui', 'sfx') else 'integrated'} {min(vals):.1f} .. {max(vals):.1f} LUFS")
    total += os.path.getsize(os.path.join(PUBLIC, "silence.mp3"))
    print(f"total {total / 1024 / 1024:.2f} MB")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
