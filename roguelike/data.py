"""データ駆動設計（設計仕様書 §11 / Web版 §20）。

敵・武器・レリックの **数値真値は roguelike/data.json**（Python / TypeScript 両エンジンの
唯一の真値）に置く。このモジュールは data.json を読み込み、エンジンが解釈する
dataclass（Weapon / Relic / EnemyType）と索引（WEAPONS / RELICS / ENEMIES /
SPAWN_TABLE / ARCHETYPES）へ再構築するだけ。

レリックの効果はイベントフック（on_attack 等）で表現する。フックの実装は
EFFECTS レジストリにあり、data.json の `hooks[].effect`（実装ID）と `params`
（定数）から束ねて生成する。フックは engine の DamageContext / Entity を duck
typing で触る。これにより「攻撃時に毒付与」×「毒の敵に追加ダメージ」のような
シナジー（1+1=3）がデータ側の組み合わせだけで生まれる。

バランス調整は data.json を編集し、必ず Python sim で再検証する（Web版 §18）。
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

# --- 真値ソース（両エンジン共通） ------------------------------------------
DATA_PATH = Path(__file__).parent / "data.json"
_RAW = json.loads(DATA_PATH.read_text(encoding="utf-8"))


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


# ---------------------------------------------------------------------------
# 効果レジストリ（hooks[].effect → 実装）
#   各ファクトリは params を受け取り、engine が呼ぶフック関数を返す。
#   ここでの数値は data.json の params が唯一の出所（直書きしない）。
# ---------------------------------------------------------------------------
def _eff_applyPoison(p):
    amount = p["amount"]
    def f(game, owner, target, ctx):
        if ctx.amount > 0:
            target.add_poison(amount)
    return f


def _eff_bonusDmgVsPoisoned(p):
    ratio = p["ratio"]
    def f(game, owner, target, ctx):
        if target.poison > 0:
            ctx.amount = int(ctx.amount * ratio)
    return f


def _eff_berserkScale(p):
    mx = p["max"]
    def f(game, owner, target, ctx):
        missing = 1.0 - owner.hp / max(1, owner.max_hp)
        ctx.amount += int(missing * mx)
    return f


def _eff_extraAttack(p):
    chance = p["chance"]
    def f(game, owner, target, ctx):
        if game.rng.combat.random() < chance:
            ctx.extra_hits += 1
    return f


def _eff_lifeSteal(p):
    ratio = p["ratio"]
    def f(game, owner, target, ctx):
        owner.heal(max(1, int(ctx.amount * ratio)))
    return f


def _eff_reflectRatio(p):
    ratio = p["ratio"]
    def f(game, owner, attacker, ctx):
        if attacker is not None and ctx.amount > 0:
            game.deal_reflect(owner, attacker, max(1, int(ctx.amount * ratio)))
    return f


def _eff_reflectFlat(p):
    amount = p["amount"]
    def f(game, owner, attacker, ctx):
        if attacker is not None:
            game.deal_reflect(owner, attacker, amount)
    return f


def _eff_atkBuff(p):
    amount = p["amount"]
    def f(game, owner, attacker, ctx):
        owner.attack += amount
    return f


def _eff_healFlat(p):
    amount = p["amount"]
    def f(game, owner):
        owner.heal(amount)
    return f


def _eff_spreadPoison(p):
    amount, radius = p["amount"], p["radius"]
    def f(game, owner, victim):
        if victim.poison > 0:
            for e in game.enemies_near(victim.x, victim.y, radius=radius):
                e.add_poison(amount)
    return f


EFFECTS = {
    "applyPoison": _eff_applyPoison,
    "bonusDmgVsPoisoned": _eff_bonusDmgVsPoisoned,
    "berserkScale": _eff_berserkScale,
    "extraAttack": _eff_extraAttack,
    "lifeSteal": _eff_lifeSteal,
    "reflectRatio": _eff_reflectRatio,
    "reflectFlat": _eff_reflectFlat,
    "atkBuff": _eff_atkBuff,
    "healFlat": _eff_healFlat,
    "spreadPoison": _eff_spreadPoison,
}

# hooks[].trigger → Relic のフックスロット名
_TRIGGER_SLOT = {
    "onAttack": "on_attack",
    "onHitTaken": "on_hit_taken",
    "onTurnStart": "on_turn_start",
    "onKill": "on_kill",
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
    telegraph: bool = False
    spawn_cap: Optional[int] = None   # 1フロアの出現上限（None=無制限）
    note: str = ""


# ---------------------------------------------------------------------------
# data.json → 索引の構築
# ---------------------------------------------------------------------------
def _build_weapons(raw):
    out = {}
    for w in raw:
        out[w["id"]] = Weapon(
            id=w["id"], name=w["name"], attack=w["atk"],
            defense_mod=w.get("defMod", 0), bonus_poison=w.get("bonusPoison", 0),
            note=w.get("note", ""),
        )
    return out


def _build_relic(r):
    sm = r.get("statMods") or {}
    relic = Relic(
        id=r["id"], name=r["name"], archetype=r["archetype"], desc=r.get("desc", ""),
        attack=sm.get("atk", 0), defense=sm.get("def", 0), max_hp=sm.get("maxHp", 0),
        flags=tuple(r.get("flags", [])),
    )
    for h in r.get("hooks", []):
        slot = _TRIGGER_SLOT[h["trigger"]]
        fn = EFFECTS[h["effect"]](h.get("params", {}))
        setattr(relic, slot, fn)
    return relic


def _build_relics(raw):
    return {r["id"]: _build_relic(r) for r in raw}


def _build_enemies(raw):
    out = {}
    for e in raw:
        out[e["id"]] = EnemyType(
            id=e["id"], name=e["name"], symbol=e["symbol"],
            hp=e["hp"], attack=e["atk"], defense=e["defense"],
            behavior=e["behavior"], sight=e.get("sight", 8), gold=e.get("gold", 3),
            tier=e.get("tier", 1), telegraph=e.get("telegraph", False),
            spawn_cap=e.get("spawnCap"), note=e.get("note", ""),
        )
    return out


def _build_spawn_table(raw):
    # JSONのキーは文字列。intキー・(id, weight) タプルへ正規化。
    return {int(k): [tuple(pair) for pair in v] for k, v in raw.items()}


WEAPONS = _build_weapons(_RAW["weapons"])
RELICS = _build_relics(_RAW["relics"])
ENEMIES = _build_enemies(_RAW["enemies"])
SPAWN_TABLE = _build_spawn_table(_RAW["spawnTable"])
ARCHETYPES = tuple(_RAW["archetypes"])

# ラン/プレイヤーの定数（engine が参照）。
RUN = _RAW["run"]
PLAYER = _RAW["player"]

# 名前付きシナジーコンボ（KPI のコンボ別クリア率計測用：simulate.py）。
SYNERGY_COMBOS = _RAW.get("synergyCombos", [])
