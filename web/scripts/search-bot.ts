/**
 * 探索エージェント（1-ply 先読み）— 「上手いプレイの上限勝率(skill ceiling)」を推定し、
 * ヒューリスティックBotとの差から“拾える状況/穴”の候補を検出する。
 * 各手番で候補手をゲーム複製上で試し、ヒューリスティック継続(ロールアウト)が最良の手を選ぶ。
 *   node --experimental-transform-types scripts/search-bot.ts [--n 15] [--seed 1000]
 *
 * ※ 重い処理（O(T²)）なので小サンプル運用。1-ply のため“多段の悪用”（再生キティング等）は
 *   検出しきれない＝より深い MCTS が必要（将来）。それでもヒューリスティック以上の下限ceilingは測れる。
 */
import { Game, Player, Enemy } from "../src/engine.ts";
import { Bot } from "../src/bot.ts";
import { PyRandom } from "../src/rng.ts";
import { WEAPONS, ARCHETYPES } from "../src/data.ts";
import { fmtRate } from "./report-lib.ts";

type Action = ["move", number, number] | ["wait"];
const MOVES: Action[] = [["move", 0, -1], ["move", 0, 1], ["move", -1, 0], ["move", 1, 0], ["wait"]];

function cloneGame(g: Game): Game {
  const c: any = Object.create(Game.prototype);
  c.rng = (g as any).rng.clone();
  c.seed = g.seed; c.numFloors = (g as any).numFloors; c.floorNum = g.floorNum;
  c.turn = g.turn; c.kills = (g as any).kills; c.state = g.state;
  c.level = g.level;                 // フロア中は不変（buildFloor は新規生成で置換）。共有可。
  c.log = [...(g as any).log];
  c.offered = [...g.offered];
  c.relicsOfferedTotal = [...(g as any).relicsOfferedTotal];
  c.relicsTaken = [...(g as any).relicsTaken];
  const p: any = Object.create(Player.prototype);
  Object.assign(p, g.player);
  p.relics = [...g.player.relics];   // 関数ref共有でOK（不変）
  c.player = p;
  c.enemies = g.enemies.map((e) => Object.assign(Object.create(Enemy.prototype), e));
  return c as Game;
}

function score(g: Game): number {
  if (g.state === "win") return 1000;
  return g.floorNum * 10 + Math.max(0, g.player.hp) / Math.max(1, g.player.maxHp);
}

function searchRun(seed: number, weapon: string, pref: string, maxTurns = 1500): string {
  const g = new Game(seed, weapon);
  while ((g.state === "playing" || g.state === "reward") && g.turn < maxTurns) {
    if (g.state === "reward") {
      g.takeReward(new Bot(g, pref, "balanced").chooseReward());
      continue;
    }
    let best: Action = ["wait"];
    let bestScore = -Infinity;
    for (const a of MOVES) {
      const c = cloneGame(g);
      c.playerAct(a);
      new Bot(c, pref, "balanced").run(maxTurns); // ヒューリスティックで終端までロールアウト
      const s = score(c);
      if (s > bestScore) { bestScore = s; best = a; }
    }
    g.playerAct(best);
  }
  return g.state;
}

function main(): void {
  const argv = process.argv.slice(2);
  const arg = (f: string, d: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };
  const n = Number(arg("--n", "15"));
  const seed = Number(arg("--seed", "1000"));

  console.log("=".repeat(60));
  console.log(` 探索エージェント vs ヒューリスティック（n=${n}, seed=${seed}）`);
  console.log("  ※ 重いので小サンプル。1-ply のため多段の悪用は検出しきれない。");
  console.log("=".repeat(60));

  const meta = new PyRandom(seed);
  const weapons = [...WEAPONS.keys()];
  let hWin = 0, sWin = 0;
  const picked: number[] = []; // 探索が勝ち・ヒューリスティックが負けた seed
  for (let i = 0; i < n; i++) {
    const s = seed + i;
    const weapon = meta.choice(weapons);
    const pref = meta.choice(ARCHETYPES);
    const hr = (new Bot(new Game(s, weapon), pref, "balanced").run().result as string) === "win";
    const sr = searchRun(s, weapon, pref) === "win";
    if (hr) hWin++;
    if (sr) sWin++;
    if (sr && !hr) picked.push(s);
  }

  console.log(`  ヒューリスティック : ${fmtRate(hWin, n)}`);
  console.log(`  探索(ceiling)      : ${fmtRate(sWin, n)}`);
  console.log(`  差(ceiling − heur) : ${(((sWin - hWin) / n) * 100).toFixed(1)}pt`);
  if (picked.length) {
    console.log(`  探索のみ勝利の seed（上手く立ち回れば拾える＝設計の余地/穴候補）: ${picked.join(", ")}`);
  }
  console.log("=".repeat(60));
  console.log("  ceiling > heuristic なら『下手だと取りこぼす』余地。差が大きい/特定seedで顕著なら、");
  console.log("  難易度や情報設計（予兆・透明性）の見直し対象。深い悪用検出には MCTS 化が必要。");
}

main();
