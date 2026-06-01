/**
 * Bot バッチ実行（roguelike/simulate.py の run_batch を厳密ミラー）。
 * meta RNG も PyRandom(baseSeed) で再現し、武器/方策の選択列を Python と一致させる。
 */
import { PyRandom } from "../src/rng.ts";
import { Game } from "../src/engine.ts";
import { Bot } from "../src/bot.ts";
import { WEAPONS, ARCHETYPES, START } from "../src/data.ts";
import type { Result } from "./report-lib.ts";

export function runBatch(n: number, baseSeed: number, policy = "balanced"): Result[] {
  const meta = new PyRandom(baseSeed);
  // 開始武器プールは data.json の start.weaponPool（初期装備を data 駆動に）。既定で全武器。
  const weapons = START.weaponPool ?? [...WEAPONS.keys()];
  const prefs = ARCHETYPES;
  const out: Result[] = [];
  for (let i = 0; i < n; i++) {
    const seed = baseSeed + i;
    const weapon = meta.choice(weapons);
    const pref = meta.choice(prefs);
    out.push(new Bot(new Game(seed, weapon), pref, policy).run() as Result);
  }
  return out;
}
