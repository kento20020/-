/**
 * KPIシミュレーション（roguelike/simulate.py 等価）。
 * roguelike/simulate.py の run_batch を厳密ミラー（meta RNG も PyRandom）。
 *   node --experimental-transform-types scripts/sim.ts --n 1000 --seed 1000 [--assert-kpi]
 *       [--policy balanced|aggressive|cautious] [--compare-policies]
 */
import { ARCHETYPES } from "../src/data.ts";
import { fullReport, assertKpi, pct, type Result } from "./report-lib.ts";
import { runBatch } from "./batch.ts";

function main(): void {
  const argv = process.argv.slice(2);
  const getNum = (flag: string, def: number) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? Number(argv[i + 1]) : def;
  };
  const getStr = (flag: string, def: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? String(argv[i + 1]) : def;
  };
  const n = getNum("--n", 1000);
  const seed = getNum("--seed", 1000);
  const assertFlag = argv.includes("--assert-kpi");

  if (argv.includes("--compare-policies")) {
    // 単一Bot過学習の三角測量：方策間でクリア率が極端に割れないか
    console.log("=".repeat(60));
    console.log(` 複数Bot方策の比較（過学習チェック）  runs=${n}, seed=${seed}`);
    console.log("=".repeat(60));
    console.log(`  ${"方策".padEnd(12)}${"クリア率".padStart(9)}${"勝てる系統".padStart(12)}`);
    for (const policy of ["balanced", "aggressive", "cautious"]) {
      const results = runBatch(n, seed, policy);
      const cr = results.filter((r) => r.result === "win").length / n;
      const winSys = ARCHETYPES.filter((a) => results.some((r) => r.build === a && r.result === "win")).length;
      console.log(`  ${policy.padEnd(12)}${pct(cr).padStart(9)}${String(winSys).padStart(8)} / 5`);
    }
    console.log("\n  → 方策間でクリア率が大きく割れず、各方策で5系統が勝てれば、単一Botへの過学習は小さい。");
    console.log("=".repeat(60));
    return;
  }

  const policy = getStr("--policy", "balanced");
  const results = runBatch(n, seed, policy);
  fullReport(results, { floors: 5, title: `KPIレポート（TS, policy=${policy}）` });

  if (assertFlag) {
    const problems = assertKpi(results);
    if (problems.length) {
      console.error("\nKPI ASSERT FAILED:\n  - " + problems.join("\n  - "));
      process.exit(1);
    }
    console.log("\nKPI ASSERT OK ✅（健全帯・5系統勝利・停滞0・死因偏重なし）");
  }
}

main();
