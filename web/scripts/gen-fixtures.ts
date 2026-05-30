/**
 * ゴールデン再生成（roguelike/__main__.py export-fixture のTS置換）。
 * TSエンジンを単一の真実として、決定論リグレッション基準を作り直す。
 *   - golden_results.json … 代表グリッドの result()
 *   - golden_trace.json   … 代表ランの各手番シグネチャ
 * rng_fixture.json は Python 生成の MT19937 正準値を凍結保持（再生成しない）。
 *
 *   node --experimental-transform-types scripts/gen-fixtures.ts
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Game } from "../src/engine.ts";
import { Bot } from "../src/bot.ts";
import { WEAPONS, ARCHETYPES } from "../src/data.ts";
import { sig } from "../src/trace.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "fixtures");

const SEEDS = [1, 2, 7, 42, 123, 777, 2000, 2001, 2002, 2003, 2004, 2005];
const WEAPONS_LIST = [...WEAPONS.keys()];
const BUILDS = [...ARCHETYPES];
const TRACES: Array<[number, string, string]> = [
  [123, "sword", "power"],
  [2000, "dagger", "poison"],
  [2001, "hammer", "thorns"],
  [7, "sword", "sustain"],
  [42, "dagger", "utility"],
  [2005, "hammer", "power"],
];

// result グリッド（Bot は既定 balanced 方策＝ゴールデンと一致）
const grid: Record<string, unknown> = {};
for (const s of SEEDS) {
  for (const w of WEAPONS_LIST) {
    for (const b of BUILDS) {
      grid[`${s}|${w}|${b}`] = new Bot(new Game(s, w), b).run();
    }
  }
}

// traced ラン（runTraced は equivalence.py の traced_run と同一制御フロー）
function tracedRun(seed: number, weapon: string, build: string) {
  const g = new Game(seed, weapon);
  const bot = new Bot(g, build);
  void sig; // sig は runTraced 内で使用
  return bot.runTraced();
}
const traceData: Record<string, unknown> = {};
for (const [s, w, b] of TRACES) traceData[`${s}|${w}|${b}`] = tracedRun(s, w, b);

writeFileSync(join(outDir, "golden_results.json"), JSON.stringify(grid));
writeFileSync(join(outDir, "golden_trace.json"), JSON.stringify(traceData));
console.log(
  `wrote ${Object.keys(grid).length} result rows + ${Object.keys(traceData).length} traces to ${outDir}（rng_fixture.json は凍結・据置）`,
);
