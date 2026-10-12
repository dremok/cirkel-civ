# PROJECT_STATUS

*Last updated: 2026-10-12 02:20*

## Where this is

- Spec v0.1 (SPEC.md, English) and the rules (docs/RULES.md).
- First demo nearly integrated, built by parallel agents on a shared contract. Committed so far:
  - Engine: simultaneous resolution, combat, economy, pathfinding, bot, observation, sim, gym, 60
    tests, seat balance about 50/50, about 11k resolved turns/s.
  - Server: rooms, seats, tokens, WebSocket protocol, JSON persistence, static serving.
  - UI (English): home, lobby, play screen, planning, replay log, end screen, reconnect, drafts.
  - World art round 2: floating diorama over a cloud sea, blended hues, rich flora, phone camera.
  - Pieces round 2: detailed miniatures, cities built from their 19-plot interiors, replay.
  - Sound: SFX, ambience and music with a WebAudio engine.
- In progress: city interior in the engine (buildings drive the economy, directional walls and
  towers, bot building, save migration), the city view (CityScreen), world and pieces polish
  rounds (colour variety, close-up detail).

## Next

1. Engine city interior lands; UI city wiring and CityScreen committed with it.
2. Wire audio into the play screen and replay.
3. End-to-end play test (desktop + phone), deploy, share the demo.
