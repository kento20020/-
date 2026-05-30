"""統計取得用のヒューリスティックAIプレイヤー。

人間の代わりに大量のランを自動プレイし、KPI（§12）を集める。
最適行動ではなく「そこそこ賢い平均的プレイ」を狙う：
  - 危険（射手の射線・ボスの予兆範囲）は可能なら避ける
  - 治癒師・射手を優先的に狙う
  - 出口を目指しつつ道中の敵を処理する
  - 報酬は「狙うアーキタイプ」に寄せて選ぶ（ビルド分布を生むため）
"""
from __future__ import annotations

from collections import deque

from . import data

DIRS = ((1, 0), (-1, 0), (0, 1), (0, -1))


class Bot:
    def __init__(self, game, preferred_archetype=None):
        self.g = game
        # 狙うビルド系統。None なら獲得済みに寄せる日和見ドラフト。
        self.pref = preferred_archetype
        # アンチストール：1フロアで長居しすぎたら出口直行に切替える
        self._floor = 0
        self._floor_steps = 0
        self._rush = False

    # --- 危険タイルの推定（予兆を読んで回避：公平性の検証） ---
    def _danger(self):
        g = self.g
        danger = set()
        for e in g.enemies:
            if not e.alive:
                continue
            if e.behavior == "ranged" and e.telegraph:
                # 射手のコミット済み射線
                for d in DIRS:
                    x, y = e.x, e.y
                    for _ in range(e.etype.sight):
                        x, y = x + d[0], y + d[1]
                        if not g.level.is_floor(x, y):
                            break
                        danger.add((x, y))
            if e.behavior == "boss" and e.telegraph:
                for dx in range(-3, 4):
                    for dy in range(-3, 4):
                        danger.add((e.x + dx, e.y + dy))
        return danger

    def _bfs_step(self, start, goal, blocked):
        g = self.g
        prev = {start: None}
        q = deque([start])
        while q:
            cur = q.popleft()
            if cur == goal:
                # 経路を逆順に辿り、最初の一歩を返す
                node = cur
                while prev[node] is not None and prev[node] != start:
                    node = prev[node]
                if prev[node] is None:
                    return (0, 0)
                return (node[0] - start[0], node[1] - start[1])
            for dx, dy in DIRS:
                nx, ny = cur[0] + dx, cur[1] + dy
                np = (nx, ny)
                if np in prev or not g.level.is_floor(nx, ny):
                    continue
                if np in blocked and np != goal:
                    continue
                prev[np] = cur
                q.append(np)
        return None

    def _choose_target(self):
        g = self.g
        alive = [e for e in g.enemies if e.alive]
        if not alive:
            return None
        px, py = g.player.x, g.player.y

        def score(e):
            d = abs(e.x - px) + abs(e.y - py)
            prio = {"support": -6, "ranged": -4}.get(e.behavior, 0)
            return d + prio
        return min(alive, key=score)

    # --- 報酬選択（ビルドを寄せる） ---
    def choose_reward(self):
        g = self.g
        offered = g.offered
        if not offered:
            return 0
        relics = [data.RELICS[o] for o in offered]

        def value(r: data.Relic):
            v = 1.0
            if self.pref and r.archetype == self.pref:
                v += 3.0
            # 既に持つ系統との相乗りを少し評価（シナジー指向）
            owned = [x.archetype for x in g.player.relics]
            v += owned.count(r.archetype) * 0.8
            # HPが心許なければ持続/防御を加点
            if g.player.hp < g.player.max_hp * 0.5 and r.archetype in ("sustain", "thorns"):
                v += 1.0
            return v
        best = max(range(len(relics)), key=lambda i: value(relics[i]))
        return best

    def _adjacent_enemies(self):
        g = self.g
        px, py = g.player.x, g.player.y
        return [e for e in g.enemies if e.alive and
                abs(e.x - px) + abs(e.y - py) == 1]

    # --- 1手を決める ---
    # 方針：出口（最終的な勝利条件）を主目標にする。隣接した敵は倒し、
    # 経路を塞ぐ敵だけ排除する。逃げ回る治癒師を延々追わない。
    def decide(self):
        g = self.g
        p = g.player
        low_hp = p.hp < p.max_hp * 0.40

        # 隣接した敵は優先度順に攻撃（治癒師・射手から）
        adj = self._adjacent_enemies()
        if adj:
            adj.sort(key=lambda e: {"support": 0, "ranged": 1}.get(e.behavior, 2))
            t = adj[0]
            return ("move", t.x - p.x, t.y - p.y)

        alive = {(e.x, e.y) for e in g.enemies if e.alive}
        target = self._choose_target()

        # rushモード：敵を障害物とみなさず出口への最短路を進む（道中の敵は
        # 殴り倒す）。連結マップなら必ず経路があり、停滞も振動も起こらない。
        if self._rush:
            step = self._bfs_step((p.x, p.y), g.level.exit, set())
            if step and step != (0, 0):
                return ("move", *step)
            return ("wait",)

        # 一歩先の小目標を決める：近接敵を片付けるか、出口へ向かうか。
        # （危険＝予兆タイルは経路ブロックにしない＝張り付き回避。HP低下時のみ回避する）
        subgoal = g.level.exit
        if not self._rush and target is not None and \
                abs(target.x - p.x) + abs(target.y - p.y) <= 7:
            subgoal = (target.x, target.y)

        step = self._bfs_step((p.x, p.y), subgoal, alive - {subgoal})
        if step is None and subgoal != g.level.exit:
            step = self._bfs_step((p.x, p.y), g.level.exit, alive)
        if step is None and target is not None:
            # 出口が敵で塞がれている → 敵を排除して必ず前進する
            step = self._bfs_step((p.x, p.y), (target.x, target.y),
                                  alive - {(target.x, target.y)})

        # HPが低いときだけ、予兆タイルへの踏み込みを安全な前進に差し替える。
        # ただしrush中は回避を切り、出口へ単調に前進させる（停滞を断ち切る）。
        if low_hp and not self._rush and step and step != (0, 0):
            danger = self._danger()
            nx, ny = p.x + step[0], p.y + step[1]
            if (nx, ny) in danger:
                best = None
                bestd = abs(p.x - subgoal[0]) + abs(p.y - subgoal[1])
                for dx, dy in DIRS:
                    tx, ty = p.x + dx, p.y + dy
                    if g.level.is_floor(tx, ty) and not g.occupied(tx, ty) and (tx, ty) not in danger:
                        d = abs(tx - subgoal[0]) + abs(ty - subgoal[1])
                        if d <= bestd:
                            bestd, best = d, (dx, dy)
                if best:
                    return ("move", *best)

        if step and step != (0, 0):
            return ("move", *step)
        return ("wait",)

    # --- 1ラン完走 ---
    def run(self, max_turns=1500):
        g = self.g
        while g.state in ("playing", "reward") and g.turn < max_turns:
            if g.state == "reward":
                g.take_reward(self.choose_reward())
                self._floor, self._floor_steps, self._rush = g.floor_num, 0, False
                continue
            # フロア滞在が長すぎたら出口直行モードへ
            if g.floor_num != self._floor:
                self._floor, self._floor_steps, self._rush = g.floor_num, 0, False
            self._floor_steps += 1
            if self._floor_steps > 120 and not g._is_boss_floor():
                self._rush = True
            g.player_act(self.decide())
        return g.result()
