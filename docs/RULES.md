# Cirkel-Civ rules (engine v0.1)

The precise ruleset implemented by `src/engine/rules.ts`. SPEC.md is the design; where it is silent or
loose, this file decides. Numbers live in `src/engine/config.ts`, `src/engine/city.ts` (buildings) and
`src/engine/economy.ts`.

Units: **Spearman** (`spear`), **Archer** (`archer`), **Rider** (`rider`), **Settler** (`settler`).
Stances: **Cautious** (`cautious`), **Aggressive** (`aggressive`), **Hold** (`hold`). The code names
in brackets are what orders and events use.

## 1. A turn

1. **Planning.** Every player gives orders in secret (`PlayerOrders`).
2. **Resolution.** All orders run at once: ticks 1 to 6 (movement and melee), tick 7 (volleys),
   tick 8 (founding, economy, healing, elimination, victory).
3. **Replay.** Every visible change is a `GameEvent` stamped with its tick `t`.

There is no randomness anywhere in the rules. The same state and orders always give the same result.

## 2. Orders

- **Unit order:** `path` (tiles to enter, in order), `stance`, `found` (settlers), `target` (archers).
  A unit without a new order keeps its old path, stance, founding flag and target. Steps are removed
  from the path as the unit takes them, so a long path simply continues next turn.
- **City order:** what the city works on: a unit type (`spear`, `archer`, `rider`, `settler`; repeats
  until changed), a building on a plot (`{ "building": "farm", "plot": 9 }`; built once), or `null`.
  A building order is only accepted if the building fits that plot right now (section 7).
- **Focus order:** `focus: { cityId: "growth" | "production" | "balance" }` (section 7).
- **Cleaning.** Orders for units or cities you do not own, unknown ids and malformed values are
  ignored. A path keeps its longest valid prefix: each step must be a passable neighbour of the
  previous tile, at most 64 steps. An enemy city ends a path (you attack it). Settlers stop before any
  tile held by an enemy. Choosing **Hold** clears the path.

## 3. Movement

- At the start of every tick each unit gains **speed** points (Spearman, Archer, Settler 2; Rider 3).
  Units on Hold, and units that have stopped for the turn, gain nothing. Points reset every turn.
- **Step cost** into a neighbour: `6 x terrain + 3 x levels climbed`, terrain 1 for grass, plains,
  beach and forest, 2 for hills. Going down is free. The cost is capped at `6 x speed`, so any
  passable neighbour can be entered within one turn.
- Water, mountains and snow are impassable, and so is a height difference of more than 2 (a cliff).
- A unit steps when its points reach the cost of its next step, at most one step per tick, and pays
  the cost. On flat ground a Spearman steps at ticks 3 and 6, a Rider at ticks 2, 4 and 6. A unit that
  has to wait keeps collecting points (but still takes at most one step per tick).
- `pathTiming` in `paths.ts` gives exactly these ticks for an unobstructed path, and `findPath`
  returns the path that arrives first (not the cheapest one: points left at the end of a turn are lost).

## 4. Each tick (1 to 6), in order

### 4.1 Commanders react (stances)

Every unit that is ready picks its step for this tick. **Ready** means its points cover that step.

- **Cautious** (default): follows its path. It never steps into a tile held by an enemy, unless that
  tile is the **last** tile of its path (an explicit attack).
- **Aggressive:** if its next path tile holds an enemy unit or city, it attacks it. Otherwise, if any
  enemy unit is next to it, it lunges at the **weakest** one (fewest hp, then the one it would hurt
  most, then lowest id) and does not walk on. A lunge only hits an enemy that stays put: if the enemy
  steps away this tick, the Aggressive unit stays where it is.
- **Hold:** never moves. +50 % defence outside cities (inside its own city the city's bonus applies
  instead). Archers on Hold keep **overwatch** (4.5).
- **Settlers** never attack; an Aggressive Settler behaves as a Cautious one.

### 4.2 Meetings

- **Swap:** two enemies stepping into each other's tiles meet halfway (event `clash`, `tile: null`).
- **Same tile:** when units of two or more players step into the same tile, and that tile is empty or
  is being left this tick, they meet in it (`clash` with the tile). Each player is represented by one
  unit (see 4.3); with three players every pair clashes.
- In a clash both sides fight with **attack strength** (Settlers use their defence), type bonus and
  health only: no terrain, height, stance or city modifiers. Nobody enters the tile. Both units stop
  for the rest of the turn and keep their paths.

### 4.3 Movement

- A unit enters a tile that is empty, or that a friend leaves in the same tick. Columns of friends
  move together, and friends can swap places or rotate (only if nobody else wants those tiles).
- Several friends wanting the same tile: the one with the most points goes first (ties: lowest id),
  the others wait and try again next tick.
- A unit that steps toward an enemy that **leaves** its tile this tick simply walks into the empty
  tile. A unit that steps into an enemy that **stays** attacks it (4.4).
- A unit that wanted to move but could not by the end of tick 6 reports `halt` `blocked`.

### 4.4 Melee

- All melee in a tick is computed from the strengths at the start of the tick, and all damage lands
  at once. Both sides take damage.
- **Attacking ends the attacker's movement for the turn.** The defender is **engaged**: it is done
  for the turn too, no more moves or attacks (`halt` `engaged` if it had a path). So the faster unit
  strikes first and pins its target: a Rider can catch an Archer before it gets away.
- If the defender dies and the surviving attackers all belong to one player, the one that dealt the
  most damage **advances** into the tile (it consumes that step of its path, or drops its path if it
  was a lunge). Nobody advances into a city that still has hp.
- **Cities.** A unit inside its own city defends with +50 % (Hold adds nothing there), and +50 % more
  when the attacker comes from a side covered by a wall (section 7). An empty enemy city with hp defends itself (strength 4,
  +50 % from a walled side); bring it to 0 hp in melee and the attacker advances and **captures** it.
  An empty city that already has 0 hp is captured by the first unit that walks in, without a fight.
- **Capture:** the city changes owner, keeps its buildings, drops to 5 hp and loses one citizen
  (never below 1). Its construction, stores and capital status are cleared.

### 4.5 Overwatch

At the end of every tick, an Archer on **Hold** that has neither fired nor fought this turn shoots if
an enemy unit is in range: its ordered target if that tile holds one, otherwise the weakest in range
(fewest hp, then most damage, then lowest id). It fires once per turn; if nothing came into range it
volleys at tick 7 like everyone else.

### 4.6 Contact

At the end of every tick, a **Cautious** unit (or a Settler) that still has a path and has an enemy
unit next to it that was not next to it at the start of the tick **stops and drops its orders**
(path and founding flag; `halt` `contact`). Exception: its next step is the explicit attack at the
end of its path.

## 5. Tick 7: volleys

All at once, from the state after tick 6:

- Every **Archer** that has not fought in melee or a clash and has not fired: its ordered `target` if
  it is in range (an enemy unit there, or else an enemy city there); otherwise the weakest enemy unit
  in range; otherwise the enemy city in range with the least hp.
- Every **city** with hp > 0 shoots the weakest enemy unit in its range.
- **Range:** 2 for Archers and cities, +1 when the shooter stands 2 or more levels above the target,
  and for cities +1 on a side with a Tower.
- **Garrisons are safe from arrows** while their city has hp: shots at a city tile hit the city. Once
  the city is at 0 hp (breached), its garrison can be shot.

## 6. Damage

`damage = clamp(round(3 x attacker strength / defender strength), 1, 10)`. In melee and clashes both
sides take damage; shots only hurt the target. Units have 10 hp, cities 20.

`strength = base x type bonus x health x (1 + bonuses)`

- **base:** attack or defence (or ranged) from the unit table; Settlers attack with 0.
- **type bonus:** Spearmen fight Riders at x2, attacking or defending.
- **health:** `0.5 + 0.5 x hp / max hp`, so a dying unit fights at about half strength.
- **bonuses** (added up): higher ground +15 % per level above the opponent, at most +45 % (attacker or
  defender, and for shots); for the defender only: forest +25 %, Hold +50 % (not inside a city),
  inside its own city +50 %, a wall facing the attacker +50 %.
- **Cities:** defence 4, shooting 2, both scaled by the city's health and height. A wall facing the
  attacker adds +50 % to defence; each Tower facing the target adds +1 to shooting (at most +2).
- **Sides.** The side of a city something is on is the nearest of the six directions by angle. A tile
  exactly between two sides is on both, so a wall or tower on either counts.

| Unit     | Cost | Speed | Attack | Defence | Special                                   |
|----------|------|-------|--------|---------|-------------------------------------------|
| Spearman | 20   | 2     | 4      | 4       | x2 against Riders                         |
| Archer   | 25   | 2     | 2      | 2       | shoots 4 at range 2                       |
| Rider    | 30   | 3     | 5      | 3       | fastest                                   |
| Settler  | 30   | 2     | 0      | 1       | founds a city; costs the city one citizen |

## 7. Inside the city

A city is a small board of 19 plots: the **square** (plot 0, never built on), six **inner** plots
(1..6) and twelve **outer** plots (7..18). Plot `1 + d` is the inner plot in direction `d` (0 = east,
counter-clockwise in `AXIAL_DIRS` order), plot `7 + 2d` the outer corner facing direction `d`, and plot
`8 + 2d` the outer side facing directions `d` and `d + 1`. An outer plot **faces** the city's real
neighbour tiles in those directions.

| Building | Cost | Plot | Worker | Gives |
|---|---|---|---|---|
| House | 15 | any | no | room for 2 more citizens |
| Farm | 20 | outer, facing grass or plains | yes | 2 food + 1 per faced grass or plains |
| Sawmill | 20 | outer, facing forest or hills | yes | 2 production + 1 per faced forest or hills |
| Harbor | 25 | outer, facing water | yes | 2 food + 1 per faced water tile |
| Workshop | 30 | inner | yes | 2 production + 1 per neighbouring Workshop or Sawmill |
| Market | 35 | inner | yes | 2 food + 1 per neighbouring House (at most 3), and 1 production |
| Barracks | 30 | inner | no | units cost 25 % less (rounded) |
| Temple | 40 | inner | yes | growth needs 25 % less food; extra score |
| Tower | 25 | outer | no | +1 city range and +1 city shooting on the sides it faces |
| Wall | 20 | outer | no | +50 % defence against attacks from the sides it faces |

- **Output.** The square makes 2 food and 4 production. Every citizen works in one building that needs
  a worker; a citizen without a job makes 1 food. Buildings that need a worker produce nothing
  without one.
- **Focus** decides who works where when there are more jobs than citizens: **Growth** values food
  twice (and the Temple), **Production** values production twice, **Balance** values both alike.
  Ties go to more food (to more production under Production).
- **Housing:** 2 citizens, +2 per House. A city never grows beyond it.
- **Construction.** A building order is paid with the city's production like a unit, one item at a
  time; the stored production carries over between items. When it completes the building stands on
  its plot (`built`) and the city's order is cleared. If the plot no longer takes it, the order is
  cleared with `buildFailed` and the production stays.
- **Starting cities.** Every city starts with a House on the inner plot facing the middle of the map.
  A capital also starts with a Farm on its best farm plot (or else a Sawmill, or else a Harbor).

## 8. Tick 8: end of turn, in order

1. **Founding.** A Settler with `found` set and an empty path founds a city on its tile. It fails
   (`foundFailed`, flag dropped) if any city is within 2 tiles (`tooClose`), or if another Settler
   founds within 2 tiles this turn: then **both** fail (`conflict`). A new city has 1 citizen.
2. **Cities**, oldest first:
   - **Output** (section 7) is computed with the city's current citizens and buildings.
   - **Production** is added to the store. If the store covers the build, it completes (one item per
     turn) and the rest carries over. A unit build reports `built` and then `spawn`: the unit appears
     on the city tile, or on the free passable neighbour nearest the middle of the map (ties: the
     counter-clockwise one as seen from the city). With no free tile, or a Settler from a city of 1,
     the unit waits. A Settler costs the city one citizen. A finished building takes effect next turn.
   - **Food:** each citizen eats 1. The store never drops below 0. The city grows when it holds
     `8 + 4 x pop` food (12, 16, 20, 24, ...; 25 % less with a staffed Temple) and has room; the rest
     carries over. A city at its housing keeps at most that much food.
3. **Healing.** Units that took no damage this turn heal 1 hp, or 3 hp inside their own city.
4. **City repair.** A city heals 3 hp (`cityRepair`), unless it or its garrison took damage this turn
   (a siege).
5. **Elimination.** A player with no cities is out; their remaining units are removed (`death`).
6. **Victory.** The last player with cities wins. After the last turn (60 by default) the best
   score wins: 10 per city + 3 per citizen + 1 per building (+3 more per Temple) + 1 per unit. A tie
   is a draw.

## 9. Fairness

Two-player maps are point-symmetric, seat 1 starts with the mirror image of seat 0's units and
capital, and the seed (not tile order) decides which half of the map each seat gets. The rules contain
no direction-dependent tie-breaks, so a mirrored position resolves to the mirrored result (tested in
`test/game.test.ts`, which also turns every city interior by three sides). The remaining tie-breaks
use ids: between one player's own pieces, or when a unit picks among equally weak enemies to attack
or shoot. Maps for three or four players cannot be symmetric: the generator picks the starts that are
best for the worst-off seat (share of the land plus site quality, at least 6 apart) and then shuffles
the seats.

## 10. What players see

`observe(state, player)` shows the whole board (no fog yet) but hides other players' plans: their
units' paths, founding flags and volley targets, and their cities' construction and stores. Stances,
buildings and city focus are visible.

## 11. Events (for replay)

| kind | tick | meaning |
|---|---|---|
| `move` | 1-6 | a unit entered a tile (also when advancing after a kill) |
| `clash` | 1-6 | two enemies met; `dmgA`/`dmgB` are the damage `a`/`b` took |
| `melee` | 1-6 | an attack on a unit or city; damage to both sides |
| `capture` | 1-6 | a city changed hands |
| `shot` | 1-7 | overwatch (1-6) or volley (7) |
| `death` | 1-8 | a unit died (8: its player was eliminated) |
| `halt` | 1-6 | `contact` (Cautious stop), `engaged` (attacked), `blocked` (end of tick 6) |
| `found`, `foundFailed` | 8 | founding |
| `built` | 8 | a construction finished: `item` is the unit type, or `{ building, plot }` for a building now standing |
| `buildFailed` | 8 | a building no longer fits its plot (`item`, `reason`); the production stays |
| `spawn`, `grow` | 8 | a new unit (after its `built`) and population; `grow` also reports shrinking (Settler built, or a capture at ticks 1-6) |
| `heal` | 8 | a unit healed (new hp) |
| `cityRepair` | 8 | a city repaired itself (new hp) |
| `eliminated`, `victory` | 8 | end of a player, end of the game |

Within a tick, events are in the order things happen: clashes, moves, melee, engaged halts, deaths,
advances and captures, overwatch shots and their deaths, contact halts.
