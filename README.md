# Cirkel-Civ

A browser strategy game on a hex map where every tile has its own height, built around one idea:
**everyone gives their orders at the same time, and everything happens at the same time.**

Each turn, all players plan in secret. When everyone is done, all orders resolve together in six
small ticks, and the turn is replayed for everyone. No dice: the only uncertainty is what your
opponents planned. It plays in the browser, online against friends or against bots, on desktop and
phone.

The design (in Swedish) is in [SPEC.md](SPEC.md), the precise rules in [docs/RULES.md](docs/RULES.md)
and the art direction in [ART.md](ART.md).

## Architecture

```
src/engine/   Pure, deterministic TypeScript rules engine (no DOM): hex math, seeded map generator,
              simultaneous resolution, bots. Runs in the browser, on the server and in scripts.
src/server/   Node HTTP + WebSocket (/ws): authoritative game rooms, JSON persistence.
src/shared/   The client/server protocol.
src/client/   Vite + React UI, Three.js renderer (render/world: terrain, sea, sky; render/pieces:
              units, cities, overlays, replay).
scripts/      sim.ts (headless bot tournaments + speed), gym.ts (JSON over stdio for RL agents),
              shot.mjs (screenshots).
examples/     A minimal Python agent for the gym protocol.
```

`resolveTurn(state, orders) -> { state, events }` is a pure function, so games are reproducible,
easy to test, and cheap to simulate in parallel for training agents.

## Running

```bash
npm install
npm run dev                                   # server :8787 + client :5180
npx vitest run                                # tests
npx tsx scripts/sim.ts --games 200 --seats 2  # bot tournament
npm run build && npm start                    # production build
```
