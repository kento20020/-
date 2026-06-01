/**
 * レリック機能テスト — 各レリックの効果が実際に状態を変えるか直接検証する。
 * statMods は addRelic で、hook 効果は EFFECTS が束ねた relic.onXxx を直接叩いて確認。
 * （フックが正しい“タイミング”で呼ばれるかは golden.test.ts が別途保証）
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Game, Enemy } from "../src/engine.ts";
import { RELICS, ENEMIES } from "../src/data.ts";

const R = (id: string) => RELICS.get(id)!;
const brute = () => new Enemy(ENEMIES.get("brute")!, 5, 5);
const ctx = (amount: number) => ({ amount, attacker: null, target: null, source: "attack", extraHits: 0 });

test("statMod: 攻/防/最大HP が取得で変化", () => {
  let g = new Game(1, "sword");
  let a = g.player.attack;
  g.player.addRelic(R("sharp"));
  assert.equal(g.player.attack, a + 3);

  g = new Game(1, "sword");
  const at = g.player.attack, mh = g.player.maxHp;
  g.player.addRelic(R("giant"));
  assert.equal(g.player.attack, at + 6);
  assert.equal(g.player.maxHp, mh - 10);

  g = new Game(1, "sword");
  const d = g.player.defense, m2 = g.player.maxHp;
  g.player.addRelic(R("ironwall"));
  assert.equal(g.player.defense, d + 2); // 鉄壁は v0.2 で +3→+2 に調整済み（突出した1択の解消）
  assert.equal(g.player.maxHp, m2 + 4);  // 同上 最大HP +6→+4

  g = new Game(1, "sword");
  const m3 = g.player.maxHp;
  g.player.addRelic(R("vitality"));
  assert.equal(g.player.maxHp, m3 + 20); // 活力は v0.2 で +25→+20 に調整済み

  g = new Game(1, "sword");
  const a4 = g.player.attack, d4 = g.player.defense;
  g.player.addRelic(R("guard"));
  assert.equal(g.player.attack, a4 + 1);
  assert.equal(g.player.defense, d4 + 2);

  g = new Game(1, "sword");
  const a5 = g.player.attack;
  g.player.addRelic(R("focus"));
  assert.equal(g.player.attack, a5 + 2);
});

test("venom: 攻撃で毒を付与", () => {
  const g = new Game(1, "sword");
  g.player.addRelic(R("venom"));
  const e = brute();
  g.enemies = [e];
  g.playerAttack(e);
  assert.ok(e.alive, "検証用に生存している");
  assert.ok(e.poison > 0, `毒スタック=${e.poison}`);
});

test("vampiric: 攻撃で回復", () => {
  const g = new Game(1, "sword");
  g.player.hp = 10;
  g.player.addRelic(R("vampiric"));
  const e = brute();
  g.enemies = [e];
  g.playerAttack(e);
  assert.ok(g.player.hp > 10, `hp=${g.player.hp}`);
});

test("thorns/spiked: 被弾で反射ダメージ", () => {
  const g = new Game(1, "sword");
  const a1 = brute();
  R("thorns").onHitTaken!(g, g.player, a1, ctx(10));
  assert.ok(a1.hp < a1.maxHp, `thorns反射 hp=${a1.hp}`);
  const a2 = brute();
  R("spiked").onHitTaken!(g, g.player, a2, ctx(1));
  assert.equal(a2.maxHp - a2.hp, 4, "spikedは固定4反射");
});

test("retaliate: 被弾で攻撃+1", () => {
  const g = new Game(1, "sword");
  const a = g.player.attack;
  R("retaliate").onHitTaken!(g, g.player, brute(), ctx(5));
  assert.equal(g.player.attack, a + 1);
});

test("regen: 戦闘中のみ回復（combatOnly）", () => {
  const g = new Game(1, "sword");
  g.player.hp = 10;
  g.enemies = [brute()];
  R("regen").onTurnStart!(g, g.player);
  assert.equal(g.player.hp, 11, "敵が居れば回復");
  g.player.hp = 10;
  g.enemies = [];
  R("regen").onTurnStart!(g, g.player);
  assert.equal(g.player.hp, 10, "敵が居なければ回復しない");
});

test("corrosion: 毒状態の敵への直接ダメ増幅", () => {
  const g = new Game(1, "sword");
  const e = brute();
  e.poison = 3;
  const c = ctx(10);
  R("corrosion").onAttack!(g, g.player, e, c);
  assert.ok(c.amount > 10, `amount=${c.amount}`);
});

test("berserk: 低HPで火力増加", () => {
  const g = new Game(1, "sword");
  g.player.hp = Math.floor(g.player.maxHp * 0.2);
  const c = ctx(10);
  R("berserk").onAttack!(g, g.player, brute(), c);
  assert.ok(c.amount > 10, `amount=${c.amount}`);
});

test("plague: 撃破時に周囲へ毒伝播", () => {
  const g = new Game(1, "sword");
  const victim = new Enemy(ENEMIES.get("brute")!, 5, 5);
  victim.poison = 2;
  const near = new Enemy(ENEMIES.get("rat")!, 6, 5);
  g.enemies = [victim, near];
  R("plague").onKill!(g, g.player, victim);
  assert.ok(near.poison > 0, `near毒=${near.poison}`);
});

test("deepwound: poison_amp フラグを持つ", () => {
  const g = new Game(1, "sword");
  g.player.addRelic(R("deepwound"));
  assert.ok(g.player.hasFlag("poison_amp"));
});

test("twin: onAttack フックが存在（追撃は確率発火）", () => {
  assert.equal(typeof R("twin").onAttack, "function");
});
