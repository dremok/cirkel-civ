"""Generate candidate recordings with ElevenLabs into tools/audio/raw/<id>/<n>.mp3.

    ELEVENLABS_ENV_FILE=path/to/.env python3 tools/audio/gen.py [ids...] [--force]

Existing candidates are kept (pass --force to regenerate the named ids). Credits charged per request
are appended to raw/costs.jsonl when the API reports them.
"""
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import el
from sounds import SOUNDS

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")


def job(sid: str, i: int, force: bool):
    spec = SOUNDS[sid]
    out = os.path.join(RAW, sid, f"{i}.mp3")
    if os.path.exists(out) and not force:
        return None
    os.makedirs(os.path.dirname(out), exist_ok=True)
    for attempt in range(4):
        try:
            t0 = time.time()
            if spec["bus"] == "music":
                info = el.music(spec["prompt"], out, int(spec["dur"] * 1000), model="music_v2_5")
            else:
                info = el.sound(spec["prompt"], out, duration=spec["dur"], influence=spec.get("influence", 0.4), loop=spec.get("loop", False))
            info.update(id=sid, i=i, secs=round(time.time() - t0, 1))
            with open(os.path.join(RAW, "costs.jsonl"), "a") as f:
                f.write(json.dumps(info) + "\n")
            return info
        except RuntimeError as e:
            msg = str(e)
            if "429" in msg or "concurrent" in msg.lower():
                time.sleep(5 * (attempt + 1))
                continue
            return {"id": sid, "i": i, "error": msg}
    return {"id": sid, "i": i, "error": "rate limited"}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    ids = args or list(SOUNDS)
    unknown = [s for s in ids if s not in SOUNDS]
    if unknown:
        sys.exit(f"unknown ids: {unknown}")
    jobs = [(sid, i) for sid in ids for i in range(SOUNDS[sid]["n"])]
    with ThreadPoolExecutor(max_workers=3) as ex:
        for r in ex.map(lambda j: job(j[0], j[1], force), jobs):
            if r:
                print(json.dumps(r), flush=True)


if __name__ == "__main__":
    main()
