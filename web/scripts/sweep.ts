/**
 * パラメータスイープ — data.json のノブを振ってクリア率の応答を見る（どのノブがどれだけ効くか）。
 * data.ts の可変オブジェクト(RUN/ENEMIES)を実行時に書き換え→バッチ→復元（data.json は変更しない）。
 *   node --experimental-transform-types scripts/sweep.ts --knob run.restChance --values 0.1,0.2,0.3,0.4,0.5 [--n 300] [--seed 1000] [--policy balanced]
 *   knob 例: run.floorClearHeal / run.restChance / run.restHeal /
 *            enemies.boss.hp / enemies.twin_beast.atk / enemies.boss.params.slamChance
 */
import { RUN, ENEMIES } from "../src/data.ts";
import { runBatch } from "./batch.ts";
import { wilson, bar } from "./report-lib.ts";

function setKnob(path: string, v: number): () => void {
  const parts = path.split(".");
  if (parts[0] === "run") {
    const k = parts[1];
    const old = (RUN as any)[k];
    (RUN as any)[k] = v;
    return () => { (RUN as any)[k] = old; };
  }
  if (parts[0] === "enemies") {
    const e = ENEMIES.get(parts[1]);
    if (!e) throw new Error(`未知の敵: ${parts[1]}`);
    if (parts[2] === "params") {
      const k = parts[3];
      const old = (e.params as any)[k];
      (e.params as any)[k] = v;
      return () => { (e.params as any)[k] = old; };
    }
    const k = parts[2];
    const old = (e as any)[k];
    (e as any)[k] = v;
    return () => { (e as any)[k] = old; };
  }
  throw new Error(`未知のノブ: ${path}（run.* / enemies.<id>.* / enemies.<id>.params.* のみ）`);
}

function main(): void {
  const argv = process.argv.slice(2);
  const arg = (f: string, d: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
  const knob = arg("--knob", "");
  const values = arg("--values", "").split(",").map(Number).filter((x) => !Number.isNaN(x));
  const n = Number(arg("--n", "300"));
  const seed = Number(arg("--seed", "1000"));
  const policy = arg("--policy", "balanced");
  if (!knob || values.length === 0) {
    console.error("使い方: sweep.ts --knob run.restChance --values 0.1,0.2,0.3,0.4,0.5 [--n 300]");
    process.exit(2);
  }

  console.log("=".repeat(60));
  console.log(` パラメータスイープ  knob=${knob}  (n=${n}, seed=${seed}, policy=${policy})`);
  console.log("=".repeat(60));
  console.log(`  ${"値".padStart(8)}  ${"クリア率".padStart(8)}  ${"95%CI".padStart(14)}`);
  for (const v of values) {
    const restore = setKnob(knob, v);
    try {
      const res = runBatch(n, seed, policy);
      const wins = res.filter((r) => r.result === "win").length;
      const rate = wins / n;
      const [lo, hi] = wilson(wins, n);
      console.log(`  ${String(v).padStart(8)}  ${(rate * 100).toFixed(1).padStart(7)}%  [${(lo * 100).toFixed(1)}–${(hi * 100).toFixed(1)}]  ${bar(rate, 20)}`);
    } finally {
      restore();
    }
  }
  console.log("=".repeat(60));
  console.log("  ※ data.json は変更していない（実行時に一時改変→復元）。採用したい値が決まったら data.json を編集。");
}

main();
