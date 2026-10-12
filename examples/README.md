# Playing Cirkel-Civ from Python (or anything else)

`scripts/gym.ts` runs the real engine (the same code the server and browser use) and speaks
line-delimited JSON on stdin/stdout: one request per line, one response per line, in order.

```bash
npx tsx scripts/gym.ts                                   # the engine process
python3 examples/random_agent.py --games 3 --opponent bot  # a stdlib-only client that plays it
```

The game is deterministic: there is no randomness in the rules, so the same seed and the same orders
always give the same game. All uncertainty comes from what the other players order. The rules are in
`docs/RULES.md`.

## Requests

Every request may carry an `id`; the response echoes it. Errors come back as
`{"id": ..., "ok": false, "error": "..."}`.

| request | response |
|---|---|
| `{"cmd": "reset", "config": {...}}` | new game: `turn`, `done`, `winner`, `scores`, `observations`, `map` |
| `{"cmd": "step", "orders": {"0": PlayerOrders}}` | resolves one turn: the same fields (without `map`) plus `events` |
| `{"cmd": "moves", "seat": 0}` | `moves`: unit id -> {tile: path} for every tile each unit can enter this turn |
| `{"cmd": "path", "unit": 7, "dest": 42}` | `path`: fastest path, possibly over several turns, or `null` |
| `{"cmd": "bot", "seat": 0}` | `orders`: what the built-in bot would order for that seat |
| `{"cmd": "close"}` | exits |

**reset config:** `seed` (string), `players` (2 to 4), `agents` (the seats you control, default
`[0]`), `opponent` (`"bot"`, `"random"` or `"idle"`, plays every other seat), `mapSize` (`"small"`,
`"medium"`, `"large"`), `maxTurns` (default 60), `fog` (fog of war, default `true`), `obs` (`"state"`,
`"grid"` or `"both"`).

Two-player maps are point-symmetric and both seats start on equal terms, so self-play from either
seat is fair.

## Orders

```json
{"units": {"12": {"path": [40, 41], "stance": "aggressive"},
           "15": {"path": [], "stance": "cautious", "found": true},
           "16": {"path": [], "stance": "hold", "target": 77}},
 "cities": {"3": "archer", "9": {"building": "sawmill", "plot": 7}},
 "focus": {"9": "production"}}
```

- `path`: tiles to enter in order (each a neighbour of the previous). Ending on an enemy unit or city
  is an attack. Paths longer than one turn continue automatically next turn.
- `stance`: `cautious` (Cautious: stops when an enemy shows up next to it), `aggressive`
  (Aggressive: attacks adjacent enemies), `hold` (Hold: never moves, +50 % defence, Archers shoot the
  first enemy in range).
- `found`: Settlers found a city when their path is done. `target`: an Archer's preferred volley tile.
- City builds: a unit (`spear` for Spearman, `archer`, `rider`, `settler`; repeats until changed),
  a building on one of the city's plots (`{"building": ..., "plot": 1..18}`, built once), or `null`.
  A building that does not fit the plot is ignored; `docs/RULES.md` section 7 lists buildings and
  plots, and `canPlace` / `cityOutput` in `src/engine/city.ts` are the reference.
- `focus` (optional): which buildings get workers first when a city has more jobs than citizens.
- Units you do not mention keep their previous orders. Invalid orders are cleaned or ignored, never
  an error, so a policy cannot crash the game. `moves` gives exactly the legal one-turn destinations,
  which is handy as an action mask.

## Observations

`observations` has one entry per agent seat, keyed by seat number as a string:

- `state`: the `GameState` from that seat's point of view (see `src/engine/types.ts`). Other players'
  paths, founding flags, targets, constructions and stores are always hidden. With fog of war (the
  default) enemy units appear only while in sight, rival cities only while in sight or as last seen,
  and `fog[seat]` holds what the seat has explored; without fog every unit and city is shown. The
  static `map` is included only in the reset response (it is the whole map: mask it with `explored`
  if your agent should not know the land it has not seen).
- `grid` (with `obs: "grid"` or `"both"`): flat row-major arrays of length `width x height`, index =
  tile id, -1 where empty: `unitOwner`, `unitType`, `unitHp`, `unitStance`, `cityOwner`, `cityPop`,
  `cityHp`, `cityWalls` (from the seat's view), plus 1/0 planes `visible` (in sight now) and
  `explored` (ever seen). The reset response's `map` adds `tileHeight` and `biome` planes and the index
  tables (`biomes`, `unitTypes`, `stances`).

Tiles are pointy-top hexes in an odd-r offset grid: tile id = `row x width + col`, and odd rows are
shifted half a hex to the right. On an even row the neighbours of `(c, r)` are `(c±1, r)`,
`(c-1, r±1)` and `(c, r±1)`; on an odd row `(c±1, r)`, `(c, r±1)` and `(c+1, r±1)`.

## Rewards

The engine does not shape rewards. `winner` is the seat that won (or `"draw"`) once `done` is true:
by taking every enemy city, or by the best `scores` after the last turn (10 per city, 3 per citizen,
1 per building and 3 more per temple, 1 per unit). A score difference per turn is a reasonable dense reward to start with.

## Speed

Headless bot-vs-bot games run with `npx tsx scripts/sim.ts --games 200 --seats 2`, which also prints
win rates per seat and turns per second. The JSON round trip dominates the gym's cost; batch work per
turn (one `moves` call per seat, one `step`).
