"""KPI観測ハーネス（設計仕様書 §12）。

Botに大量のランを自動プレイさせ、「面白さ」を裏取りするための統計を出す:
  完走率 / 平均ラン時間 / 死因分布 / ビルド分布 / 武器別勝率 /
  レリックの採用率と勝率（罠アイテム・過小評価の検出）。
"""
from __future__ import annotations

import argparse
import random
import statistics
from collections import Counter, defaultdict

from . import data
from .engine import Game
from .bot import Bot


def run_batch(n, num_floors, base_seed=1000):
    meta = random.Random(base_seed)
    weapons = list(data.WEAPONS.keys())
    prefs = list(data.ARCHETYPES)
    results = []
    for i in range(n):
        seed = base_seed + i
        weapon = meta.choice(weapons)
        pref = meta.choice(prefs)
        g = Game(seed=seed, weapon_id=weapon, num_floors=num_floors)
        results.append(Bot(g, preferred_archetype=pref).run())
    return results


# --------------------------- 表示ユーティリティ ---------------------------
def bar(frac, width=28):
    f = max(0.0, min(1.0, frac))
    n = int(round(f * width))
    return "█" * n + "·" * (width - n)


def pct(x):
    return f"{x*100:5.1f}%"


def section(title):
    print("\n" + title)
    print("-" * len(title))


def report(results, num_floors):
    n = len(results)
    clears = [r for r in results if r["result"] == "win"]
    deaths = [r for r in results if r["result"] == "dead"]
    clear_rate = len(clears) / n

    print("=" * 60)
    print(f" ローグライト KPIレポート  (runs={n}, フロア数={num_floors})")
    print("=" * 60)

    section("■ ラン完走率（クリア率） — 難易度の妥当性")
    print(f"  クリア : {len(clears):4d}  {bar(clear_rate)} {pct(clear_rate)}")
    print(f"  死亡   : {len(deaths):4d}  {bar(len(deaths)/n)} {pct(len(deaths)/n)}")

    section("■ 平均ラン時間（ターン数） — ペーシング")
    turns = [r["turns"] for r in results]
    print(f"  全体   平均 {statistics.mean(turns):6.1f} / 中央 {statistics.median(turns):6.0f}"
          f" / 最短 {min(turns)} / 最長 {max(turns)}")
    if clears:
        ct = [r["turns"] for r in clears]
        print(f"  クリア 平均 {statistics.mean(ct):6.1f} / 中央 {statistics.median(ct):6.0f}")
    if deaths:
        dt = [r["turns"] for r in deaths]
        print(f"  死亡   平均 {statistics.mean(dt):6.1f} / 中央 {statistics.median(dt):6.0f}")

    section("■ 到達フロア分布 — どこで詰まるか")
    fc = Counter(r["floors_reached"] for r in results)
    for f in sorted(fc):
        print(f"  F{f:<2d}: {fc[f]:4d}  {bar(fc[f]/n)} {pct(fc[f]/n)}")

    section("■ 死因分布 — 公平性（特定要因への集中は理不尽の兆候）")
    cc = Counter(r["death_cause"] for r in deaths)
    if not cc:
        print("  （死亡なし）")
    for cause, c in cc.most_common():
        name = data.ENEMIES[cause].name if cause in data.ENEMIES else cause
        print(f"  {name:<10s}: {c:4d}  {bar(c/max(1,len(deaths)))} {pct(c/max(1,len(deaths)))}")

    section("■ ビルド分布 — 多様性（1系統への偏りはバランス崩壊）")
    bc = Counter(r["build"] for r in results)
    for arch in list(data.ARCHETYPES) + ["none"]:
        if bc.get(arch):
            print(f"  {arch:<8s}: {bc[arch]:4d}  {bar(bc[arch]/n)} {pct(bc[arch]/n)}")
    # クリア限定のビルド分布（勝てる系統はどれか）
    if clears:
        bcw = Counter(r["build"] for r in clears)
        print("  -- クリアしたランのビルド --")
        for arch, c in bcw.most_common():
            print(f"  {arch:<8s}: {c:4d}  {bar(c/len(clears))} {pct(c/len(clears))}")

    section("■ 武器別 勝率 — 個別バランス")
    by_w = defaultdict(lambda: [0, 0])
    for r in results:
        by_w[r["weapon"]][0] += 1
        by_w[r["weapon"]][1] += (r["result"] == "win")
    for wid, (tot, win) in sorted(by_w.items()):
        wr = win / tot
        print(f"  {data.WEAPONS[wid].name:<6s}: n={tot:3d}  勝率 {bar(wr)} {pct(wr)}")

    section("■ レリック 採用率 / 採用時勝率 — 罠・過小評価の検出")
    offered = Counter()
    taken = Counter()
    taken_win = Counter()
    for r in results:
        for rid in set(r["relics_offered"]):
            offered[rid] += 1
        for rid in r["relics_taken"]:
            taken[rid] += 1
            if r["result"] == "win":
                taken_win[rid] += 1
    print(f"  {'レリック':<12s}{'系統':<8s}{'提示':>5s}{'採用':>5s}{'採用率':>8s}{'採用時勝率':>10s}")
    rows = []
    for rid in data.RELICS:
        off = offered.get(rid, 0)
        tk = taken.get(rid, 0)
        pick = tk / off if off else 0.0
        wr = taken_win.get(rid, 0) / tk if tk else 0.0
        rows.append((pick, rid, off, tk, wr))
    for pick, rid, off, tk, wr in sorted(rows, reverse=True):
        rel = data.RELICS[rid]
        flag = ""
        if off >= 8 and pick < 0.10:
            flag = "  ← 死にアイテム?"
        if tk >= 8 and wr > clear_rate + 0.20:
            flag = "  ← 過小評価/強い?"
        print(f"  {rel.name:<12s}{rel.archetype:<8s}{off:5d}{tk:5d}{pct(pick):>9s}{pct(wr):>10s}{flag}")

    section("■ 総括（自動診断）")
    diag = []
    if clear_rate < 0.15:
        diag.append("クリア率が低すぎ＝理不尽の疑い。難易度/敵火力を見直す。")
    elif clear_rate > 0.75:
        diag.append("クリア率が高すぎ＝緊張不足。敵密度/火力を上げる余地。")
    else:
        diag.append(f"クリア率 {pct(clear_rate)} は手応えのある帯域。")
    nonzero_builds = sum(1 for a in data.ARCHETYPES if bc.get(a))
    if clears:
        win_builds = len(set(r["build"] for r in clears) - {"none"})
        diag.append(f"クリアに使われたビルド系統 {win_builds} 種（多いほど多様）。")
    top_cause = cc.most_common(1)
    if top_cause and len(deaths) and top_cause[0][1] / len(deaths) > 0.5:
        nm = top_cause[0][0]
        nm = data.ENEMIES[nm].name if nm in data.ENEMIES else nm
        diag.append(f"死因が「{nm}」に過半集中＝この敵が理不尽でないか要確認。")
    for d in diag:
        print(f"  - {d}")
    print("=" * 60)
    return {
        "clear_rate": clear_rate,
        "avg_turns": statistics.mean(turns),
        "builds": dict(bc),
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description="ローグライト KPIシミュレータ")
    ap.add_argument("-n", "--runs", type=int, default=500)
    ap.add_argument("-f", "--floors", type=int, default=5)
    ap.add_argument("-s", "--seed", type=int, default=1000)
    args = ap.parse_args(argv)
    results = run_batch(args.runs, args.floors, base_seed=args.seed)
    report(results, args.floors)


if __name__ == "__main__":
    main()
