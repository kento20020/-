/**
 * データ駆動定義のローダ（roguelike/data.py の TS 版）。
 * 数値真値は ../../roguelike/data.json（Python と共有する唯一の真値：§20）。
 * 効果レジストリ（EFFECTS）は data.py と同一の実装ID・定数解釈を持つ。
 */
import raw from "../data.json" with { type: "json" };

// --- フック（効果）が触る最小インターフェース（duck typing） -------------
export interface Ctx {
  amount: number;
  attacker: unknown;
  target: unknown;
  source: string;
  extraHits: number;
}
// engine 側の Entity / Game。型は緩く扱う（Python の duck typing に対応）。
type Ent = any;
type G = any;

export type OnAttack = (g: G, owner: Ent, target: Ent, ctx: Ctx) => void;
export type OnHitTaken = (g: G, owner: Ent, attacker: Ent, ctx: Ctx) => void;
export type OnTurnStart = (g: G, owner: Ent) => void;
export type OnKill = (g: G, owner: Ent, victim: Ent) => void;

export interface Weapon {
  id: string;
  name: string;
  attack: number;
  defenseMod: number;
  bonusPoison: number;
  note: string;
}

export interface Relic {
  id: string;
  name: string;
  archetype: string;
  desc: string;
  attack: number;
  defense: number;
  maxHp: number;
  flags: string[];
  onAttack?: OnAttack;
  onHitTaken?: OnHitTaken;
  onTurnStart?: OnTurnStart;
  onKill?: OnKill;
}

export interface EnemyType {
  id: string;
  name: string;
  symbol: string;
  hp: number;
  attack: number;
  defense: number;
  behavior: string;
  sight: number;
  gold: number;
  tier: number;
  telegraph: boolean;
  spawnCap: number | null;
  note: string;
}

// --- 効果レジストリ（data.py の EFFECTS と完全一致）。int() は Math.trunc。 ---
type EffectFactory = (p: any) => (...args: any[]) => void;

const EFFECTS: Record<string, EffectFactory> = {
  applyPoison: (p) => (_g, _o, target, ctx: Ctx) => {
    if (ctx.amount > 0) target.addPoison(p.amount);
  },
  bonusDmgVsPoisoned: (p) => (_g, _o, target, ctx: Ctx) => {
    if (target.poison > 0) ctx.amount = Math.trunc(ctx.amount * p.ratio);
  },
  berserkScale: (p) => (_g, owner, _t, ctx: Ctx) => {
    const missing = 1.0 - owner.hp / Math.max(1, owner.maxHp);
    ctx.amount += Math.trunc(missing * p.max);
  },
  extraAttack: (p) => (g, _o, _t, ctx: Ctx) => {
    if (g.rng.combat.random() < p.chance) ctx.extraHits += 1;
  },
  lifeSteal: (p) => (_g, owner, _t, ctx: Ctx) => {
    owner.heal(Math.max(1, Math.trunc(ctx.amount * p.ratio)));
  },
  reflectRatio: (p) => (g, owner, attacker, ctx: Ctx) => {
    if (attacker != null && ctx.amount > 0) {
      g.dealReflect(owner, attacker, Math.max(1, Math.trunc(ctx.amount * p.ratio)));
    }
  },
  reflectFlat: (p) => (g, owner, attacker, _ctx: Ctx) => {
    if (attacker != null) g.dealReflect(owner, attacker, p.amount);
  },
  atkBuff: (p) => (_g, owner) => {
    owner.attack += p.amount;
  },
  healFlat: (p) => (_g, owner) => {
    owner.heal(p.amount);
  },
  spreadPoison: (p) => (g, _o, victim) => {
    if (victim.poison > 0) {
      for (const e of g.enemiesNear(victim.x, victim.y, p.radius)) e.addPoison(p.amount);
    }
  },
};

const TRIGGER_SLOT: Record<string, keyof Relic> = {
  onAttack: "onAttack",
  onHitTaken: "onHitTaken",
  onTurnStart: "onTurnStart",
  onKill: "onKill",
};

// --- data.json → 索引の構築 ------------------------------------------------
function buildWeapon(w: any): Weapon {
  return {
    id: w.id, name: w.name, attack: w.atk,
    defenseMod: w.defMod ?? 0, bonusPoison: w.bonusPoison ?? 0, note: w.note ?? "",
  };
}

function buildRelic(r: any): Relic {
  const sm = r.statMods ?? {};
  const relic: Relic = {
    id: r.id, name: r.name, archetype: r.archetype, desc: r.desc ?? "",
    attack: sm.atk ?? 0, defense: sm.def ?? 0, maxHp: sm.maxHp ?? 0,
    flags: [...(r.flags ?? [])],
  };
  for (const h of r.hooks ?? []) {
    const slot = TRIGGER_SLOT[h.trigger];
    const fn = EFFECTS[h.effect](h.params ?? {});
    (relic as any)[slot] = fn;
  }
  return relic;
}

function buildEnemy(e: any): EnemyType {
  return {
    id: e.id, name: e.name, symbol: e.symbol, hp: e.hp, attack: e.atk, defense: e.defense,
    behavior: e.behavior, sight: e.sight ?? 8, gold: e.gold ?? 3, tier: e.tier ?? 1,
    telegraph: e.telegraph ?? false, spawnCap: e.spawnCap ?? null, note: e.note ?? "",
  };
}

// 挿入順を保持（Python dict と同じ反復順＝報酬プール順に効く）。
export const WEAPONS = new Map<string, Weapon>(
  (raw.weapons as any[]).map((w) => [w.id, buildWeapon(w)]),
);
export const RELICS = new Map<string, Relic>(
  (raw.relics as any[]).map((r) => [r.id, buildRelic(r)]),
);
export const ENEMIES = new Map<string, EnemyType>(
  (raw.enemies as any[]).map((e) => [e.id, buildEnemy(e)]),
);
export const SPAWN_TABLE: Record<number, Array<[string, number]>> = Object.fromEntries(
  Object.entries(raw.spawnTable as Record<string, [string, number][]>).map(
    ([k, v]) => [Number(k), v.map((pair) => [pair[0], pair[1]] as [string, number])],
  ),
);
export const ARCHETYPES: string[] = [...(raw.archetypes as string[])];
export const RUN = raw.run as {
  floors: number;
  bossFloor: number;
  floorClearHeal: number;
  restHeal: number;
  restChance: number;
  bossPool: string[];
};
export const PLAYER = raw.player as { hp: number; atk: number };
export const SYNERGY_COMBOS = ((raw as any).synergyCombos ?? []) as Array<{
  name: string;
  archetype: string;
  relics: string[];
}>;
