/**
 * 解析EV — シム無し/少サンプルで各レリックの「理論値」を出し、実測の採用時勝率と並置する。
 * 閉形式が効くもの（毒の総ダメ、再生の累積、+HP/+攻 等）を明示。berserk/twin 等は仮定付き近似。
 *   node --experimental-transform-types scripts/ev.ts [--n 300] [--seed 1000]
 *
 * 注意：採用時勝率は交絡を含むので、因果は ab.ts（A/B介入）が本命。本スクリプトは
 * 「数式で説明できる強さ」を可視化し、sim/AB と突き合わせるための補助。
 */
import raw from "../data.json" with { type: "json" };
import { runBatch } from "./batch.ts";

function main(): void {
  const argv = process.argv.slice(2);
  const arg = (f: string, d: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
  const n = Number(arg("--n", "300"));
  const seed = Number(arg("--seed", "1000"));

  // 実測（平均ターン＋採用時勝率）
  const res = runBatch(n, seed, "balanced");
  const turns = res.map((r) => r.turns as number);
  const avgTurns = turns.reduce((a, b) => a + b, 0) / Math.max(1, turns.length);
  const taken = new Map<string, number>();
  const takenWin = new Map<string, number>();
  for (const r of res) {
    for (const id of r.relics_taken as string[]) {
      taken.set(id, (taken.get(id) ?? 0) + 1);
      if (r.result === "win") takenWin.set(id, (takenWin.get(id) ?? 0) + 1);
    }
  }

  console.log("=".repeat(72));
  console.log(` 解析EV × 実測  (実測 n=${n}, seed=${seed}, 平均 ${avgTurns.toFixed(0)} ターン)`);
  console.log("=".repeat(72));
  console.log("  毒スタックNは毎ターン-1で総ダメ N(N+1)/2（深い傷で×2）。再生は『戦闘中』のみ加算。");
  console.log("-".repeat(72));
  console.log(`  ${"レリック".padEnd(12)}${"採用時勝率".padStart(10)}  解析ノート（理論値・仮定）`);

  for (const rel of raw.relics as any[]) {
    const tk = taken.get(rel.id) ?? 0;
    const wr = tk ? (takenWin.get(rel.id) ?? 0) / tk : 0;
    const notes: string[] = [];
    const sm = rel.statMods ?? {};
    if (sm.atk) notes.push(`攻${sm.atk >= 0 ? "+" : ""}${sm.atk}（命中毎ダメ${sm.atk >= 0 ? "+" : ""}${sm.atk}）`);
    if (sm.def) notes.push(`防${sm.def >= 0 ? "+" : ""}${sm.def}（各被弾${sm.def >= 0 ? "-" : "+"}${Math.abs(sm.def)}）`);
    if (sm.maxHp) notes.push(`最大HP${sm.maxHp >= 0 ? "+" : ""}${sm.maxHp}（実効HP${sm.maxHp >= 0 ? "+" : ""}${sm.maxHp}）`);
    if ((rel.flags ?? []).includes("poison_amp")) notes.push("毒ダメ×2（毒型の核）");
    for (const h of rel.hooks ?? []) {
      const p = h.params ?? {};
      switch (h.effect) {
        case "applyPoison": notes.push(`毒+${p.amount}/命中（k命中で総ダメ≈${p.amount}·k(k+1)/2）`); break;
        case "bonusDmgVsPoisoned": notes.push(`毒敵へ直接ダメ×${p.ratio}`); break;
        case "berserkScale": notes.push(`HP欠損率×${p.max}（瀕死で最大+${p.max}／仮定:平均欠損で約+${Math.round(p.max * 0.4)}）`); break;
        case "extraAttack": notes.push(`${Math.round(p.chance * 100)}%で追撃（期待ダメ×${(1 + p.chance).toFixed(2)}）`); break;
        case "lifeSteal": notes.push(`与ダメ×${p.ratio}回復`); break;
        case "reflectRatio": notes.push(`被ダメ×${p.ratio}反射`); break;
        case "reflectFlat": notes.push(`被弾毎 固定${p.amount}反射`); break;
        case "atkBuff": notes.push(`被弾毎 攻+${p.amount}（粘って育つ）`); break;
        case "healFlat":
          notes.push(p.combatOnly
            ? `戦闘中 +${p.amount}/ターン（潜在 最大≈+${p.amount}×戦闘ターン。戦闘外は0）`
            : `+${p.amount}/ターン（潜在≈+${Math.round(p.amount * avgTurns)}HP）`);
          break;
        case "spreadPoison": notes.push(`撃破時 周囲(r${p.radius})へ毒+${p.amount}伝播`); break;
      }
    }
    console.log(`  ${(rel.name as string).padEnd(12)}${(wr * 100).toFixed(1).padStart(8)}%  ${notes.join(" / ") || "—"}`);
  }
  console.log("=".repeat(72));
  console.log("  採用時勝率は交絡込み。真の強さの順位は ab.ts（A/B介入Δ）を参照。");
}

main();
