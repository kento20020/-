/**
 * A/B介入sim — レリックの「因果効果」を測る（採用時勝率の交絡を排除）。
 * 同一seed・同一武器/方策で control(無し) vs treat(そのレリックを開始時に強制付与) を対で回し、
 * クリア率差Δ＝「無料のX1個」の寄与を算出。各群 Wilson区間＋差の z 検定付き。
 *   node --experimental-transform-types scripts/ab.ts [--relic id] [--n 300] [--seed 1000] [--policy balanced]
 */
import { Game } from "../src/engine.ts";
import { Bot } from "../src/bot.ts";
import { PyRandom } from "../src/rng.ts";
import { RELICS, WEAPONS, ARCHETYPES } from "../src/data.ts";
import { wilson, twoPropZ } from "./report-lib.ts";

interface Case { seed: number; weapon: string; pref: string; }

function buildCases(n: number, baseSeed: number): Case[] {
  const meta = new PyRandom(baseSeed);
  const weapons = [...WEAPONS.keys()];
  const out: Case[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ seed: baseSeed + i, weapon: meta.choice(weapons), pref: meta.choice(ARCHETYPES) });
  }
  return out;
}

function winRate(cases: Case[], policy: string, startRelic: string | null): number {
  let wins = 0;
  for (const c of cases) {
    const g = startRelic ? new Game(c.seed, c.weapon, null, [startRelic]) : new Game(c.seed, c.weapon);
    if ((new Bot(g, c.pref, policy).run().result as string) === "win") wins++;
  }
  return wins;
}

function main(): void {
  const argv = process.argv.slice(2);
  const arg = (f: string, d: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
  const n = Number(arg("--n", "300"));
  const seed = Number(arg("--seed", "1000"));
  const policy = arg("--policy", "balanced");
  const only = argv.indexOf("--relic") >= 0 ? argv[argv.indexOf("--relic") + 1] : null;

  const cases = buildCases(n, seed);
  const cWin = winRate(cases, policy, null);          // control は1回だけ（全レリック共通）
  const cRate = cWin / n;

  const ids = only ? [only] : [...RELICS.keys()];
  const rows = ids.map((id) => {
    const tWin = winRate(cases, policy, id);
    const delta = (tWin - cWin) / n;
    const { p } = twoPropZ(tWin, n, cWin, n);
    return { id, name: RELICS.get(id)?.name ?? id, tWin, delta, p };
  });
  rows.sort((a, b) => b.delta - a.delta);

  console.log("=".repeat(64));
  console.log(` A/B介入sim — レリックの因果効果（n=${n}/group, seed=${seed}, policy=${policy}）`);
  console.log(`  control（無付与）クリア率 = ${(cRate * 100).toFixed(1)}%  [${(wilson(cWin, n)[0] * 100).toFixed(1)}–${(wilson(cWin, n)[1] * 100).toFixed(1)}]`);
  console.log("=".repeat(64));
  console.log(`  ${"レリック".padEnd(12)}${"付与時".padStart(8)}${"Δ(因果)".padStart(10)}${"p値".padStart(9)}  有意`);
  for (const r of rows) {
    const tRate = r.tWin / n;
    const dStr = (r.delta >= 0 ? "+" : "") + (r.delta * 100).toFixed(1) + "pt";
    const sig = r.p < 0.01 ? "✱✱" : r.p < 0.05 ? "✱" : "";
    console.log(`  ${r.name.padEnd(12)}${(tRate * 100).toFixed(1).padStart(7)}%${dStr.padStart(10)}${r.p.toFixed(3).padStart(9)}  ${sig}`);
  }
  console.log("=".repeat(64));
  console.log("  Δ = 『そのレリックを無料で1個持って始める』ことによるクリア率の上昇（同一seed対）。");
  console.log("  採用時勝率と違い“勝てる盤面で取られる”交絡が無いので、真の強さの比較に使える。");
}

main();
