/**
 * KPIレポート（roguelike/simulate.py の完全移植）。
 * result() の配列を受け取り、全セクションを出力する純粋ロジック。
 * sim.ts（Bot実行）と report.ts（人間データ読込）の両方から再利用する。
 */
import { RELICS, ENEMIES, WEAPONS, ARCHETYPES, SYNERGY_COMBOS } from "../src/data.ts";

export interface Result {
  result: string;
  turns: number;
  floors_reached: number;
  death_cause: string | null;
  build: string;
  weapon: string;
  relics_offered: string[];
  relics_taken: string[];
  [k: string]: unknown;
}

export function bar(frac: number, width = 28): string {
  const f = Math.max(0, Math.min(1, frac));
  const n = Math.round(f * width);
  return "█".repeat(n) + "·".repeat(width - n);
}
export function pct(x: number): string {
  return (x * 100).toFixed(1).padStart(5) + "%";
}
function mean(a: number[]): number {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
}
function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function counter<T extends string | number>(items: T[]): Map<T, number> {
  const m = new Map<T, number>();
  for (const it of items) m.set(it, (m.get(it) ?? 0) + 1);
  return m;
}
function section(title: string): void {
  console.log("\n" + title);
  console.log("-".repeat(title.length));
}
const enemyName = (id: string | null): string => (id && ENEMIES.has(id) ? ENEMIES.get(id)!.name : String(id));

/** simulate.py report() と同一構成の完全レポートを標準出力へ。clear_rate を返す。 */
export function fullReport(results: Result[], opts: { floors?: number; title?: string } = {}): number {
  const n = results.length;
  const clears = results.filter((r) => r.result === "win");
  const deaths = results.filter((r) => r.result === "dead");
  const clearRate = n ? clears.length / n : 0;

  console.log("=".repeat(60));
  console.log(` ${opts.title ?? "ローグライト KPIレポート"}  (runs=${n}${opts.floors ? `, フロア数=${opts.floors}` : ""})`);
  console.log("=".repeat(60));

  section("■ ラン完走率（クリア率） — 難易度の妥当性");
  console.log(`  クリア : ${String(clears.length).padStart(4)}  ${bar(clearRate)} ${pct(clearRate)}`);
  console.log(`  死亡   : ${String(deaths.length).padStart(4)}  ${bar(n ? deaths.length / n : 0)} ${pct(n ? deaths.length / n : 0)}`);

  section("■ 平均ラン時間（ターン数） — ペーシング");
  const turns = results.map((r) => r.turns);
  if (turns.length) {
    console.log(`  全体   平均 ${mean(turns).toFixed(1).padStart(6)} / 中央 ${median(turns).toFixed(0).padStart(6)} / 最短 ${Math.min(...turns)} / 最長 ${Math.max(...turns)}`);
    if (clears.length) {
      const ct = clears.map((r) => r.turns);
      console.log(`  クリア 平均 ${mean(ct).toFixed(1).padStart(6)} / 中央 ${median(ct).toFixed(0).padStart(6)}`);
    }
    if (deaths.length) {
      const dt = deaths.map((r) => r.turns);
      console.log(`  死亡   平均 ${mean(dt).toFixed(1).padStart(6)} / 中央 ${median(dt).toFixed(0).padStart(6)}`);
    }
  }

  section("■ 到達フロア分布 — どこで詰まるか");
  const fc = counter(results.map((r) => r.floors_reached));
  for (const f of [...fc.keys()].sort((a, b) => a - b)) {
    console.log(`  F${String(f).padEnd(2)}: ${String(fc.get(f)).padStart(4)}  ${bar(n ? fc.get(f)! / n : 0)} ${pct(n ? fc.get(f)! / n : 0)}`);
  }

  section("■ 死因分布 — 公平性（特定要因への集中は理不尽の兆候）");
  const cc = counter(deaths.map((r) => r.death_cause ?? "unknown"));
  if (!cc.size) console.log("  （死亡なし）");
  for (const [cause, c] of [...cc.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${enemyName(cause).padEnd(10)}: ${String(c).padStart(4)}  ${bar(c / Math.max(1, deaths.length))} ${pct(c / Math.max(1, deaths.length))}`);
  }

  section("■ ビルド分布 — 多様性（1系統への偏りはバランス崩壊）");
  const bc = counter(results.map((r) => r.build));
  for (const a of ARCHETYPES.concat(["none"])) {
    if (bc.get(a)) console.log(`  ${a.padEnd(8)}: ${String(bc.get(a)).padStart(4)}  ${bar(n ? bc.get(a)! / n : 0)} ${pct(n ? bc.get(a)! / n : 0)}`);
  }
  if (clears.length) {
    const bcw = counter(clears.map((r) => r.build));
    console.log("  -- クリアしたランのビルド --");
    for (const [a, c] of [...bcw.entries()].sort((x, y) => y[1] - x[1])) {
      console.log(`  ${a.padEnd(8)}: ${String(c).padStart(4)}  ${bar(c / clears.length)} ${pct(c / clears.length)}`);
    }
  }

  section("■ 武器別 勝率 — 個別バランス");
  const byW = new Map<string, [number, number]>();
  for (const r of results) {
    const w = byW.get(r.weapon) ?? [0, 0];
    w[0] += 1;
    w[1] += r.result === "win" ? 1 : 0;
    byW.set(r.weapon, w);
  }
  for (const [wid, [tot, win]] of [...byW.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const name = WEAPONS.get(wid)?.name ?? wid;
    console.log(`  ${name.padEnd(6)}: n=${String(tot).padStart(3)}  勝率 ${bar(win / tot)} ${pct(win / tot)}`);
  }

  section("■ レリック 採用率 / 採用時勝率 — 罠・過小評価の検出");
  const offered = new Map<string, number>();
  const taken = new Map<string, number>();
  const takenWin = new Map<string, number>();
  for (const r of results) {
    for (const rid of new Set(r.relics_offered)) offered.set(rid, (offered.get(rid) ?? 0) + 1);
    for (const rid of r.relics_taken) {
      taken.set(rid, (taken.get(rid) ?? 0) + 1);
      if (r.result === "win") takenWin.set(rid, (takenWin.get(rid) ?? 0) + 1);
    }
  }
  console.log(`  ${"レリック".padEnd(12)}${"系統".padEnd(8)}${"提示".padStart(5)}${"採用".padStart(5)}${"採用率".padStart(8)}${"採用時勝率".padStart(10)}`);
  const rows = [...RELICS.values()].map((rel) => {
    const off = offered.get(rel.id) ?? 0;
    const tk = taken.get(rel.id) ?? 0;
    const pick = off ? tk / off : 0;
    const wr = tk ? (takenWin.get(rel.id) ?? 0) / tk : 0;
    return { rel, off, tk, pick, wr };
  });
  rows.sort((a, b) => b.pick - a.pick);
  for (const { rel, off, tk, pick, wr } of rows) {
    let flag = "";
    if (off >= 8 && pick < 0.1) flag = "  ← 死にアイテム?";
    if (tk >= 8 && wr > clearRate + 0.2) flag = "  ← 過小評価/強い?";
    console.log(`  ${rel.name.padEnd(12)}${rel.archetype.padEnd(8)}${String(off).padStart(5)}${String(tk).padStart(5)}${pct(pick).padStart(9)}${pct(wr).padStart(10)}${flag}`);
  }

  if (SYNERGY_COMBOS.length) {
    section("■ シナジーコンボ別クリア率 — 「組み合わせが報われるか」");
    console.log(`  基準（全体クリア率）= ${pct(clearRate)}`);
    console.log(`  ${"コンボ".padEnd(18)}${"系統".padEnd(8)}${"成立".padStart(5)}${"クリア率".padStart(9)}${"対基準".padStart(9)}`);
    for (const combo of SYNERGY_COMBOS) {
      const need = new Set(combo.relics);
      const runs = results.filter((r) => {
        const t = new Set(r.relics_taken);
        for (const x of need) if (!t.has(x)) return false;
        return true;
      });
      if (!runs.length) {
        console.log(`  ${combo.name.padEnd(18)}${combo.archetype.padEnd(8)}${"0".padStart(5)}${"--".padStart(10)}${"--".padStart(9)}`);
        continue;
      }
      const wr = runs.filter((r) => r.result === "win").length / runs.length;
      const lift = (wr - clearRate) * 100;
      const liftStr = (lift >= 0 ? "+" : "") + lift.toFixed(1) + "pt";
      console.log(`  ${combo.name.padEnd(18)}${combo.archetype.padEnd(8)}${String(runs.length).padStart(5)}${pct(wr).padStart(10)}${liftStr.padStart(9)}`);
    }
  }

  section("■ 相性の良いレリック2枚組 — 共起トップ（n>=20）");
  const pairTot = new Map<string, number>();
  const pairWin = new Map<string, number>();
  for (const r of results) {
    const t = [...new Set(r.relics_taken)].sort();
    for (let i = 0; i < t.length; i++) {
      for (let j = i + 1; j < t.length; j++) {
        const key = t[i] + "|" + t[j];
        pairTot.set(key, (pairTot.get(key) ?? 0) + 1);
        if (r.result === "win") pairWin.set(key, (pairWin.get(key) ?? 0) + 1);
      }
    }
  }
  const pairRows = [...pairTot.entries()]
    .filter(([, tot]) => tot >= 20)
    .map(([key, tot]) => ({ key, tot, wr: (pairWin.get(key) ?? 0) / tot }))
    .sort((a, b) => b.wr - a.wr)
    .slice(0, 12);
  console.log(`  ${"レリックA + レリックB".padEnd(26)}${"回数".padStart(5)}${"クリア率".padStart(9)}`);
  for (const { key, tot, wr } of pairRows) {
    const [a, b] = key.split("|");
    const name = `${RELICS.get(a)?.name ?? a} + ${RELICS.get(b)?.name ?? b}`;
    console.log(`  ${name.padEnd(26)}${String(tot).padStart(5)}${pct(wr).padStart(10)}`);
  }

  section("■ 総括（自動診断）");
  const diag: string[] = [];
  if (clearRate < 0.15) diag.push("クリア率が低すぎ＝理不尽の疑い。難易度/敵火力を見直す。");
  else if (clearRate > 0.75) diag.push("クリア率が高すぎ＝緊張不足。敵密度/火力を上げる余地。");
  else diag.push(`クリア率 ${pct(clearRate)} は手応えのある帯域。`);
  if (clears.length) {
    const winBuilds = new Set(clears.map((r) => r.build));
    winBuilds.delete("none");
    diag.push(`クリアに使われたビルド系統 ${winBuilds.size} 種（多いほど多様）。`);
  }
  const top = [...cc.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && deaths.length && top[1] / deaths.length > 0.5) {
    diag.push(`死因が「${enemyName(top[0])}」に過半集中＝この敵が理不尽でないか要確認。`);
  }
  for (const d of diag) console.log(`  - ${d}`);
  console.log("=".repeat(60));
  return clearRate;
}

/** 健全帯チェック（--assert-kpi 用）。問題点の配列を返す（空=OK）。 */
export function assertKpi(results: Result[]): string[] {
  const n = results.length;
  const clears = results.filter((r) => r.result === "win");
  const deaths = results.filter((r) => r.result === "dead");
  const clearRate = n ? clears.length / n : 0;
  const problems: string[] = [];
  if (clearRate < 0.35 || clearRate > 0.65) problems.push(`クリア率 ${pct(clearRate)} が健全帯(35〜65%)外`);
  const winSystems = ARCHETYPES.filter((a) => clears.some((r) => r.build === a)).length;
  if (winSystems < 5) problems.push(`勝てるビルド系統が ${winSystems} 種（5未満）`);
  const stalled = results.filter((r) => r.result !== "win" && r.result !== "dead").length;
  if (stalled > 0) problems.push(`停滞 ${stalled} 件`);
  const cc = counter(deaths.map((r) => r.death_cause ?? "unknown"));
  const top = [...cc.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && top[0] !== "boss" && deaths.length && top[1] / deaths.length > 0.5) {
    problems.push(`死因がトラッシュmob「${enemyName(top[0])}」に過半集中`);
  }
  return problems;
}
