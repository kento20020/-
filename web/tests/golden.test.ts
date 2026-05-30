/**
 * ゴールデンテスト（設計仕様書_Web版 §24.2 ステップ1：決定論的一致）。
 * Python（roguelike）が生成した基準と、TS エンジンの出力が
 * 「最終 result の完全一致」かつ「各手番のシグネチャ列の完全一致」であることを検証する。
 * フィクスチャ生成： python -m roguelike export-fixture
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Game } from "../src/engine.ts";
import { Bot } from "../src/bot.ts";
import results from "../fixtures/golden_results.json" with { type: "json" };
import traces from "../fixtures/golden_trace.json" with { type: "json" };

function parseKey(key: string): { seed: number; weapon: string; build: string } {
  const [seed, weapon, build] = key.split("|");
  return { seed: Number(seed), weapon, build };
}

test("result グリッド：最終 result() が Python と完全一致", () => {
  const grid = results as Record<string, Record<string, unknown>>;
  let n = 0;
  for (const [key, expected] of Object.entries(grid)) {
    const { seed, weapon, build } = parseKey(key);
    const got = new Bot(new Game(seed, weapon), build).run();
    assert.deepEqual(got, expected, `mismatch at ${key}`);
    n++;
  }
  assert.ok(n >= 180, `grid size ${n}`);
});

test("trace：各手番の状態シグネチャ列が Python と完全一致", () => {
  const tr = traces as Record<string, { result: Record<string, unknown>; trace: string[] }>;
  let n = 0;
  for (const [key, expected] of Object.entries(tr)) {
    const { seed, weapon, build } = parseKey(key);
    const got = new Bot(new Game(seed, weapon), build).runTraced();
    assert.equal(got.trace.length, expected.trace.length, `trace length at ${key}`);
    for (let i = 0; i < expected.trace.length; i++) {
      assert.equal(got.trace[i], expected.trace[i], `trace step ${i} at ${key}`);
    }
    assert.deepEqual(got.result, expected.result, `result at ${key}`);
    n++;
  }
  assert.ok(n >= 6, `trace count ${n}`);
});
