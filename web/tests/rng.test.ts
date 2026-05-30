/**
 * rng.ts が CPython random.Random と 1bit たがわず一致することを検証する。
 * フィクスチャは web/fixtures/rng_fixture.json（Python で生成）。
 * これが通らない限りエンジン移植には進まない（等価性の土台）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { PyRandom } from "../src/rng.ts";
import fixture from "../fixtures/rng_fixture.json" with { type: "json" };

test("random(): 53bit 浮動小数が完全一致", () => {
  for (const c of fixture.random) {
    const r = new PyRandom(c.seed);
    for (const expected of c.values) {
      assert.equal(r.random(), expected, `seed=${c.seed}`);
    }
  }
});

test("_randbelow(n): 整数列が完全一致", () => {
  for (const c of fixture.randbelow) {
    const r = new PyRandom(c.seed);
    for (const expected of c.values) {
      assert.equal(r.randbelow(c.n), expected, `seed=${c.seed} n=${c.n}`);
    }
  }
});

test("choice(seq): 選択列が完全一致", () => {
  for (const c of fixture.choice) {
    const r = new PyRandom(c.seed);
    for (const expected of c.values) {
      assert.equal(r.choice(c.pop), expected, `seed=${c.seed}`);
    }
  }
});

test("choices(pop, weights): 重み付き選択が完全一致", () => {
  for (const c of fixture.choices) {
    const r = new PyRandom(c.seed);
    for (const expected of c.values) {
      assert.equal(r.choices(c.pop, c.weights)[0], expected, `seed=${c.seed}`);
    }
  }
});

test("shuffle(x): in-place 並べ替えが完全一致", () => {
  for (const c of fixture.shuffle) {
    const r = new PyRandom(c.seed);
    const arr = [...c.input];
    r.shuffle(arr);
    assert.deepEqual(arr, c.output, `seed=${c.seed}`);
  }
});
