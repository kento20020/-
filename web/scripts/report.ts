/**
 * 結果ファイルのKPIレポート（人間プレイのデータ分析）。
 * ブラウザの「戦績」書き出しJSON（result()配列）や JSONL を読み、Bot と同じ
 * レポートを出力する。--compare で人間 vs Bot を並べて比較する（過学習/体感差の確認）。
 *
 *   node --experimental-transform-types scripts/report.ts --from runs.json [--compare] [--seed 1000]
 */
import { readFileSync } from "node:fs";
import { fullReport, pct, type Result } from "./report-lib.ts";
import { ARCHETYPES } from "../src/data.ts";
import { runBatch } from "./batch.ts";

function loadResults(path: string): Result[] {
  const text = readFileSync(path, "utf-8").trim();
  let raw: unknown[];
  try {
    const parsed = JSON.parse(text);
    raw = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // JSONL フォールバック（1行1JSON）
    raw = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  }
  return raw.filter(
    (r): r is Result =>
      !!r && typeof r === "object" && typeof (r as any).result === "string" && Array.isArray((r as any).relics_taken),
  );
}

function clearShareByBuild(results: Result[]): Record<string, number> {
  const clears = results.filter((r) => r.result === "win");
  const out: Record<string, number> = {};
  for (const a of ARCHETYPES) out[a] = clears.length ? clears.filter((r) => r.build === a).length / clears.length : 0;
  return out;
}

function main(): void {
  const argv = process.argv.slice(2);
  const fi = argv.indexOf("--from");
  if (fi < 0) {
    console.error("使い方: report.ts --from <results.json> [--compare] [--seed 1000]");
    process.exit(2);
  }
  const path = argv[fi + 1];
  const seed = (() => {
    const i = argv.indexOf("--seed");
    return i >= 0 ? Number(argv[i + 1]) : 1000;
  })();

  const human = loadResults(path);
  if (!human.length) {
    console.error(`有効な結果が見つかりません: ${path}`);
    process.exit(1);
  }
  fullReport(human, { floors: 5, title: `人間プレイ KPI（${path}）` });

  if (argv.includes("--compare")) {
    const bot = runBatch(human.length, seed, "balanced");
    const hClear = human.filter((r) => r.result === "win").length / human.length;
    const bClear = bot.filter((r) => r.result === "win").length / bot.length;
    const hb = clearShareByBuild(human);
    const bb = clearShareByBuild(bot);
    console.log("\n" + "=".repeat(60));
    console.log(` 人間 vs Bot 比較（同数 n=${human.length}）`);
    console.log("=".repeat(60));
    console.log(`  クリア率   人間 ${pct(hClear)}   Bot ${pct(bClear)}   差 ${((hClear - bClear) * 100).toFixed(1)}pt`);
    console.log("  クリア時ビルド構成（人間 / Bot）:");
    for (const a of ARCHETYPES) {
      console.log(`    ${a.padEnd(8)}: ${pct(hb[a])} / ${pct(bb[a])}`);
    }
    console.log("  → 体感（人間）とBot最適化の乖離を確認。大きく違う系統＝Bot過学習の疑い。");
    console.log("=".repeat(60));
  }
}

main();
