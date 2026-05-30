/**
 * KPIシミュレーション（roguelike/simulate.py 等価）。
 * roguelike/simulate.py の run_batch を厳密ミラー（meta RNG も PyRandom）。
 *   node --experimental-transform-types scripts/sim.ts --n 1000 --seed 1000 [--assert-kpi]
 *       [--policy balanced|aggressive|cautious] [--compare-policies]
 */
import { ARCHETYPES } from "../src/data.ts";
import { fullReport, assertKpi, fmtRate, wilson, type Result } from "./report-lib.ts";
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

  // 複数base_seedでバッチを回し、各バッチ＋プールの Wilson 区間を出す（点推定より堅い）。
  const seedsArg = getStr("--seeds", "");
  if (seedsArg) {
    const policy0 = getStr("--policy", "balanced");
    const seeds = seedsArg.split(",").map(Number).filter((x) => !Number.isNaN(x));
    console.log("=".repeat(60));
    console.log(` 複数バッチ（各 n=${n}, policy=${policy0}）`);
    console.log("=".repeat(60));
    const pooled: Result[] = [];
    for (const s of seeds) {
      const r = runBatch(n, s, policy0);
      pooled.push(...r);
      const wins = r.filter((x) => x.result === "win").length;
      console.log(`  seed ${String(s).padStart(6)} : ${fmtRate(wins, n)}`);
    }
    const pw = pooled.filter((x) => x.result === "win").length;
    console.log("-".repeat(60));
    console.log(`  プール       : ${fmtRate(pw, pooled.length)}  (N=${pooled.length})`);
    console.log("=".repeat(60));
    return;
  }

  if (argv.includes("--compare-policies")) {
    // 単一Bot過学習の三角測量：方策間でクリア率が極端に割れないか
    console.log("=".repeat(60));
    console.log(` 複数Bot方策の比較（過学習チェック）  runs=${n}, seed=${seed}`);
    console.log("=".repeat(60));
    console.log(`  ${"方策".padEnd(12)}${"クリア率 [95%CI]".padStart(22)}${"勝てる系統".padStart(10)}`);
    const bands: Array<[number, number]> = [];
    for (const policy of ["balanced", "aggressive", "cautious"]) {
      const results = runBatch(n, seed, policy);
      const wins = results.filter((r) => r.result === "win").length;
      const winSys = ARCHETYPES.filter((a) => results.some((r) => r.build === a && r.result === "win")).length;
      bands.push(wilson(wins, n));
      console.log(`  ${policy.padEnd(12)}${fmtRate(wins, n).padStart(22)}${(String(winSys) + " / 5").padStart(8)}`);
    }
    const lo = Math.min(...bands.map((b) => b[0])), hi = Math.max(...bands.map((b) => b[1]));
    console.log(`\n  人間幅の近似（方策横断の帯）: ${(lo * 100).toFixed(1)}% 〜 ${(hi * 100).toFixed(1)}%`);
    console.log("  → 帯が健全帯に収まり各方策で5系統が勝てれば、単一Botへの過学習は小さい。");
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
