# Cirkel-Civ: spec v0.1

*Working title. The game gets a real name later.*

Our own civ-like strategy game, built together, that works for humans in multiplayer and that AI agents can train on. Not a Civ 6 copy. This document is the first interpretation and drives what goes into the first demo.

## 1. The core idea: everyone orders at once, everything happens at once

In Civ with simultaneous turns, orders execute the moment you click. Whoever clicks first in a fight acts first, which turns combat into a clicking race.

Here it works differently:

1. **Planning.** Every player gives orders to their units and cities. Nobody sees what the others are planning.
2. **Resolution.** When everyone has pressed *Ready*, all orders run at the same time, in six small time steps (ticks). Nobody goes first.
3. **Replay.** Everyone watches what happened, step by step. Then the next planning phase begins.

It is like a real battle: you have a plan, you do not know what the enemy will do, and the plan holds until it meets the enemy.

**No dice.** Combat is fully deterministic. All uncertainty comes from what your opponents ordered. The same orders always give the same outcome, which also makes the game easier to train agents on.

## 2. Design principles

- **Easy to learn, hard to master.** Few unit types with clear strengths and weaknesses. The depth comes from timing, position and guessing what others will do.
- **Several time horizons.** Short term: where do my troops go this turn? Medium: which army do I build? Long term: do I grow my cities and expand, or go to war now?
- **Height matters.** Every hex has its own height. Height affects movement, combat and range.
- **One engine for humans and bots.** The rules are a pure, headless engine with no graphics. The web client, the server and training scripts all use exactly the same code.

## 3. Resolution, tick by tick

A turn has six ticks. Every unit has a speed. Each tick the unit gathers movement points, and when it has enough for the next hex on its path, it steps in. A rider (speed 3) therefore gets somewhere before a spearman (speed 2), even if both got their orders at the same time.

Each tick, in this order:

1. **Commanders react** (see section 6). A cautious unit that makes contact with the enemy stops. An aggressive unit switches target to the nearest enemy.
2. **Meetings.** Two enemies trying to step into the same empty hex clash in a meeting engagement. Two enemies trying to swap places meet in the middle. Either way they fight and stop for the rest of the turn.
3. **Movement.** Units step into empty hexes, or into hexes a friend leaves in the same tick. A unit stepping into an enemy that stays put attacks it.
4. **Melee.** All attacks in the same tick use the strengths at the start of the tick, and damage is dealt simultaneously. If the defender dies, the attacker moves in.
5. **Overwatch.** Archers holding position shoot the first enemy that comes within range.

After the sixth tick, the remaining archers and the cities fire their volleys, all at once. Then new cities are founded, cities produce and grow, and units heal.

An order longer than one turn continues automatically next turn, until you change it.

## 4. Units and combat

| Unit | Cost | Speed | Attack | Defence | Special |
|---|---|---|---|---|---|
| Spearman | 20 | 2 | 4 | 4 | Double strength against riders |
| Archer | 25 | 2 | 2 (melee), 4 (ranged) | 2 | Shoots 2 hexes away |
| Rider | 30 | 3 | 5 | 3 | Fastest |
| Settler | 30 | 2 | 0 | 1 | Founds a city, costs one citizen |

That makes a simple triangle: spears beat riders, riders catch and beat archers, archers shoot spears to pieces before they arrive.

**Damage.** Every unit has 10 health. In melee both sides take damage: about 3 times the ratio between their strengths, between 1 and 10. Equally strong units therefore take about 3 damage each. Damaged units fight worse.

**Modifiers:**
- Higher ground: +15% per height level above the opponent (max +45%). Shooters on high ground (2+ levels) reach one hex further.
- Forest: +25% defence.
- *Hold* stance: +50% defence.
- In a city: +50% defence, and a wall on the side the attack comes from adds another +50%.
- Meeting engagements: both use their attack strength, nobody gets a defence bonus.

**One unit per hex.** That makes positioning matter and keeps collisions clear.

## 5. Cities and economy

- A settler founds a city at the end of the turn. Cities must be at least three hexes apart. If two settlers try to found too close to each other in the same turn, both fail.
- A city gets food and production from its buildings (see 5b), not by placing citizens on tiles.
- Food makes the city grow. Production builds units or buildings. Unused production carries over to the next item in the queue.
- Cities have 20 health, shoot by themselves (range 2) and heal every turn. A city without a garrison and at 0 health is captured by the first melee unit that walks in.
- **Victory:** take all your opponents' cities. Otherwise the highest score after 60 turns wins (cities, citizens, buildings, units).

## 5b. Inside the city

Entering a city is a view of its own. The camera dives down and the city appears as a small hand-built diorama, far more detailed than the map: streets, a square, houses, market stalls, smoke from the chimneys and people moving about. This is where the long-term decisions are made.

**The quarters.** The city is its own small board of 19 plots: the square in the middle, six inner plots and twelve outer ones. Every outer plot faces a real neighbouring tile on the map, so the inside of the city mirrors the landscape around it. A plot facing the forest suits a sawmill, one facing the sea a harbor, one facing the meadows a farm.

**Buildings.** You build one thing at a time on a plot, with the city's production. Neighbours matter:

| Building | Plot | Gives |
|---|---|---|
| House | anywhere | Housing: room for 2 more citizens |
| Farm | outer, facing grassland or plains | Food, more the richer the tiles it faces |
| Sawmill | outer, facing forest or hills | Production |
| Workshop | inner | Production, +1 for each neighbouring workshop or sawmill |
| Market | inner | Food and production, +1 food for each neighbouring house |
| Harbor | outer, facing water | Food from the sea |
| Barracks | inner | All units cost 25% less |
| Temple | inner, next to the square | Score, and the city grows faster |
| Tower | outer | The city shoots one hex further on that side, and harder |
| Wall | outer | +50% defence against attacks from that side |

**Citizens work in the buildings.** Farms, sawmills, workshops, markets, harbors and temples each need a citizen to produce anything. Houses set the cap on how many people can live in the city. When there are not enough people, the city's focus (Growth, Production or Balance) decides which buildings are staffed.

**Walls and towers have a direction.** You protect the side you think the enemy will come from. Guess wrong and the wall stands in the wrong place.

Later: the city's mood, festivals and events, quarters that grow together into districts, and special buildings only one city at a time can have.

## 6. Local commanders (stances)

The idea is that local AI commanders shape how battles play out. The first version is simple: every unit has a stance that decides how it reacts to the unexpected during resolution, when the player cannot step in.

- **Cautious** (default): follows its path but stops as soon as an enemy appears next to it. Only attacks if you explicitly ordered it to.
- **Aggressive:** seeks battle. If an enemy is adjacent and the unit is ready to move, it attacks the weakest one.
- **Hold:** stands still with +50% defence. Archers keep watch and shoot the first enemy that comes within range.

Later a stance can be replaced by a real commander: a small trained model or a script a player writes, which sees the situation every tick and decides for the unit.

## 7. The map

- Hexes with individual heights (0 to 8). Below level 2 is water.
- Terrain: deep sea, shallow water, beach, grassland, plains, forest, hills, mountains (impassable) and snow.
- Climbing costs extra movement. A height difference of more than two levels is a cliff that cannot be crossed.
- The map is generated from a seed, so the same seed gives the same world. With two players the map is point-symmetric, so both start on exactly equal terms.

## 8. Architecture

```
src/engine/   Pure TypeScript, no graphics: hex math, map generator, rules, resolution, bots
src/server/   Node: rooms, turn order, saved games, websockets. The server owns the truth.
src/client/   The browser: Three.js for the map, React for the panels
scripts/sim   Runs thousands of bot-vs-bot games headless and measures speed
scripts/gym   A simple JSON-over-stdin protocol so Python agents can play
```

The engine is a pure function: `resolve(state, everyone's orders) → new state + events`. That makes it easy to run in parallel, easy to test and easy to replay.

**About CUDA:** it is too early. The rules will change every week at first, and a GPU version would freeze them. First we make the game fun with a fast TypeScript engine. Once the rules have settled, the resolution itself can be rewritten in Rust or JAX for massively parallel training, with this version as the reference.

## 9. The first demo (what is being built now)

**In:**
- Online multiplayer for 2 to 4 players, via a link. Empty seats are filled with bots.
- Play against a bot right away, without waiting for anyone.
- The whole turn cycle: plan in secret, press *Ready*, watch the resolution replay tick by tick.
- A 3D hex map with heights, four unit types, cities, growth, conquest and victory.
- The city view with quarters, buildings and directional walls (5b).
- Sound: effects, ambience and music.
- Works on phones.
- A simple bot and a headless simulation script.

**Not yet:**
- Fog of war. Kept out until the core rules feel right, but the server already sends each player their own view, so it can be added.
- Technologies, diplomacy, trade, weather and physics, story.
- Real AI commanders and trained agents.

## 10. Open questions

1. Should a meeting engagement stop both units for the rest of the turn, or only for one tick?
2. Should the game have fog of war early? It makes height and scouting matter more, but turns become more guesswork.
3. How long should turns be in a game between friends? No time limit (play over several days), or, say, 2 minutes?
4. What should the long horizon be about: technology, culture, religion, or something entirely our own?
5. How should a game be won? Today: take every rival city, or the best score after 60 turns. With the current rules equal opponents rarely take all of each other's cities, so most games end on score. Options: a capital victory (take every rival capital), a domination victory (hold two thirds of all cities for a few turns), longer games, or fewer cities.
6. What should the game be called?

## 11. How we work

- Ideas, rule changes and bugs are collected continuously. Changes are built, tested and deployed to the same link, with a short note about what is new.
- This spec is updated when decisions change, with a line in the changelog.

## Changelog

- **v0.1** (12 October 2026): first spec. The game is in English.
- **v0.2** (12 October 2026): the city interior (5b) is in the game: buildings drive the economy, walls and towers face a direction. Open question 5 added (how to win).
