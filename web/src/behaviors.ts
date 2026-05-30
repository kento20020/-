/**
 * 敵AIのレジストリ（レリックの EFFECTS と同じ拡張パターン）。
 * behavior 文字列 → 関数。**新しい敵AIは BEHAVIORS に1個足すだけ**（engine.ts は無編集）。
 * 数値は `e.etype.params` から読む（既定値＝現行値なので挙動は完全保存）。
 *
 * engine からは型のみ import（実行時の循環依存なし）。Game の公開ヘルパ
 * （stepToward / adjacentToPlayer / enemyAttackPlayer / lineClear / enemiesNear /
 *  freeNear / occupied / spawnAt / msg と rng/player/level/state/enemies）を使う。
 */
import type { Game, Enemy } from "./engine.ts";

const DIRS4: ReadonlyArray<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export type BehaviorFn = (g: Game, e: Enemy) => void;

export const BEHAVIORS: Record<string, BehaviorFn> = {
  melee(g, e) {
    const p = g.player;
    if (g.adjacentToPlayer(e)) g.enemyAttackPlayer(e);
    else g.stepToward(e, p.x, p.y);
  },

  slow(g, e) {
    const p = g.player;
    e.cooldown = (e.cooldown + 1) % 2;
    if (e.cooldown === 0) return;
    if (g.adjacentToPlayer(e)) g.enemyAttackPlayer(e);
    else g.stepToward(e, p.x, p.y);
  },

  erratic(g, e) {
    const p = g.player;
    const approach = e.etype.params.approachChance ?? 0.6;
    const steps = e.etype.params.steps ?? 2;
    for (let i = 0; i < steps; i++) {
      if (g.adjacentToPlayer(e)) {
        g.enemyAttackPlayer(e);
        return;
      }
      if (g.rng.ai.random() < approach) {
        g.stepToward(e, p.x, p.y);
      } else {
        const [dx, dy] = g.rng.ai.choice(DIRS4);
        if (g.level.isFloor(e.x + dx, e.y + dy) && !g.occupied(e.x + dx, e.y + dy)) {
          e.x += dx;
          e.y += dy;
        }
      }
    }
  },

  ranged(g, e) {
    const p = g.player;
    if (e.telegraph) {
      e.telegraph = null;
      if ((e.x === p.x || e.y === p.y) && g.lineClear(e.x, e.y, p.x, p.y)) {
        g.msg(`${e.name}が矢を放った！`);
        g.enemyAttackPlayer(e);
      } else {
        g.msg(`${e.name}の矢は外れた（射線が切れた）。`);
      }
    } else if (
      (e.x === p.x || e.y === p.y) && g.lineClear(e.x, e.y, p.x, p.y)
      && Math.abs(e.x - p.x) + Math.abs(e.y - p.y) <= e.etype.sight
    ) {
      e.telegraph = "shot";
      g.msg(`${e.name}が狙いを定めている…（直線から外れて回避可）`);
    } else {
      g.stepToward(e, p.x, p.y);
    }
  },

  support(g, e) {
    const p = g.player;
    const healAmount = e.etype.params.healAmount ?? 4;
    const wounded = g.enemiesNear(e.x, e.y, 1).filter((a) => a.alive && a.hp < a.maxHp);
    if (wounded.length > 0) {
      const t = wounded[0];
      t.heal(healAmount);
      g.msg(`${e.name}が${t.name}を回復した。`);
    } else if (g.adjacentToPlayer(e)) {
      g.enemyAttackPlayer(e);
    } else {
      g.stepToward(e, p.x, p.y, true);
    }
  },

  boss(g, e) {
    const p = g.player;
    const pm = e.etype.params;
    const slamMult = pm.slamMult ?? 2.0;
    const slamRange = pm.slamRange ?? 3;
    const slamTriggerDist = pm.slamTriggerDist ?? 4;
    const slamChance = pm.slamChance ?? 0.5;
    const reinforceChance = pm.reinforceChance ?? 0.15;
    if (e.telegraph) {
      e.telegraph = null;
      if (Math.abs(e.x - p.x) <= slamRange && Math.abs(e.y - p.y) <= slamRange) {
        g.msg(`${e.name}の大振り一撃！`);
        g.enemyAttackPlayer(e, slamMult, "boss");
      } else {
        g.msg(`${e.name}のスラムは空を切った。`);
      }
    } else {
      const dist = Math.abs(e.x - p.x) + Math.abs(e.y - p.y);
      if (dist <= slamTriggerDist && g.rng.ai.random() < slamChance) {
        e.telegraph = "slam";
        g.msg(`${e.name}が力を溜めている…（3マス以上離れて回避）`);
      } else if (g.adjacentToPlayer(e)) {
        g.enemyAttackPlayer(e);
      } else {
        g.stepToward(e, p.x, p.y);
        if (g.rng.ai.random() < reinforceChance) {
          const spot = g.freeNear(e.x, e.y);
          if (spot) {
            g.spawnAt("rat", spot[0], spot[1]);
            g.msg(`${e.name}が増援を呼んだ！`);
          }
        }
      }
    }
  },

  boss_twin(g, e) {
    const p = g.player;
    const doubleChance = e.etype.params.doubleChance ?? 0.35;
    // 近接DPS型ボス：AoE/召喚なし。猛追し、隣接で連撃（確率で追撃）。距離管理ではなく削り合い。
    if (g.adjacentToPlayer(e)) {
      g.enemyAttackPlayer(e);
      if (g.rng.ai.random() < doubleChance && g.state === "playing") {
        g.msg(`${e.name}の追撃！`);
        g.enemyAttackPlayer(e);
      }
    } else {
      g.stepToward(e, p.x, p.y);
    }
  },
};
