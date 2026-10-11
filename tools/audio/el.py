"""Tiny ElevenLabs client (stdlib only) used by the audio generation scripts.

The API key is read at runtime from the ELEVENLABS_API_KEY environment variable, or from a
dotenv file named by ELEVENLABS_ENV_FILE. It is never written anywhere.
"""
import json
import os
import sys
import urllib.error
import urllib.request

API = "https://api.elevenlabs.io"


def api_key() -> str:
    key = os.environ.get("ELEVENLABS_API_KEY")
    if key:
        return key.strip()
    path = os.environ.get("ELEVENLABS_ENV_FILE")
    if path and os.path.exists(path):
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("ELEVENLABS_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("No ElevenLabs key: set ELEVENLABS_API_KEY or ELEVENLABS_ENV_FILE")


def request(method: str, path: str, body: dict | None = None, timeout: float = 300):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("xi-api-key", api_key())
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path} -> {e.code}: {e.read()[:500].decode(errors='replace')}")


def subscription() -> dict:
    raw, _ = request("GET", "/v1/user/subscription")
    return json.loads(raw)


def sound(text: str, out: str, duration: float | None = None, influence: float = 0.4, loop: bool = False) -> dict:
    body = {"text": text, "model_id": "eleven_text_to_sound_v2", "prompt_influence": influence, "loop": loop}
    if duration is not None:
        body["duration_seconds"] = duration
    raw, headers = request("POST", "/v1/sound-generation?output_format=mp3_44100_192", body)
    with open(out, "wb") as f:
        f.write(raw)
    return {"cost": headers.get("character-cost") or headers.get("Character-Cost")}


def music(prompt: str, out: str, length_ms: int, model: str = "music_v1") -> dict:
    body = {"prompt": prompt, "music_length_ms": length_ms, "model_id": model, "force_instrumental": True}
    raw, headers = request("POST", "/v1/music?output_format=mp3_44100_192", body, timeout=900)
    with open(out, "wb") as f:
        f.write(raw)
    return {"cost": headers.get("character-cost") or headers.get("Character-Cost"), "song": headers.get("song-id")}


if __name__ == "__main__":
    s = subscription()
    print(json.dumps({k: s.get(k) for k in ("tier", "character_count", "character_limit", "next_character_count_reset_unix", "status")}))
