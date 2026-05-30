/**
 * ゲームエンジン本体（roguelike/engine.py の TS 版・忠実移植）。
 * ロジック・定数・RNG 消費順を Python と厳密一致させる（等価性：§24）。
 */
import { GameRNG } from "./rng.ts";
import * as world from "./world.ts";
import {
  WEAPONS, RELICS, ENEMIES, SPAWN_TABLE, ARCHETYPES, RUN, PLAYER, TUNING,
  type Weapon, type Relic, type EnemyType,
} from "./data.ts";
import { BEHAVIORS } from "./behaviors.ts";

export interface DamageContext {
  amount: number;
  attacker: Entity | null;
  target: Entity | null;
  source: string;
  extraHits: number;
}
function mkCtx(amount: number, attacker: Entity | null, target: Entity | null, source: string): DamageContext {
  return { amount, attacker, target, source, extraHits: 0 };
}

export class Entity {
  poison = 0;
  alive = true;
  isPlayer = false;
  constructor(
    public name: string, public symbol: string, public x: number, public y: number,
    public maxHp: number, public hp: number, public attack: number, public defense: number,
  ) {}
  heal(amount: number): void {
    if (this.alive) this.hp = Math.min(this.maxHp, this.hp + amount);
  }
  addPoison(stacks: number): void {
    this.poison += stacks;
  }
}

export class Player extends Entity {
  relics: Relic[] = [];
  gold = 0;
  lastHitBy: Entity | null = null;
  lastSource: string | null = null;
  constructor(x: number, y: number, public weapon: Weapon) {
    super("勇者", "@", x, y, PLAYER.hp, PLAYER.hp, PLAYER.atk, 0);
    this.isPlayer = true;
  }
  addRelic(relic: Relic): void {
    this.relics.push(relic);
    this.attack += relic.attack;
    this.defense += relic.defense;
    if (relic.maxHp) {
      this.maxHp += relic.maxHp;
      if (relic.maxHp > 0) this.hp += relic.maxHp;
      this.hp = Math.max(1, Math.min(this.hp, this.maxHp));
    }
  }
  hasFlag(flag: string): boolean {
    return this.relics.some((r) => r.flags.includes(flag));
  }
  get power(): number {
    return this.attack + this.weapon.attack;
  }
}

export class Enemy extends Entity {
  etype: EnemyType;
  behavior: string;
  cooldown = 0;
  telegraph: string | null = null;
  constructor(etype: EnemyType, x: number, y: number) {
    super(etype.name, etype.symbol, x, y, etype.hp, etype.hp, etype.attack, etype.defense);
    this.etype = etype;
    this.behavior = etype.behavior;
  }
}

type Action = ["move", number, number] | ["wait"];

const DIRS4: ReadonlyArray<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// スポーン上限（data.json の spawnCap 由来。engine._build_floor の caps と同一）。
const SPAWN_CAPS: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  for (const [id, et] of ENEMIES) if (et.spawnCap != null) out[id] = et.spawnCap;
  return out;
})();

export class Game {
  rng: GameRNG;
  seed: number;
  numFloors: number;
  floorNum = 0;
  turn = 0;
  kills = 0;
  log: string[] = [];
  player: Player;
  enemies: Enemy[] = [];
  level!: world.Level;
  state = "playing";
  offered: string[] = [];
  relicsOfferedTotal: string[] = [];
  relicsTaken: string[] = [];

  constructor(seed: number, weaponId = "sword", numFloors: number | null = null, startingRelics: string[] = []) {
    this.rng = new GameRNG(seed);
    this.seed = seed;
    this.numFloors = numFloors ?? RUN.floors;
    this.player = new Player(0, 0, WEAPONS.get(weaponId)!);
    for (const rid of startingRelics) this.player.addRelic(RELICS.get(rid)!);
    this.buildFloor();
  }

  msg(text: string): void {
    this.log.push(text);
    if (this.log.length > 200) this.log = this.log.slice(-200);
  }

  // ----- フロア構築 -----
  private buildFloor(): void {
    this.floorNum += 1;
    const isBoss = this.floorNum >= this.numFloors;
    this.level = world.generate(this.rng.map, this.floorNum);
    [this.player.x, this.player.y] = this.level.start;
    this.enemies = [];
    const [sx, sy] = this.level.start;
    const [exx, exy] = this.level.exit;
    const cells = this.level.floorCells().filter(
      ([x, y]) => !(x === sx && y === sy) && !(x === exx && y === exy),
    );
    this.rng.spawn.shuffle(cells);
    const farCells = () =>
      cells.filter(([x, y]) => Math.abs(x - sx) + Math.abs(y - sy) > 6);
    const fc = farCells();
    const spots = fc.length > 0 ? fc : cells;

    if (isBoss) {
      const bossId = this.rng.spawn.choice(RUN.bossPool);
      const boss = ENEMIES.get(bossId)!;
      this.enemies.push(new Enemy(boss, exx, exy));
      for (const [cx, cy] of spots.slice(0, 2)) {
        this.enemies.push(new Enemy(ENEMIES.get("rat")!, cx, cy));
      }
      this.msg(`最深部。${boss.name}が待ち構えている。`);
    } else {
      const n = 4 + this.floorNum;
      const tier = Math.min(4, this.floorNum);
      const table = SPAWN_TABLE[tier];
      const ids = table.map((t) => t[0]);
      const weights = table.map((t) => t[1]);
      const counts = new Map<string, number>();
      for (const [cx, cy] of spots.slice(0, n)) {
        let eid = "";
        for (let t = 0; t < 6; t++) {
          eid = this.rng.spawn.choices(ids, weights)[0];
          if ((counts.get(eid) ?? 0) < (SPAWN_CAPS[eid] ?? 99)) break;
        }
        counts.set(eid, (counts.get(eid) ?? 0) + 1);
        this.enemies.push(new Enemy(ENEMIES.get(eid)!, cx, cy));
      }
      this.msg(`フロア${this.floorNum}：敵 ${this.enemies.length} 体。出口 '>' を目指せ。`);
    }
  }

  // ----- 補助 -----
  enemyAt(x: number, y: number): Enemy | null {
    for (const e of this.enemies) if (e.alive && e.x === x && e.y === y) return e;
    return null;
  }
  occupied(x: number, y: number): boolean {
    return (x === this.player.x && y === this.player.y) || this.enemyAt(x, y) !== null;
  }
  enemiesNear(x: number, y: number, radius: number): Enemy[] {
    return this.enemies.filter(
      (e) => e.alive && Math.max(Math.abs(e.x - x), Math.abs(e.y - y)) <= radius
        && !(e.x === x && e.y === y),
    );
  }

  // ----- 戦闘コア -----
  dealReflect(owner: Entity, target: Entity, amount: number): void {
    if (target.alive && amount > 0) this.applyDamage(target, amount, owner, "reflect");
  }

  private applyDamage(target: Entity, amount: number, attacker: Entity | null, source: string): void {
    if (amount <= 0 || !target.alive) return;
    target.hp -= amount;
    if (target.isPlayer) {
      (target as Player).lastHitBy = attacker;
      (target as Player).lastSource = source;
    }
    if (source === "attack" && target === this.player) {
      for (const r of this.player.relics) {
        if (r.onHitTaken) r.onHitTaken(this, this.player, attacker, mkCtx(amount, attacker, target, source));
      }
    }
    if (target.hp <= 0) this.kill(target, attacker);
  }

  private kill(target: Entity, killer: Entity | null): void {
    target.alive = false;
    if (target === this.player) {
      this.state = "dead";
      return;
    }
    const enemy = target as Enemy;
    this.kills += 1;
    this.player.gold += enemy.etype.gold;
    if (killer === this.player) {
      for (const r of this.player.relics) {
        if (r.onKill) r.onKill(this, this.player, enemy);
      }
    }
    if (enemy.etype.behavior.startsWith("boss")) {
      this.state = "win";
      this.msg(`${enemy.name}を討ち取った！ 生還だ。`);
    }
  }

  playerAttack(enemy: Enemy): void {
    const p = this.player;
    let hits = 1, total = 0, guard = 0;
    while (hits > 0 && enemy.alive && guard < 6) {
      guard += 1;
      hits -= 1;
      const ctx = mkCtx(p.power, p, enemy, "attack");
      for (const r of p.relics) if (r.onAttack) r.onAttack(this, p, enemy, ctx);
      const dmg = Math.max(1, ctx.amount - enemy.defense);
      total += dmg;
      this.applyDamage(enemy, dmg, p, "attack");
      if (p.weapon.bonusPoison && enemy.alive) enemy.addPoison(p.weapon.bonusPoison);
      hits += ctx.extraHits;
    }
    this.msg(`${enemy.name}に${total}ダメージ` + (!enemy.alive ? "（撃破）" : `（残${Math.max(0, enemy.hp)}）`));
  }

  // ----- 状態異常 -----
  private tickPoison(): void {
    const amp = this.player.hasFlag("poison_amp") ? TUNING.poisonAmp : 1;
    for (const e of [...this.enemies]) {
      if (e.alive && e.poison > 0) {
        this.applyDamage(e, e.poison * amp, this.player, "poison");
        e.poison -= TUNING.poisonDecay;
      }
    }
    if (this.player.poison > 0) {
      this.applyDamage(this.player, this.player.poison, null, "poison");
      this.player.poison -= TUNING.poisonDecay;
    }
  }

  // ----- 敵AI -----
  stepToward(e: Enemy, tx: number, ty: number, away = false): void {
    let best: [number, number] | null = null;
    let bestd: number | null = null;
    for (const [dx, dy] of DIRS4) {
      const nx = e.x + dx, ny = e.y + dy;
      if (!this.level.isFloor(nx, ny) || this.occupied(nx, ny)) continue;
      const d = Math.abs(nx - tx) + Math.abs(ny - ty);
      if (bestd === null || (away ? d > bestd : d < bestd)) {
        bestd = d;
        best = [nx, ny];
      }
    }
    if (best) {
      e.x = best[0];
      e.y = best[1];
    }
  }

  adjacentToPlayer(e: Enemy): boolean {
    return Math.abs(e.x - this.player.x) + Math.abs(e.y - this.player.y) === 1;
  }

  enemyAttackPlayer(e: Enemy, mult = 1.0, source = "attack"): void {
    const dmg = Math.max(1, Math.trunc(e.attack * mult) - this.player.defense);
    this.msg(`${e.name}の攻撃！ ${dmg}ダメージ`);
    this.applyDamage(this.player, dmg, e, source);
  }

  lineClear(x0: number, y0: number, x1: number, y1: number): boolean {
    if (x0 === x1) {
      const step = y1 > y0 ? 1 : -1;
      for (let y = y0 + step; y !== y1; y += step) if (!this.level.isFloor(x0, y)) return false;
      return true;
    }
    if (y0 === y1) {
      const step = x1 > x0 ? 1 : -1;
      for (let x = x0 + step; x !== x1; x += step) if (!this.level.isFloor(x, y0)) return false;
      return true;
    }
    return false;
  }

  private actEnemy(e: Enemy): void {
    // 敵AIは behaviors.ts のレジストリへ委譲（EFFECTS と同じ拡張パターン）。
    // 新しい敵AIは BEHAVIORS に1個足すだけ＝ここは無編集。
    BEHAVIORS[e.behavior]?.(this, e);
  }

  freeNear(x: number, y: number): [number, number] | null {
    const dirs: ReadonlyArray<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]];
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (this.level.isFloor(nx, ny) && !this.occupied(nx, ny)) return [nx, ny];
    }
    return null;
  }

  // ----- 1ターン進行 -----
  /** behaviors（ボス増援など）から使う公開ヘルパ：指定IDの敵を座標に追加。 */
  spawnAt(id: string, x: number, y: number): void {
    this.enemies.push(new Enemy(ENEMIES.get(id)!, x, y));
  }

  private worldTick(): void {
    this.tickPoison();
    if (this.state !== "playing") return;
    for (const r of this.player.relics) if (r.onTurnStart) r.onTurnStart(this, this.player);
    for (const e of [...this.enemies]) {
      if (e.alive && this.state === "playing") this.actEnemy(e);
    }
    this.enemies = this.enemies.filter((e) => e.alive);
    this.turn += 1;
  }

  // ----- プレイヤー行動 -----
  playerAct(action: Action): string {
    if (this.state !== "playing") return "noop";
    let result = "move";
    if (action[0] === "move") {
      const dx = action[1], dy = action[2];
      const nx = this.player.x + dx, ny = this.player.y + dy;
      const target = this.enemyAt(nx, ny);
      if (target) {
        this.playerAttack(target);
        result = "attack";
      } else if (this.level.isFloor(nx, ny)) {
        this.player.x = nx;
        this.player.y = ny;
        if (nx === this.level.exit[0] && ny === this.level.exit[1] && !this.isBossFloor()) {
          this.worldTick();
          if (this.state === "playing") {
            this.state = "reward";
            this.offered = this.rollRewards();
          }
          return "exit";
        }
      } else {
        result = "blocked";
        return result;
      }
    }
    this.worldTick();
    return result;
  }

  isBossFloor(): boolean {
    return this.floorNum >= this.numFloors;
  }

  // ----- UI 補助（副作用なし・RNG不変・ゴールデンに影響しない） -----
  /** 予兆（射手の射線・ボスのスラム範囲）のセル集合 "x,y"。UIハイライト用（bot.danger と同一ロジック）。 */
  dangerCells(): Set<string> {
    const out = new Set<string>();
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.behavior === "ranged" && e.telegraph) {
        for (const [dx, dy] of DIRS4) {
          let x = e.x, y = e.y;
          for (let i = 0; i < e.etype.sight; i++) {
            x += dx;
            y += dy;
            if (!this.level.isFloor(x, y)) break;
            out.add(`${x},${y}`);
          }
        }
      }
      if (e.behavior === "boss" && e.telegraph) {
        for (let dx = -3; dx <= 3; dx++) {
          for (let dy = -3; dy <= 3; dy++) out.add(`${e.x + dx},${e.y + dy}`);
        }
      }
    }
    return out;
  }

  /** 隣接攻撃の概算（与/被ダメ）。レリック発動・ボススラム倍率は含まない概算（UI表示用）。 */
  previewDamage(enemy: Enemy): { dealt: number; taken: number } {
    return {
      dealt: Math.max(1, this.player.power - enemy.defense),
      taken: Math.max(1, enemy.attack - this.player.defense),
    };
  }

  // ----- 報酬 -----
  private rollRewards(): string[] {
    const owned = new Set(this.player.relics.map((r) => r.id));
    const pool = [...RELICS.keys()].filter((rid) => !owned.has(rid));
    this.rng.loot.shuffle(pool);
    const choices = pool.length >= TUNING.rewardChoices ? pool.slice(0, TUNING.rewardChoices) : pool;
    this.relicsOfferedTotal.push(...choices);
    return choices;
  }

  takeReward(index: number): void {
    if (this.state !== "reward") return;
    if (index >= 0 && index < this.offered.length) {
      const rid = this.offered[index];
      this.player.addRelic(RELICS.get(rid)!);
      this.relicsTaken.push(rid);
      this.msg(`レリック獲得：${RELICS.get(rid)!.name}`);
    }
    // 踏破回復は2段階：たまに「休憩」で大回復、通常は小回復（rng.loot で決定）。
    if (this.rng.loot.random() < RUN.restChance) {
      this.player.heal(Math.trunc(this.player.maxHp * RUN.restHeal));
      this.msg("休憩した。大きく回復した。");
    } else {
      this.player.heal(Math.trunc(this.player.maxHp * RUN.floorClearHeal));
    }
    this.offered = [];
    this.state = "playing";
    this.buildFloor();
  }

  // ----- 結果（KPI） -----
  result(): Record<string, unknown> {
    const relics = this.player.relics;
    const counts: Record<string, number> = {};
    for (const a of ARCHETYPES) counts[a] = 0;
    for (const r of relics) counts[r.archetype] += 1;
    let dominant = "none";
    if (relics.length > 0) {
      let bestVal = -1;
      for (const a of ARCHETYPES) {
        if (counts[a] > bestVal) {
          bestVal = counts[a];
          dominant = a;
        }
      }
      if (counts[dominant] === 0) dominant = "none";
    }
    let cause: string | null;
    if (this.state === "dead") {
      const lb = this.player.lastHitBy;
      if (this.player.lastSource === "poison") cause = "poison(self)";
      else if (lb != null) cause = (lb as Enemy).etype.id;
      else cause = "unknown";
    } else {
      cause = null;
    }
    return {
      seed: this.seed,
      result: this.state,
      floors_reached: this.floorNum,
      turns: this.turn,
      kills: this.kills,
      gold: this.player.gold,
      weapon: this.player.weapon.id,
      death_cause: cause,
      build: dominant,
      relics_taken: [...this.relicsTaken],
      relics_offered: [...this.relicsOfferedTotal],
      hp: Math.max(0, this.player.hp),
    };
  }
}
