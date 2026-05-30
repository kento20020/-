"""軽量セルフテスト（回帰検知）。

  python3 -m roguelike.tests

設計仕様書の要請を最低限ガードする：
  - 生成バリデーション（到達可能性）が常に成立する
  - 同一シードは同一結果（再現性／デバッグ性：§11）
  - シナジーが機能する（毒コンボが素手より強い：§5）
  - 1ランが必ず終了する（無限ループ＝停滞を作らない）
"""
from __future__ import annotations

from . import data, world
from .engine import Game
from .bot import Bot
from .rng import GameRNG


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print(f"  ok: {msg}")


def test_generation_reachable():
    rng = GameRNG(42)
    for f in range(1, 6):
        lvl = world.generate(rng.map, f)
        check(world._reachable(lvl, lvl.start, lvl.exit),
              f"F{f} 入口→出口が到達可能")


def test_determinism():
    a = Bot(Game(seed=123, weapon_id="sword"), "power").run()
    b = Bot(Game(seed=123, weapon_id="sword"), "power").run()
    check(a == b, "同一シード・同一方針なら結果が一致（再現性）")


def test_poison_synergy():
    """毒コンボ（毒の刃＋深い傷＋腐食）が、素のダメージより速く敵を溶かす。"""
    def kill_turns(relic_ids):
        g = Game(seed=5, weapon_id="dagger")
        for rid in relic_ids:
            g.player.add_relic(data.RELICS[rid])
        e = g.enemies[0] if g.enemies else None
        from .engine import Enemy
        dummy = Enemy(data.ENEMIES["brute"], 0, 0)
        g.enemies = [dummy]
        turns = 0
        while dummy.alive and turns < 200:
            g.player_attack(dummy)
            g._tick_poison()
            turns += 1
        return turns
    bare = kill_turns([])
    combo = kill_turns(["venom", "deepwound", "corrosion"])
    check(combo < bare, f"毒コンボ({combo}T) < 素手({bare}T)：シナジーが機能")


def test_runs_terminate():
    import random
    meta = random.Random(0)
    for i in range(60):
        g = Game(seed=2000 + i, weapon_id=meta.choice(list(data.WEAPONS)),
                 num_floors=5)
        r = Bot(g, meta.choice(list(data.ARCHETYPES))).run(max_turns=1500)
        check(r["result"] in ("win", "dead"),
              f"seed{2000+i}: ランが必ず決着する（停滞なし）") if i % 20 == 0 else None
        assert r["result"] in ("win", "dead"), f"seed {2000+i} が停滞した"
    print("  ok: 60ラン全てが win/dead で終了（無限ループなし）")


def main():
    print("== ローグライト セルフテスト ==")
    for fn in (test_generation_reachable, test_determinism,
               test_poison_synergy, test_runs_terminate):
        print(f"[{fn.__name__}]")
        fn()
    print("\n全テスト通過 ✅")


if __name__ == "__main__":
    main()
