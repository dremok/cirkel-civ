"""Survey the generated candidates: a metrics table and one spectrogram strip per sound.

    python3 tools/audio/survey.py [ids...]

Writes raw/survey/<id>.png (one row per candidate) and prints the table.
"""
import os
import subprocess
import sys

from measure import describe
from sounds import SOUNDS

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")


def strip(sid: str, files: list[str]):
    out_dir = os.path.join(RAW, "survey")
    os.makedirs(out_dir, exist_ok=True)
    pngs = []
    for f in files:
        png = f[:-4] + ".png"
        subprocess.run(["sox", f, "-n", "remix", "-", "rate", "32k", "spectrogram", "-x", "520", "-y", "130", "-z", "80",
                        "-t", f"{sid} {os.path.basename(f)}", "-o", png], check=True, capture_output=True)
        pngs.append(png)
    args = []
    for p in pngs:
        args += ["-i", p]
    pads = "".join(f"[{i}]pad=700:ih[p{i}];" for i in range(len(pngs)))
    flt = pads + "".join(f"[p{i}]" for i in range(len(pngs))) + f"vstack=inputs={len(pngs)}" if len(pngs) > 1 else "null"
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args, "-filter_complex", flt, os.path.join(out_dir, f"{sid}.png")], check=True)


def main():
    ids = sys.argv[1:] or list(SOUNDS)
    print(f"{'candidate':24} {'dur':>5} {'start':>5} {'end':>5} {'peak':>6} {'TP':>6} {'I':>6} {'Mmax':>6} {'zcr':>6} clip")
    for sid in ids:
        d = os.path.join(RAW, sid)
        if not os.path.isdir(d):
            continue
        files = sorted(os.path.join(d, f) for f in os.listdir(d) if f.endswith(".mp3"))
        for f in files:
            m = describe(f)
            print(f"{sid + '/' + os.path.basename(f):24} {m['dur']:5.2f} {m['start']:5.2f} {m['end']:5.2f} {m['peak']:6.1f} {m['TP']:6.1f} "
                  f"{m['I'] if m['I'] is not None else float('nan'):6.1f} {m['Mmax']:6.1f} {m['zcr_hz']:6.0f} {m['clipped']}")
        strip(sid, files)


if __name__ == "__main__":
    main()
