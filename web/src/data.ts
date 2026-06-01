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
  // 武器もレリックと同じ hooks 機構で効果を持てる（data.json の weapons[].hooks）。
  onAttack?: OnAttack;
  onHitTaken?: OnHitTaken;
  onTurnStart?: OnTurnStart;
  onKill?: OnKill;
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
  params: Record<string, number>;
  note: string;
  // 撃破報酬（任意・data駆動）。倒した時に gold/heal/relic を付与。ボスや将来の道中ボスに。
  reward?: { gold?: number; heal?: number; relic?: string } | null;
}

// --- 効果レジストリ（data.py の EFFECTS と完全一致）。int() は Math.trunc。 ---
type EffectFactory = (p: any, key?: string) => (...args: any[]) => void;

// 各効果は発動時にログ(g.msg)を出す＝プレイヤーに「効果が働いた」ことを見せる（§9 透明性）。
// ログは trace/result に含まれないため golden は不変（挙動・RNG順・バランスは変わらない）。
// 例外: 再生(healFlat)は毎ターン発動でログが洪水になるため出さない（HPバーで十分見える）。
const EFFECTS: Record<string, EffectFactory> = {
  applyPoison: (p) => (g, _o, target, ctx: Ctx) => {
    if (ctx.amount > 0) {
      target.addPoison(p.amount);
      g.msg(`毒の刃：${target.name}に毒+${p.amount}`);
    }
  },
  bonusDmgVsPoisoned: (p) => (g, _o, target, ctx: Ctx) => {
    if (target.poison > 0) {
      ctx.amount = Math.trunc(ctx.amount * p.ratio);
      g.msg("腐食：毒の敵へダメージ増");
    }
  },
  berserkScale: (p) => (g, owner, _t, ctx: Ctx) => {
    const missing = 1.0 - owner.hp / Math.max(1, owner.maxHp);
    const bonus = Math.trunc(missing * p.max);
    ctx.amount += bonus;
    if (bonus > 0) g.msg(`狂戦士の怒り：火力+${bonus}`);
  },
  extraAttack: (p) => (g, _o, _t, ctx: Ctx) => {
    if (g.rng.combat.random() < p.chance) {
      ctx.extraHits += 1;
      g.msg("双牙：追撃！");
    }
  },
  lifeSteal: (p) => (g, owner, _t, ctx: Ctx) => {
    const healed = Math.max(1, Math.trunc(ctx.amount * p.ratio));
    owner.heal(healed);
    g.msg(`吸血：+${healed}回復`);
  },
  reflectRatio: (p) => (g, owner, attacker, ctx: Ctx) => {
    if (attacker != null && ctx.amount > 0) {
      const refl = Math.max(1, Math.trunc(ctx.amount * p.ratio));
      g.dealReflect(owner, attacker, refl);
      g.msg(`棘の鎧：${refl}反射`);
    }
  },
  reflectFlat: (p) => (g, owner, attacker, _ctx: Ctx) => {
    if (attacker != null) {
      g.dealReflect(owner, attacker, p.amount);
      g.msg(`棘の外殻：${p.amount}反射`);
    }
  },
  atkBuff: (p, key) => (g, owner) => {
    // cap: ラン累計の上限（data.json で調整できるバランスノブ）。未指定なら無制限＝従来挙動。
    if (p.cap != null) {
      const k = key ?? "atkBuff";
      const added = owner.effectState[k] ?? 0;
      if (added >= p.cap) return;                       // 上限到達後は発動しない
      const inc = Math.min(p.amount, p.cap - added);
      owner.attack += inc;
      owner.effectState[k] = added + inc;
      g.msg(`報復の誓い：攻撃+${inc}（累計+${added + inc}/${p.cap}）`);
    } else {
      owner.attack += p.amount;
      g.msg(`報復の誓い：攻撃+${p.amount}`);
    }
  },
  healFlat: (p) => (g, owner) => {
    // combatOnly: フロアに生存敵がいるターンのみ回復（戦闘外でのうろつき全回復を封じる）。
    // 毎ターン発動のためログは出さない（HPバーで可視）。
    if (p.combatOnly && !g.enemies.some((e: { alive: boolean }) => e.alive)) return;
    owner.heal(p.amount);
  },
  spreadPoison: (p) => (g, _o, victim) => {
    if (victim.poison > 0) {
      const near = g.enemiesNear(victim.x, victim.y, p.radius);
      for (const e of near) e.addPoison(p.amount);
      if (near.length > 0) g.msg(`疫病：周囲${near.length}体へ毒+${p.amount}`);
    }
  },
};

const TRIGGER_SLOT: Record<string, keyof Relic> = {
  onAttack: "onAttack",
  onHitTaken: "onHitTaken",
  onTurnStart: "onTurnStart",
  onKill: "onKill",
};

/**
 * data.json の hooks[{trigger,effect,params}] を EFFECTS で束ね、target のスロットへ割当てる。
 * レリックと武器で共有（拡張容易化）。keyBase は cap等の累計効果が owner.effectState に使うキー
 * （レリックは id、武器は "weapon:<id>"。同一キャリアに同種の累計効果を複数積む場合のみ衝突注意）。
 */
function bindHooks(target: any, hooks: any[] | undefined, keyBase: string): void {
  for (const h of hooks ?? []) {
    const slot = TRIGGER_SLOT[h.trigger];
    if (!slot) continue;
    target[slot] = EFFECTS[h.effect](h.params ?? {}, keyBase);
  }
}

// --- data.json → 索引の構築 ------------------------------------------------
function buildWeapon(w: any): Weapon {
  const weapon: Weapon = {
    id: w.id, name: w.name, attack: w.atk,
    defenseMod: w.defMod ?? 0, bonusPoison: w.bonusPoison ?? 0, note: w.note ?? "",
  };
  bindHooks(weapon, w.hooks, "weapon:" + w.id);
  return weapon;
}

function buildRelic(r: any): Relic {
  const sm = r.statMods ?? {};
  const relic: Relic = {
    id: r.id, name: r.name, archetype: r.archetype, desc: r.desc ?? "",
    attack: sm.atk ?? 0, defense: sm.def ?? 0, maxHp: sm.maxHp ?? 0,
    flags: [...(r.flags ?? [])],
  };
  bindHooks(relic, r.hooks, r.id);
  return relic;
}

function buildEnemy(e: any): EnemyType {
  return {
    id: e.id, name: e.name, symbol: e.symbol, hp: e.hp, attack: e.atk, defense: e.defense,
    behavior: e.behavior, sight: e.sight ?? 8, gold: e.gold ?? 3, tier: e.tier ?? 1,
    telegraph: e.telegraph ?? false, spawnCap: e.spawnCap ?? null,
    params: e.params ?? {}, note: e.note ?? "", reward: e.reward ?? null,
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
  Object.entries(raw.spawnTable as unknown as Record<string, [string, number][]>).map(
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
// 初期装備（初期HP/攻撃・開始武器プール・開始レリック）を data.json に一元化（数値変更が容易）。
export const START = (raw as any).start as {
  hp: number; atk: number; weaponPool: string[]; relics: string[];
};
// PLAYER は START から導出（後方互換のため名前を維持）。
export const PLAYER = { hp: START.hp, atk: START.atk };
export const TUNING = (raw as any).tuning as {
  poisonAmp: number;
  poisonDecay: number;
  rewardChoices: number;
};
export const SYNERGY_COMBOS = ((raw as any).synergyCombos ?? []) as Array<{
  name: string;
  archetype: string;
  relics: string[];
}>;
