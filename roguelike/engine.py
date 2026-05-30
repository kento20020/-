"""ゲームエンジン本体（設計仕様書 §4, §5, §6, §7）。

- イベントフック方式の戦闘で、データ側の組み合わせからシナジーを生む。
- 敵AIは行動パターンを一貫させ（学習可能）、遠隔/ボスは予兆を出す（公平性）。
- パーマデス。死因・到達度・ビルドを result に記録（死の納得感／KPI観測）。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from collections import deque

from . import data, world
from .rng import GameRNG


@dataclass
class DamageContext:
    amount: int
    attacker: object
    target: object
    source: str = "attack"   # attack / reflect / poison / boss
    extra_hits: int = 0


class Entity:
    def __init__(self, name, symbol, x, y, hp, attack, defense):
        self.name = name
        self.symbol = symbol
        self.x, self.y = x, y
        self.max_hp = hp
        self.hp = hp
        self.attack = attack
        self.defense = defense
        self.poison = 0
        self.alive = True
        self.is_player = False

    def heal(self, amount):
        if self.alive:
            self.hp = min(self.max_hp, self.hp + amount)

    def add_poison(self, stacks):
        self.poison += stacks


class Player(Entity):
    def __init__(self, x, y, weapon: data.Weapon):
        super().__init__("勇者", "@", x, y, hp=46, attack=2, defense=0)
        self.is_player = True
        self.weapon = weapon
        self.relics: list[data.Relic] = []
        self.gold = 0
        self.last_hit_by = None
        self.last_source = None

    def add_relic(self, relic: data.Relic):
        self.relics.append(relic)
        self.attack += relic.attack
        self.defense += relic.defense
        if relic.max_hp:
            self.max_hp += relic.max_hp
            if relic.max_hp > 0:
                self.hp += relic.max_hp
            self.hp = max(1, min(self.hp, self.max_hp))

    def has_flag(self, flag):
        return any(flag in r.flags for r in self.relics)

    @property
    def power(self):
        return self.attack + self.weapon.attack


class Enemy(Entity):
    def __init__(self, etype: data.EnemyType, x, y):
        super().__init__(etype.name, etype.symbol, x, y,
                         etype.hp, etype.attack, etype.defense)
        self.etype = etype
        self.behavior = etype.behavior
        self.cooldown = 0            # slow系の行動間引き
        self.telegraph = None        # 予兆: ("shot", axis, value) / ("slam",)


class Game:
    def __init__(self, seed: int, weapon_id: str = "sword",
                 num_floors: int = 5, starting_relics=None):
        self.rng = GameRNG(seed)
        self.seed = seed
        self.num_floors = num_floors
        self.floor_num = 0
        self.turn = 0
        self.kills = 0
        self.log: list[str] = []
        self.player = Player(0, 0, data.WEAPONS[weapon_id])
        for rid in (starting_relics or []):
            self.player.add_relic(data.RELICS[rid])
        self.enemies: list[Enemy] = []
        self.level: world.Level | None = None
        self.state = "playing"       # playing / reward / win / dead
        self.offered: list[str] = []
        # KPI用ログ
        self.relics_offered_total: list[str] = []
        self.relics_taken: list[str] = []
        self._build_floor()

    # ----- ログ -----
    def msg(self, text):
        self.log.append(text)
        if len(self.log) > 200:
            self.log = self.log[-200:]

    # ----- フロア構築 -----
    def _build_floor(self):
        self.floor_num += 1
        is_boss = self.floor_num >= self.num_floors
        self.level = world.generate(self.rng.map, self.floor_num)
        self.player.x, self.player.y = self.level.start
        self.enemies = []
        cells = [c for c in self.level.floor_cells()
                 if c != self.level.start and c != self.level.exit]
        self.rng.spawn.shuffle(cells)

        def far_cells():
            sx, sy = self.level.start
            return [c for c in cells if abs(c[0] - sx) + abs(c[1] - sy) > 6]

        spots = far_cells() or cells
        if is_boss:
            bx, by = self.level.exit
            self.enemies.append(Enemy(data.ENEMIES["boss"], bx, by))
            for c in spots[:2]:
                self.enemies.append(Enemy(data.ENEMIES["rat"], *c))
            self.msg("最深部。深淵の王が待ち構えている。")
        else:
            n = 4 + self.floor_num
            tier = min(4, self.floor_num)
            table = data.SPAWN_TABLE[tier]
            ids = [t[0] for t in table]
            weights = [t[1] for t in table]
            # 制約付き生成：治癒師など「対処に手間取る敵」が群れると
            # 退屈な停滞を生むため、1フロアあたりの上限を設ける（§4.1）。
            caps = {"healer": 1, "brute": 2}
            counts: dict[str, int] = {}
            for c in spots[:n]:
                for _try in range(6):
                    eid = self.rng.spawn.choices(ids, weights=weights)[0]
                    if counts.get(eid, 0) < caps.get(eid, 99):
                        break
                counts[eid] = counts.get(eid, 0) + 1
                self.enemies.append(Enemy(data.ENEMIES[eid], *c))
            self.msg(f"フロア{self.floor_num}：敵 {len(self.enemies)} 体。出口 '>' を目指せ。")

    # ----- 補助 -----
    def enemy_at(self, x, y):
        for e in self.enemies:
            if e.alive and e.x == x and e.y == y:
                return e
        return None

    def occupied(self, x, y):
        return (x, y) == (self.player.x, self.player.y) or self.enemy_at(x, y)

    def enemies_near(self, x, y, radius):
        return [e for e in self.enemies if e.alive and
                max(abs(e.x - x), abs(e.y - y)) <= radius and (e.x, e.y) != (x, y)]

    # ----- 戦闘コア -----
    def deal_reflect(self, owner, target, amount):
        if target.alive and amount > 0:
            self._apply_damage(target, amount, attacker=owner, source="reflect")

    def _apply_damage(self, target, amount, attacker, source):
        if amount <= 0 or not target.alive:
            return
        target.hp -= amount
        if target.is_player:
            target.last_hit_by = attacker
            target.last_source = source
        # 被弾フック（反射・報復など）。直接攻撃にのみ反応。
        if source == "attack" and target is self.player:
            for r in self.player.relics:
                if r.on_hit_taken:
                    r.on_hit_taken(self, self.player, attacker,
                                   DamageContext(amount, attacker, target, source))
        if target.hp <= 0:
            self._kill(target, attacker)

    def _kill(self, target, killer):
        target.alive = False
        if target is self.player:
            self.state = "dead"
            return
        # 敵の死亡
        self.kills += 1
        self.player.gold += target.etype.gold
        if killer is self.player:
            for r in self.player.relics:
                if r.on_kill:
                    r.on_kill(self, self.player, target)
        if target.etype.id == "boss":
            self.state = "win"
            self.msg("深淵の王を討ち取った！ 生還だ。")

    def player_attack(self, enemy):
        p = self.player
        hits, total, guard = 1, 0, 0
        while hits > 0 and enemy.alive and guard < 6:
            guard += 1
            hits -= 1
            ctx = DamageContext(p.power, p, enemy, "attack")
            for r in p.relics:
                if r.on_attack:
                    r.on_attack(self, p, enemy, ctx)
            dmg = max(1, ctx.amount - enemy.defense)
            total += dmg
            self._apply_damage(enemy, dmg, p, "attack")
            # 武器固有の毒（短剣など）は常時付与。レリック非依存の床を作る。
            if p.weapon.bonus_poison and enemy.alive:
                enemy.add_poison(p.weapon.bonus_poison)
            hits += ctx.extra_hits
        self.msg(f"{enemy.name}に{total}ダメージ" +
                 (f"（撃破）" if not enemy.alive else f"（残{max(0,enemy.hp)}）"))

    # ----- 状態異常 -----
    def _tick_poison(self):
        amp = 2 if self.player.has_flag("poison_amp") else 1
        for e in list(self.enemies):
            if e.alive and e.poison > 0:
                self._apply_damage(e, e.poison * amp, attacker=self.player, source="poison")
                e.poison -= 1
        # プレイヤー自身は本MVPでは被毒しないが、拡張に備え対称に扱う。
        if self.player.poison > 0:
            self._apply_damage(self.player, self.player.poison, None, "poison")
            self.player.poison -= 1

    # ----- 敵AI（行動パターンは一貫＝学習可能） -----
    def _step_toward(self, e, tx, ty, away=False):
        best, bestd = None, None
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = e.x + dx, e.y + dy
            if not self.level.is_floor(nx, ny) or self.occupied(nx, ny):
                continue
            d = abs(nx - tx) + abs(ny - ty)
            if bestd is None or (d > bestd if away else d < bestd):
                bestd, best = d, (nx, ny)
        if best:
            e.x, e.y = best

    def _adjacent_to_player(self, e):
        return abs(e.x - self.player.x) + abs(e.y - self.player.y) == 1

    def _enemy_attack_player(self, e, mult=1.0, source="attack"):
        dmg = max(1, int(e.attack * mult) - self.player.defense)
        self.msg(f"{e.name}の攻撃！ {dmg}ダメージ")
        self._apply_damage(self.player, dmg, e, source)

    def _line_clear(self, x0, y0, x1, y1):
        """同一行/列の直線が床で繋がっているか（射線判定）。"""
        if x0 == x1:
            step = 1 if y1 > y0 else -1
            return all(self.level.is_floor(x0, y) for y in range(y0 + step, y1, step))
        if y0 == y1:
            step = 1 if x1 > x0 else -1
            return all(self.level.is_floor(x, y0) for x in range(x0 + step, x1, step))
        return False

    def _act_enemy(self, e):
        p = self.player
        b = e.behavior
        if b in ("melee",):
            if self._adjacent_to_player(e):
                self._enemy_attack_player(e)
            else:
                self._step_toward(e, p.x, p.y)

        elif b == "slow":
            e.cooldown = (e.cooldown + 1) % 2
            if e.cooldown == 0:           # 2ターンに1回だけ動く
                return
            if self._adjacent_to_player(e):
                self._enemy_attack_player(e)
            else:
                self._step_toward(e, p.x, p.y)

        elif b == "erratic":
            for _ in range(2):            # 高速（2手）
                if self._adjacent_to_player(e):
                    self._enemy_attack_player(e)
                    return
                if self.rng.ai.random() < 0.6:
                    self._step_toward(e, p.x, p.y)
                else:                     # 不規則ステップ
                    dx, dy = self.rng.ai.choice(((1, 0), (-1, 0), (0, 1), (0, -1)))
                    if self.level.is_floor(e.x + dx, e.y + dy) and not self.occupied(e.x + dx, e.y + dy):
                        e.x, e.y = e.x + dx, e.y + dy

        elif b == "ranged":
            if e.telegraph:               # 予兆通り発射
                e.telegraph = None
                if (e.x == p.x or e.y == p.y) and self._line_clear(e.x, e.y, p.x, p.y):
                    self.msg(f"{e.name}が矢を放った！")
                    self._enemy_attack_player(e)
                else:
                    self.msg(f"{e.name}の矢は外れた（射線が切れた）。")
            elif (e.x == p.x or e.y == p.y) and self._line_clear(e.x, e.y, p.x, p.y) \
                    and abs(e.x - p.x) + abs(e.y - p.y) <= e.etype.sight:
                e.telegraph = ("shot",)   # 次ターン射撃を予告
                self.msg(f"{e.name}が狙いを定めている…（直線から外れて回避可）")
            else:
                self._step_toward(e, p.x, p.y)

        elif b == "support":
            wounded = [a for a in self.enemies_near(e.x, e.y, 1)
                       if a.alive and a.hp < a.max_hp]
            if wounded:
                t = wounded[0]
                t.heal(4)
                self.msg(f"{e.name}が{t.name}を回復した。")
            elif self._adjacent_to_player(e):
                self._enemy_attack_player(e)
            else:
                self._step_toward(e, p.x, p.y, away=True)   # 逃げ回る

        elif b == "boss":
            if e.telegraph:               # 予兆 → 全力スラム
                e.telegraph = None
                if abs(e.x - p.x) <= 3 and abs(e.y - p.y) <= 3:
                    self.msg(f"{e.name}の大振り一撃！")
                    self._enemy_attack_player(e, mult=2.0, source="boss")
                else:
                    self.msg(f"{e.name}のスラムは空を切った。")
            else:
                dist = abs(e.x - p.x) + abs(e.y - p.y)
                if dist <= 4 and self.rng.ai.random() < 0.5:
                    e.telegraph = ("slam",)
                    self.msg(f"{e.name}が力を溜めている…（3マス以上離れて回避）")
                elif self._adjacent_to_player(e):
                    self._enemy_attack_player(e)
                else:
                    self._step_toward(e, p.x, p.y)
                    # 低確率で増援を呼ぶ
                    if self.rng.ai.random() < 0.15:
                        for c in self.enemies_near(e.x, e.y, 2):
                            pass
                        spot = self._free_near(e.x, e.y)
                        if spot:
                            self.enemies.append(Enemy(data.ENEMIES["rat"], *spot))
                            self.msg(f"{e.name}が増援を呼んだ！")

    def _free_near(self, x, y):
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1)):
            nx, ny = x + dx, y + dy
            if self.level.is_floor(nx, ny) and not self.occupied(nx, ny):
                return (nx, ny)
        return None

    # ----- 1ターン進行 -----
    def _world_tick(self):
        self._tick_poison()
        if self.state != "playing":
            return
        for r in self.player.relics:
            if r.on_turn_start:
                r.on_turn_start(self, self.player)
        for e in list(self.enemies):
            if e.alive and self.state == "playing":
                self._act_enemy(e)
        self.enemies = [e for e in self.enemies if e.alive]
        self.turn += 1

    # ----- プレイヤー行動（UI/Botから呼ぶ） -----
    def player_act(self, action) -> str:
        """action: ('move',dx,dy) or ('wait',). 戻り値はイベント種別。"""
        if self.state != "playing":
            return "noop"
        result = "move"
        if action[0] == "move":
            _, dx, dy = action
            nx, ny = self.player.x + dx, self.player.y + dy
            target = self.enemy_at(nx, ny)
            if target:
                self.player_attack(target)
                result = "attack"
            elif self.level.is_floor(nx, ny):
                self.player.x, self.player.y = nx, ny
                if (nx, ny) == self.level.exit and not self._is_boss_floor():
                    self._world_tick()
                    if self.state == "playing":
                        self.state = "reward"
                        self.offered = self._roll_rewards()
                    return "exit"
            else:
                result = "blocked"
                return result          # 壁は手番を消費しない
        self._world_tick()
        return result

    def _is_boss_floor(self):
        return self.floor_num >= self.num_floors

    # ----- 報酬（3択・トレードオフ：§5.3） -----
    def _roll_rewards(self):
        owned = {r.id for r in self.player.relics}
        pool = [rid for rid in data.RELICS if rid not in owned]
        self.rng.loot.shuffle(pool)
        choices = pool[:3] if len(pool) >= 3 else pool
        self.relics_offered_total.extend(choices)
        return choices

    def take_reward(self, index):
        if self.state != "reward":
            return
        if 0 <= index < len(self.offered):
            rid = self.offered[index]
            self.player.add_relic(data.RELICS[rid])
            self.relics_taken.append(rid)
            self.msg(f"レリック獲得：{data.RELICS[rid].name}")
        # フロア踏破は小休止：最大HPの22%回復（連続事故の緩和：§7）
        self.player.heal(int(self.player.max_hp * 0.22))
        self.offered = []
        self.state = "playing"
        self._build_floor()

    # ----- 結果（KPI記録：§12） -----
    def result(self):
        relics = self.player.relics
        counts = {a: 0 for a in data.ARCHETYPES}
        for r in relics:
            counts[r.archetype] += 1
        dominant = max(counts, key=lambda k: counts[k]) if relics else "none"
        if dominant != "none" and counts[dominant] == 0:
            dominant = "none"
        if self.state == "dead":
            lb = self.player.last_hit_by
            if self.player.last_source == "poison":
                cause = "poison(self)"
            elif lb is not None:
                cause = lb.etype.id
            else:
                cause = "unknown"
        else:
            cause = None
        return {
            "seed": self.seed,
            "result": self.state,                 # win / dead
            "floors_reached": self.floor_num,
            "turns": self.turn,
            "kills": self.kills,
            "gold": self.player.gold,
            "weapon": self.player.weapon.id,
            "death_cause": cause,
            "build": dominant,
            "relics_taken": list(self.relics_taken),
            "relics_offered": list(self.relics_offered_total),
            "hp": max(0, self.player.hp),
        }
