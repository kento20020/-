"""データ駆動設計（設計仕様書 §11）。

敵・武器・レリックを「データ＋イベントフック」として定義する。
ゲームロジック（engine.py）はこの定義を解釈して動くだけなので、
バランス調整や要素追加をこのファイル内で完結できる。

レリックの効果はイベントフック（on_attack 等）で表現する。
フックは engine の DamageContext / Entity を duck typing で触る。
これにより「攻撃時に毒付与」×「毒の敵に追加ダメージ」のような
シナジー（1+1=3）がデータ側の組み合わせだけで生まれる。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Optional


# ---------------------------------------------------------------------------
# 武器（アクティブ要素の基礎）
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Weapon:
    id: str
    name: str
    attack: int
    defense_mod: int = 0
    bonus_poison: int = 0          # 命中時に追加で乗る毒スタック
    note: str = ""


WEAPONS = {
    "dagger": Weapon("dagger", "短剣", attack=3, bonus_poison=1,
                     note="基礎火力は低いが、命中ごとに毒を上乗せ。状態異常型と好相性。"),
    "sword": Weapon("sword", "剣", attack=6,
                    note="クセのない万能武器。どのビルドでも腐らない安定択。"),
    "hammer": Weapon("hammer", "大槌", attack=7, defense_mod=-3,
                     note="高火力だが防御-2。被弾を踏み倒す火力型／防御反射型向け。"),
}


# ---------------------------------------------------------------------------
# レリック（パッシブ要素・シナジーの主役）
# ---------------------------------------------------------------------------
@dataclass
class Relic:
    id: str
    name: str
    archetype: str                 # power / poison / thorns / sustain / utility
    desc: str
    # 静的補正（取得時に一度だけ適用）
    attack: int = 0
    defense: int = 0
    max_hp: int = 0
    # イベントフック（任意）。シグネチャは engine.py 参照。
    on_attack: Optional[Callable] = None
    on_hit_taken: Optional[Callable] = None
    on_turn_start: Optional[Callable] = None
    on_kill: Optional[Callable] = None
    flags: tuple = ()              # 他フックが参照する目印（例: "poison_amp"）


# --- フック実装 -------------------------------------------------------------
def _venom_on_attack(game, owner, target, ctx):
    # 攻撃時に毒3を付与（武器のbonus_poisonは engine 側で常時加算される）。
    if ctx.amount > 0:
        target.add_poison(3)


def _corrosion_on_attack(game, owner, target, ctx):
    # 毒に侵された敵への直接ダメージ+50%（毒型の核シナジー）。
    if target.poison > 0:
        ctx.amount = int(ctx.amount * 1.5)


def _berserk_on_attack(game, owner, target, ctx):
    # HPが減っているほど火力上昇（最大+10）。火力型のハイリスク軸。
    missing = 1.0 - owner.hp / max(1, owner.max_hp)
    ctx.amount += int(missing * 10)


def _double_strike_on_attack(game, owner, target, ctx):
    # 30%で同じ攻撃をもう一度（追撃）。
    if game.rng.combat.random() < 0.30:
        ctx.extra_hits += 1


def _vampiric_on_attack(game, owner, target, ctx):
    # 与ダメージの30%回復。持続力を底上げする横断シナジー。
    owner.heal(max(1, int(ctx.amount * 0.30)))


def _thorns_on_hit_taken(game, owner, attacker, ctx):
    # 受けたダメージの50%を反射。
    if attacker is not None and ctx.amount > 0:
        game.deal_reflect(owner, attacker, max(1, int(ctx.amount * 0.5)))


def _spiked_on_hit_taken(game, owner, attacker, ctx):
    # 被弾時に固定3反射（thornsと重ねて反射ビルドが完成）。
    if attacker is not None:
        game.deal_reflect(owner, attacker, 3)


def _retaliate_on_hit_taken(game, owner, attacker, ctx):
    # 被弾するたび恒久的に攻撃+1（このラン限り）。粘って育てる軸。
    owner.attack += 1


def _regen_on_turn(game, owner):
    owner.heal(1)


def _plague_on_kill(game, owner, victim):
    # 毒で侵された敵が死ぬと、周囲の敵へ毒3が伝播。
    if victim.poison > 0:
        for e in game.enemies_near(victim.x, victim.y, radius=2):
            e.add_poison(3)


RELICS = {
    # --- 火力型 (power) ---
    "sharp":    Relic("sharp", "鋭利な刃", "power", "攻撃+3。シンプルな火力上乗せ。", attack=3),
    "giant":    Relic("giant", "巨人の血", "power", "攻撃+6、最大HP-12。火力に全振りするハイリスク。",
                      attack=6, max_hp=-12),
    "berserk":  Relic("berserk", "狂戦士の怒り", "power", "HPが減るほど火力上昇（最大+10）。",
                      on_attack=_berserk_on_attack, flags=("lowhp",)),
    "twin":     Relic("twin", "双牙", "power", "30%で攻撃が2回ヒット。", on_attack=_double_strike_on_attack),

    # --- 状態異常型 (poison) ---
    "venom":    Relic("venom", "毒の刃", "poison", "攻撃時に毒2を付与。毒ビルドの起点。",
                      on_attack=_venom_on_attack),
    "deepwound":Relic("deepwound", "深い傷", "poison", "毒ダメージが2倍に。",
                      flags=("poison_amp",)),
    "corrosion":Relic("corrosion", "腐食", "poison", "毒に侵された敵への直接ダメージ+50%。",
                      on_attack=_corrosion_on_attack),
    "plague":   Relic("plague", "疫病", "poison", "毒で倒した敵から、周囲へ毒が伝播する。",
                      on_kill=_plague_on_kill),

    # --- 防御反射型 (thorns) ---
    "thorns":   Relic("thorns", "棘の鎧", "thorns", "受けたダメージの50%を反射。",
                      on_hit_taken=_thorns_on_hit_taken),
    "ironwall": Relic("ironwall", "鉄壁", "thorns", "防御+4、最大HP+10。", defense=4, max_hp=10),
    "spiked":   Relic("spiked", "棘の外殻", "thorns", "被弾時に固定3を反射。", on_hit_taken=_spiked_on_hit_taken),
    "retaliate":Relic("retaliate","報復の誓い","thorns","被弾するたび攻撃+1（このラン限り）。",
                      on_hit_taken=_retaliate_on_hit_taken),

    # --- 持続/横断 (sustain) ---
    "vampiric": Relic("vampiric", "吸血", "sustain", "与ダメージの30%を回復。", on_attack=_vampiric_on_attack),
    "vitality": Relic("vitality", "活力", "sustain", "最大HP+25。", max_hp=25),
    "regen":    Relic("regen", "再生", "sustain", "毎ターンHP+1。", on_turn_start=_regen_on_turn),

    # --- ユーティリティ (utility) ---
    "guard":    Relic("guard", "守りの心得", "utility", "防御+2、攻撃+1。地味だが腐らない。",
                      defense=2, attack=1),
    "focus":    Relic("focus", "集中", "utility", "攻撃+2。", attack=2),
}


# ---------------------------------------------------------------------------
# 敵（各種に「対処法」を持たせる：設計仕様書 §8）
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class EnemyType:
    id: str
    name: str
    symbol: str
    hp: int
    attack: int
    defense: int
    behavior: str       # melee / slow / erratic / ranged / support / boss
    sight: int = 8
    gold: int = 3
    tier: int = 1       # 出現フロアの目安
    note: str = ""


ENEMIES = {
    "rat":    EnemyType("rat", "ネズミ", "r", hp=5, attack=2, defense=0, behavior="melee",
                        gold=2, tier=1, note="弱い群れ。数で押す。"),
    "slime":  EnemyType("slime", "スライム", "s", hp=10, attack=3, defense=0, behavior="slow",
                        gold=3, tier=1, note="鈍重。1ターンおきに動く。距離を取れば安全。"),
    "bat":    EnemyType("bat", "コウモリ", "b", hp=6, attack=3, defense=0, behavior="erratic",
                        gold=3, tier=2, note="不規則に高速移動。読みにくいが脆い。"),
    "archer": EnemyType("archer", "射手", "a", hp=8, attack=3, defense=0, behavior="ranged",
                        sight=5, gold=4, tier=2, note="直線上を狙撃。予兆あり。遮蔽に隠れるか接近して潰す。"),
    "brute":  EnemyType("brute", "大兵", "B", hp=22, attack=7, defense=1, behavior="slow",
                        gold=6, tier=3, note="高耐久・高火力だが鈍重。釣って毒で溶かす。"),
    "healer": EnemyType("healer", "治癒師", "h", hp=12, attack=1, defense=0, behavior="support",
                        gold=5, tier=3, note="味方を回復し逃げ回る。最優先で潰す。"),
    "boss":   EnemyType("boss", "深淵の王", "D", hp=66, attack=7, defense=2, behavior="boss",
                        gold=40, tier=99, note="フロア区切りのボス。予兆付き全体攻撃を読む。"),
}


# 通常敵の出現テーブル（フロアtier別）。data側で重みを管理。
SPAWN_TABLE = {
    1: [("rat", 5), ("slime", 4), ("bat", 1)],
    2: [("rat", 3), ("slime", 3), ("bat", 4), ("archer", 2)],
    3: [("slime", 2), ("bat", 3), ("archer", 2), ("brute", 3), ("healer", 2)],
    4: [("bat", 2), ("archer", 2), ("brute", 4), ("healer", 3)],
}

ARCHETYPES = ("power", "poison", "thorns", "sustain", "utility")
