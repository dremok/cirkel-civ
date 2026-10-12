#!/usr/bin/env python3
"""A random agent for Cirkel-Civ, talking to the engine through scripts/gym.ts (stdlib only).

    python3 examples/random_agent.py --games 3 --opponent bot

Every turn it asks the engine for each unit's legal moves, picks one at random (or stays), picks a
random stance, and for each city a random unit or a random building on a random plot (the engine
ignores buildings that do not fit). It loses to the built-in bot, which is the point:
the bot is the baseline to beat.
"""

import argparse
import json
import os
import random
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STANCES = ["cautious", "aggressive", "hold"]
UNITS = ["spear", "archer", "rider", "settler"]
BUILDINGS = ["house", "farm", "sawmill", "workshop", "market", "harbor", "barracks", "temple", "tower", "wall"]


class CirkelEnv:
    """One engine process; requests and responses are single JSON lines."""

    def __init__(self, cmd=("npx", "tsx", "scripts/gym.ts")):
        self.proc = subprocess.Popen(
            list(cmd), cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1
        )
        self.next_id = 0

    def call(self, cmd, **fields):
        self.next_id += 1
        self.proc.stdin.write(json.dumps({"id": self.next_id, "cmd": cmd, **fields}) + "\n")
        self.proc.stdin.flush()
        reply = json.loads(self.proc.stdout.readline())
        if not reply["ok"]:
            raise RuntimeError(reply["error"])
        return reply

    def reset(self, **config):
        return self.call("reset", config=config)

    def step(self, orders):
        return self.call("step", orders=orders)

    def moves(self, seat):
        """unit id -> {tile: path} for every tile the unit can enter this turn."""
        return self.call("moves", seat=seat)["moves"]

    def close(self):
        self.call_quietly("close")
        self.proc.wait(timeout=5)

    def call_quietly(self, cmd):
        self.proc.stdin.write(json.dumps({"cmd": cmd}) + "\n")
        self.proc.stdin.flush()


def random_orders(env, state, seat, rng):
    units, cities = {}, {}
    moves = env.moves(seat)
    for u in state["units"]:
        if u["owner"] != seat:
            continue
        options = moves.get(str(u["id"]), {})
        path = rng.choice(list(options.values())) if options and rng.random() < 0.8 else []
        order = {"path": path, "stance": rng.choice(STANCES)}
        if u["type"] == "settler":
            order["found"] = rng.random() < 0.3
        units[str(u["id"])] = order
    for c in state["cities"]:
        if c["owner"] != seat:
            continue
        if rng.random() < 0.6:
            cities[str(c["id"])] = rng.choice(UNITS)
        else:
            cities[str(c["id"])] = {"building": rng.choice(BUILDINGS), "plot": rng.randint(1, 18)}
    return {"units": units, "cities": cities}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", type=int, default=3)
    ap.add_argument("--opponent", default="bot", choices=["bot", "random", "idle"])
    ap.add_argument("--seed", default="py")
    args = ap.parse_args()

    env = CirkelEnv()
    seat = 0
    rng = random.Random(args.seed)
    try:
        for g in range(args.games):
            r = env.reset(seed=f"{args.seed}-{g}", players=2, agents=[seat], opponent=args.opponent)
            m = r["map"]
            print(f"game {g}: {m['width']}x{m['height']} map, playing seat {seat} against the {args.opponent}")
            while not r["done"]:
                state = r["observations"][str(seat)]["state"]
                r = env.step({str(seat): random_orders(env, state, seat, rng)})
                fights = sum(e["kind"] in ("melee", "clash", "shot") for e in r["events"])
                if r["turn"] % 10 == 1 or r["done"]:
                    mine = r["observations"][str(seat)]["state"]
                    cities = sum(c["owner"] == seat for c in mine["cities"])
                    units = sum(u["owner"] == seat for u in mine["units"])
                    print(f"  turn {r['turn'] - 1:2d}: {cities} cities, {units} units, scores {r['scores']}, {fights} fight events")
            print(f"  winner: {r['winner']} (scores {r['scores']})")
    finally:
        env.close()


if __name__ == "__main__":
    main()
