# Audio pipeline

Generates, picks and processes the game's sound effects, ambience and music. The engine that plays
them lives in `src/client/audio/`; the files land in `public/audio/`.

Needs Python 3.10+ (standard library only), ffmpeg with libmp3lame, and sox (spectrograms only).

```bash
# 1. candidates from ElevenLabs into tools/audio/raw/<id>/<n>.mp3 (gitignored; existing ones are kept)
ELEVENLABS_ENV_FILE=path/to/.env python3 tools/audio/gen.py [ids...] [--force]
# 2. look at them: levels table + raw/survey/<id>.png spectrogram strips
python3 tools/audio/survey.py [ids...]
# 3. choose in picks.json, then trim, fade, loop, normalise, encode; writes public/audio/,
#    src/client/audio/assets.gen.ts and assets.json (measured levels)
python3 tools/audio/process.py
# 4. verify: decodes, loudness per bus, true peak, loop seams, total size
python3 tools/audio/check.py
npx vite --port 5197 &  node tools/audio/browser-check.mjs [--webkit]
```

- `sounds.py`: every sound's prompt, length, candidate count and processing options.
- `picks.json`: which candidates are in the game. Generation is not deterministic, so after a
  `--force` regeneration the picks need a new look.
- Loudness targets (EBU R128, linear gain, true peak at most -1 dBTP): UI -20 and SFX -18 LUFS
  max momentary, ambience -24 and music -20 LUFS integrated (stingers -19). The mix between sounds
  is set in `src/client/audio/catalog.ts`.
- Ambience loops are folded over themselves (2 s equal-power crossfade) and wrapped with 0.25 s of
  their own audio on both sides, so the loop points stay seamless whatever the mp3 decoder delay.
