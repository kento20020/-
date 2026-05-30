/**
 * 自動チューニング — sim を目的関数に data.json のノブを目標クリア率へ寄せる。
 * 外部依存を増やさないため、ランダム摂動＋ヒルクライム（採用/棄却）で探索する。
 * **data.json は書き換えない**：実行時に in-memory 改変して評価し、最後に元へ戻して『提案値』を表示。
 *   node --experimental-transform-types scripts/tune.ts --knobs run.restChance,run.restHeal,enemies.twin_beast.hp \
 *        [--target 0.40] [--n 300] [--seed 1000] [--iters 40]
 */
import { RUN, ENEMIES, ARCHETYPES } from "../src/data.ts";
import { runBatch } from "./batch.ts";

function getKnob(path: string): number {
  const p = path.split(".");
  if (p[0] === "run") return (RUN as any)[p[1]];
  if (p[0] === "enemies") {
    const e = ENEMIES.get(p[1]); if (!e) throw new Error(`未知の敵: ${p[1]}`);
    return p[2] === "params" ? (e.params as any)[p[3]] : (e as any)[p[2]];
  }
  throw new Error(`未知のノブ: ${path}`);
}
function setKnob(path: string, v: number): void {
  const p = path.split(".");
  if (p[0] === "run") { (RUN as any)[p[1]] = v; return; }
  if (p[0] === "enemies") {
    const e = ENEMIES.get(p[1])!;
    if (p[2] === "params") (e.params as any)[p[3]] = v; else (e as any)[p[2]] = v;
    return;
  }
}
function clamp(path: string, v: number): number {
  if (/[Cc]hance|Heal|ratio/.test(path)) return Math.min(0.95, Math.max(0.02, Math.round(v * 100) / 100));
  return Math.max(1, Math.round(v)); // hp/atk/def 等は正の整数
}

function objective(n: number, seed: number, target: number): { obj: number; rate: number } {
  const res = runBatch(n, seed, "balanced");
  const wins = res.filter((r) => r.result === "win").length;
  const rate = wins / res.length;
  let obj = Math.abs(rate - target);
  const winSys = ARCHETYPES.filter((a) => res.some((r) => r.build === a && r.result === "win")).length;
  if (winSys < 5) obj += 0.15 * (5 - winSys);
  const stalled = res.filter((r) => r.result !== "win" && r.result !== "dead").length;
  obj += (stalled / res.length) * 2;
  const deaths = res.filter((r) => r.result === "dead");
  const cc = new Map<string, number>();
  for (const r of deaths) cc.set(String(r.death_cause), (cc.get(String(r.death_cause)) ?? 0) + 1);
  const top = [...cc.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && top[0] !== "boss" && top[0] !== "twin_beast" && deaths.length && top[1] / deaths.length > 0.5) obj += 0.3;
  return { obj, rate };
}

function main(): void {
  const argv = process.argv.slice(2);
  const arg = (f: string, d: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
  const knobs = arg("--knobs", "").split(",").map((s) => s.trim()).filter(Boolean);
  const target = Number(arg("--target", "0.40"));
  const n = Number(arg("--n", "300"));
  const seed = Number(arg("--seed", "1000"));
  const iters = Number(arg("--iters", "40"));
  if (!knobs.length) { console.error("使い方: tune.ts --knobs run.restChance,enemies.twin_beast.hp [--target 0.40]"); process.exit(2); }

  const original: Record<string, number> = {};
  for (const k of knobs) original[k] = getKnob(k);
  const best: Record<string, number> = { ...original };
  let bestEval = objective(n, seed, target);

  console.log("=".repeat(60));
  console.log(` 自動チューニング  target=${(target * 100).toFixed(0)}%  knobs=[${knobs.join(", ")}]  (n=${n}, iters=${iters})`);
  console.log(`  初期: クリア率 ${(bestEval.rate * 100).toFixed(1)}%  目的値 ${bestEval.obj.toFixed(3)}`);
  console.log("=".repeat(60));

  for (let it = 0; it < iters; it++) {
    const k = knobs[Math.floor(Math.random() * knobs.length)];
    const factor = 0.7 + Math.random() * 0.6; // ×0.7〜1.3
    const cand = clamp(k, best[k] * factor);
    if (cand === best[k]) continue;
    setKnob(k, cand);
    const ev = objective(n, seed, target);
    if (ev.obj < bestEval.obj) {
      bestEval = ev; best[k] = cand;
      console.log(`  [#${it}] 改善: ${k} → ${cand}  クリア率 ${(ev.rate * 100).toFixed(1)}%  目的 ${ev.obj.toFixed(3)}`);
    } else {
      setKnob(k, best[k]); // 棄却＝元に戻す
    }
  }

  // 元の値に戻す（data.json は不変）
  for (const k of knobs) setKnob(k, original[k]);

  console.log("=".repeat(60));
  console.log("  提案値（data.json へ手で反映 → sim --assert-kpi → gen-fixtures）:");
  for (const k of knobs) {
    const mark = best[k] !== original[k] ? "  ←変更" : "";
    console.log(`    ${k}: ${original[k]} → ${best[k]}${mark}`);
  }
  console.log(`  到達: クリア率 ${(bestEval.rate * 100).toFixed(1)}%  目的値 ${bestEval.obj.toFixed(3)}`);
  console.log("=".repeat(60));
}

main();
