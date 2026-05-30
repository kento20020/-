/**
 * doctor — CLAUDE.md / docs と実コードの「齟齬」を検出する整合性チェック。
 * 開発が進んでもドキュメントが現実とズレないための仕組み（CI で実行）。
 *   node --experimental-transform-types scripts/doctor.ts
 *
 * チェック内容:
 *   1) web/data.json の整合（要素数・必須数値に null が無い）
 *   2) package.json に必須 scripts が揃っている
 *   3) CLAUDE.md が参照する `npm run X` が実在する
 *   4) CLAUDE.md が参照するファイルパス（バッククォート内）が実在する
 *   5) アーキテクチャの主要ファイルが実在する
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");
const repoRoot = join(here, "..", "..");

const problems: string[] = [];
const ok = (m: string) => console.log("  ok:", m);
const fail = (m: string) => problems.push(m);

// ---- 1) data.json 整合 ----
function checkData(): void {
  const p = join(webRoot, "data.json");
  if (!existsSync(p)) {
    fail("web/data.json が存在しない（数値真値）");
    return;
  }
  const d = JSON.parse(readFileSync(p, "utf-8"));
  const expect: Array<[string, number]> = [
    ["weapons", 3],
    ["relics", 17],
    ["enemies", 7],
    ["archetypes", 5],
  ];
  for (const [k, n] of expect) {
    const len = Array.isArray(d[k]) ? d[k].length : -1;
    if (len !== n) fail(`data.json ${k} の要素数が ${len}（期待 ${n}）`);
  }
  if (!Array.isArray(d.synergyCombos) || d.synergyCombos.length === 0)
    fail("data.json synergyCombos が空（コンボ統計の定義）");
  // 必須数値に null/未定義が無いか
  for (const w of d.weapons ?? []) if (w.atk == null) fail(`武器 ${w.id} の atk が null`);
  for (const e of d.enemies ?? [])
    if (e.hp == null || e.atk == null || e.defense == null) fail(`敵 ${e.id} の hp/atk/defense に null`);
  for (const r of d.relics ?? [])
    for (const h of r.hooks ?? [])
      for (const [pk, pv] of Object.entries(h.params ?? {}))
        if (pv == null) fail(`レリック ${r.id} の効果パラメータ ${pk} が null`);
  if (problems.length === 0) ok("data.json 整合（武器3・レリック17・敵7・系統5・コンボ定義あり・null無し）");
}

// ---- 2) package.json scripts ----
let pkgScripts: Record<string, string> = {};
function checkPkg(): void {
  const pkg = JSON.parse(readFileSync(join(webRoot, "package.json"), "utf-8"));
  pkgScripts = pkg.scripts ?? {};
  const required = ["dev", "build", "test", "sim", "report", "gen-fixtures", "doctor", "check"];
  const missing = required.filter((s) => !(s in pkgScripts));
  if (missing.length) fail(`package.json scripts に不足: ${missing.join(", ")}`);
  else ok(`package.json scripts 完備（${required.join(", ")}）`);
}

// ---- 3+4) CLAUDE.md ↔ 実体 ----
function resolveRef(token: string): string | null {
  const t = token.replace(/[.,;:)）」]+$/, "");
  if (/dist|node_modules/.test(t)) return null;
  if (t === "CLAUDE.md" || t === "README.md" || t === "pyproject.toml") return join(repoRoot, t);
  if (/^(web|\.github|docs|roguelike)\//.test(t)) return join(repoRoot, t);
  if (/^(src|scripts|tests|fixtures)\//.test(t)) return join(webRoot, t);
  return null;
}

function checkClaudeMd(): void {
  const p = join(repoRoot, "CLAUDE.md");
  if (!existsSync(p)) {
    fail("CLAUDE.md が存在しない");
    return;
  }
  const text = readFileSync(p, "utf-8");

  // 3) `npm run X`
  const runs = new Set<string>();
  for (const m of text.matchAll(/\bnpm run ([a-z][\w-]*)/g)) runs.add(m[1]);
  const badRuns = [...runs].filter((r) => !(r in pkgScripts));
  if (badRuns.length) fail(`CLAUDE.md が存在しない npm script を参照: ${badRuns.join(", ")}`);
  else if (runs.size) ok(`CLAUDE.md の npm run 参照 ${runs.size} 件すべて実在`);

  // 4) バッククォート内のパス
  const refs = new Set<string>();
  for (const m of text.matchAll(/`([^`]+)`/g)) {
    const inner = m[1].trim();
    if (resolveRef(inner)) refs.add(inner);
  }
  const badRefs = [...refs].filter((t) => {
    const abs = resolveRef(t);
    return abs && !existsSync(abs);
  });
  if (badRefs.length) fail(`CLAUDE.md が存在しないパスを参照: ${badRefs.join(", ")}`);
  else if (refs.size) ok(`CLAUDE.md のファイル参照 ${refs.size} 件すべて実在`);
}

// ---- 5) 主要ファイル ----
function checkArchitecture(): void {
  const files = [
    "src/engine.ts", "src/world.ts", "src/rng.ts", "src/data.ts", "src/bot.ts", "src/trace.ts",
    "src/main.ts", "src/styles.css", "src/ui/view.ts", "src/ui/telemetry.ts",
    "index.html", "vite.config.ts", "data.json",
    "scripts/sim.ts", "scripts/report.ts", "scripts/report-lib.ts", "scripts/batch.ts", "scripts/gen-fixtures.ts",
    "tests/rng.test.ts", "tests/golden.test.ts",
    "fixtures/rng_fixture.json", "fixtures/golden_results.json", "fixtures/golden_trace.json",
  ];
  const missing = files.filter((f) => !existsSync(join(webRoot, f)));
  if (missing.length) fail(`主要ファイルが不足: ${missing.join(", ")}`);
  else ok(`主要ファイル ${files.length} 件すべて実在`);
}

console.log("== doctor: CLAUDE.md / docs と実体の整合チェック ==");
checkData();
checkPkg();
checkClaudeMd();
checkArchitecture();

if (problems.length) {
  console.error("\n齟齬を検出しました（修正してください）:");
  for (const p of problems) console.error("  ✗ " + p);
  process.exit(1);
}
console.log("\n整合OK ✅ — CLAUDE.md と実体に齟齬なし");
