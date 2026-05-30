"""等価性検証フィクスチャの生成（設計仕様書_Web版 §24）。

TS 移植が Python 版と数値的に等価であることを証明するための基準データを作る：
  - result_grid : 代表シード×武器×ビルドの result() 一式（最終状態の完全一致用）
  - traced_run  : 1ランの各手番ごとの状態シグネチャ列（1手単位のズレ検出用）

シグネチャは Python / TS で同一文字列になるよう定義する。
"""
from __future__ import annotations

import random

from .engine import Game
from .bot import Bot


def rng_fixture() -> dict:
    """CPython random.Random の基準系列（TS rng.ts の一致検証用）。"""
    seeds = [0, 1, 7, 42, 2001, 3007, 5013, 7017, 11023, 123456, 999999]
    fix: dict = {"random": [], "randbelow": [], "choice": [], "choices": [], "shuffle": []}
    for s in seeds:
        r = random.Random(s)
        fix["random"].append({"seed": s, "values": [r.random() for _ in range(8)]})
    for s in seeds:
        for n in [2, 3, 5, 7, 10, 100, 640]:
            r = random.Random(s)
            fix["randbelow"].append({"seed": s, "n": n,
                                     "values": [r._randbelow(n) for _ in range(10)]})
    pop = ["rat", "slime", "bat", "archer", "brute", "healer"]
    for s in seeds:
        r = random.Random(s)
        fix["choice"].append({"seed": s, "pop": pop,
                              "values": [r.choice(pop) for _ in range(10)]})
    weights = [5, 4, 1, 2, 3, 2]
    for s in seeds:
        r = random.Random(s)
        fix["choices"].append({"seed": s, "pop": pop, "weights": weights,
                               "values": [r.choices(pop, weights=weights)[0] for _ in range(12)]})
    for s in seeds:
        r = random.Random(s)
        lst = list(range(20))
        r.shuffle(lst)
        fix["shuffle"].append({"seed": s, "input": list(range(20)), "output": lst})
    return fix


def sig(g: Game) -> str:
    """各手番の状態を一意な文字列へ（TS 側と同一定義）。"""
    p = g.player
    head = f"{g.floor_num}|{g.turn}|{g.state}|{p.x},{p.y}|{p.hp}/{p.max_hp}|{p.attack}|{p.defense}"
    body = ";".join(
        f"{e.etype.id},{e.x},{e.y},{e.hp},{e.poison},{1 if e.telegraph else 0}"
        for e in g.enemies if e.alive
    )
    return head + "#" + body


def traced_run(seed: int, weapon: str, build: str, num_floors: int = 5,
               max_turns: int = 1500) -> dict:
    """Bot.run と同一制御フローで走らせ、各手番のシグネチャを記録する。"""
    g = Game(seed=seed, weapon_id=weapon, num_floors=num_floors)
    bot = Bot(g, build)
    trace = [sig(g)]
    while g.state in ("playing", "reward") and g.turn < max_turns:
        if g.state == "reward":
            g.take_reward(bot.choose_reward())
            bot._floor, bot._floor_steps, bot._rush = g.floor_num, 0, False
            trace.append(sig(g))
            continue
        if g.floor_num != bot._floor:
            bot._floor, bot._floor_steps, bot._rush = g.floor_num, 0, False
        bot._floor_steps += 1
        if bot._floor_steps > 120 and not g._is_boss_floor():
            bot._rush = True
        g.player_act(bot.decide())
        trace.append(sig(g))
    return {"result": g.result(), "trace": trace}


def result_grid(seeds, weapons, builds, num_floors: int = 5) -> dict:
    """代表グリッドの result() 一式（key='seed|weapon|build'）。"""
    out = {}
    for s in seeds:
        for w in weapons:
            for b in builds:
                g = Game(seed=s, weapon_id=w, num_floors=num_floors)
                out[f"{s}|{w}|{b}"] = Bot(g, b).run()
    return out
