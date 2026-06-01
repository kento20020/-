/**
 * 拡張性フレームワークのテスト — 武器の効果(hooks)・ボス撃破報酬(data駆動)・初期装備(startブロック)。
 * 「engine無編集で data.json から要素を足せる」ことを保証する回帰テスト。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Game, Enemy } from "../src/engine.ts";
import { ENEMIES, WEAPONS, START } from "../src/data.ts";

test("武器hook: engineが武器の onAttack を発火する（効果キャリア化）", () => {
  const g = new Game(1, "sword");
  // 武器インスタンスに効果を付与（data.json の weapons[].hooks と同じ slot）。共有 singleton を汚さないよう複製。
  g.player.weapon = { ...g.player.weapon, onAttack: (_g, _o, _t, ctx) => { ctx.amount += 100; } };
  const e = new Enemy(ENEMIES.get("brute")!, g.player.x + 1, g.player.y);
  const hpBefore = e.hp;
  g.enemies = [e];
  g.playerAttack(e);
  assert.ok(hpBefore - e.hp >= 100, `武器onAttackでctx.amountが加算された（与ダメ=${hpBefore - e.hp}）`);
});

test("武器hook: engineが武器の onKill を発火する", () => {
  const g = new Game(1, "sword");
  let fired = false;
  g.player.weapon = { ...g.player.weapon, onKill: () => { fired = true; } };
  const e = new Enemy(ENEMIES.get("rat")!, g.player.x + 1, g.player.y);
  e.hp = 1;
  g.enemies = [e];
  g.playerAttack(e);
  assert.ok(!e.alive && fired, "撃破時に武器onKillが呼ばれる");
});

test("ボス撃破報酬: data駆動の enemies[].reward が付与される", () => {
  assert.equal(ENEMIES.get("boss")!.reward?.gold, 30, "data.jsonからrewardが読まれている");
  const g = new Game(1, "sword");
  const boss = new Enemy(ENEMIES.get("boss")!, g.player.x + 1, g.player.y);
  boss.hp = 1; // 検証用に瀕死
  g.enemies = [boss];
  const goldBefore = g.player.gold;
  g.playerAttack(boss);
  assert.ok(!boss.alive, "ボス撃破");
  // 基本gold(40) + 撃破報酬gold(30)
  assert.equal(g.player.gold, goldBefore + ENEMIES.get("boss")!.gold + 30, "基本gold＋撃破報酬goldが入る");
});

test("初期装備: start ブロックが data.json から読まれ Game に効く", () => {
  assert.ok(Array.isArray(START.weaponPool) && START.weaponPool.length > 0, "start.weaponPool");
  assert.ok(Array.isArray(START.relics), "start.relics");
  const g = new Game(1, "sword"); // 既定の開始レリック = START.relics
  assert.equal(g.player.relics.length, START.relics.length, "開始レリック数が start.relics と一致");
  assert.equal(g.player.maxHp, START.hp, "初期HPが start.hp");
});

test("武器は既存3種が hooks 無しでも壊れない（後方互換）", () => {
  for (const w of WEAPONS.values()) {
    assert.equal(typeof w.attack, "number");
    // hooks 未定義でも slot は undefined で安全
    assert.ok(w.onAttack === undefined || typeof w.onAttack === "function");
  }
});
