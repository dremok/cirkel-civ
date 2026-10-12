# PROJECT_STATUS

*Last updated: 2026-10-13 01:35*

## Where this is

- Spec v0.3 (SPEC.md) and the rules (docs/RULES.md), both in English.
- Engine: simultaneous resolution, combat, economy, city interiors (19 plots, buildings, directional
  walls and towers), pathfinding, bot, observation, sim, gym. 101 tests, seat balance about 50/50.
- Server: rooms, seats, tokens, WebSocket protocol, JSON persistence with typed save migrations
  (schema v3), static serving.
- Client: home, lobby, play screen, planning, replay log, city view, end screen; diorama world,
  painted miniatures, sound and music.
- **Fog of war (v0.3, SPEC.md §7b):** the map starts under a cloud sea and is discovered tick by
  tick. Units see 2 tiles, cities 3, +1 on hills; height and forest block the line of sight; with
  fog, shooters need a line of sight. Land out of sight is veiled; rival cities there are shown as
  last seen. Each player gets their own view and replay stream (spotted / lost / explore events).
  Bots play by the same view and scout. Optional per game, on by default; old saves keep no fog;
  running fog games cannot be watched by spectators. Two new sounds (clouds parting, enemy spotted).

## Live

https://cirkel-civ-production.up.railway.app. Fog of war deployed 2026-10-13 (commit 0a0525f),
verified end to end on desktop and phone before deploying (vs-bot fog games, replays, no console
errors).

## Next

1. Feedback from players on fog of war.
2. Open design questions: victory conditions (SPEC.md §10.5), scouting (§10.2).
3. Polish: cloud billows are a little regular; check the fog look on real phones.
