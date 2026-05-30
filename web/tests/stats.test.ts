/**
 * 統計ヘルパの回帰テスト（既知値で検証）。report-lib の wilson / twoPropZ。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { wilson, twoPropZ } from "../scripts/report-lib.ts";

const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) <= eps;

test("wilson(50,100) ≈ [0.404, 0.596]", () => {
  const [lo, hi] = wilson(50, 100);
  assert.ok(near(lo, 0.404), `lo=${lo}`);
  assert.ok(near(hi, 0.596), `hi=${hi}`);
});

test("wilson(0,10): lo=0, hi≈0.278", () => {
  const [lo, hi] = wilson(0, 10);
  assert.equal(lo, 0);
  assert.ok(near(hi, 0.278, 0.02), `hi=${hi}`);
});

test("wilson(n=0) は [0,0]", () => {
  assert.deepEqual(wilson(0, 0), [0, 0]);
});

test("twoPropZ: 同率は p≈1、大差は p<0.01", () => {
  assert.ok(twoPropZ(50, 100, 50, 100).p > 0.9);
  const big = twoPropZ(60, 100, 40, 100);
  assert.ok(big.p < 0.01, `p=${big.p}`);
  assert.ok(big.z > 2.5, `z=${big.z}`);
});
