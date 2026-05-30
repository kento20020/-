/**
 * 描画スモークテスト（DOM不要）。view.ts の各描画関数が例外なく動き、
 * 期待する内容を含むことを Node で確認する（ブラウザ無しの健全性チェック）。
 *   node --experimental-transform-types scripts/smoke-render.ts
 */
import { Game } from "../src/engine.ts";
import { Bot } from "../src/bot.ts";
import * as V from "../src/ui/view.ts";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("  ok:", msg);
}

// 1ラン Bot で完走させ、報酬画面と終了画面のHTMLを捕捉
const g = new Game(777, "dagger");
const bot = new Bot(g, "poison");
let rewardHtml = "";
let steps = 0;
while ((g.state === "playing" || g.state === "reward") && steps < 3000) {
  if (g.state === "reward") {
    if (!rewardHtml) rewardHtml = V.renderRewardModal(g);
    g.takeReward(bot.chooseReward());
    continue;
  }
  g.playerAct(bot.decide());
  steps++;
}

const res = g.result();
console.log("== smoke render ==");
console.log("  run:", res.result, "floor", res.floors_reached, "turns", res.turns, "build", res.build);

const tb = V.renderTopbar(g);
assert(tb.floor.startsWith("F") && tb.seed.includes("777"), "topbar 描画");
assert(V.renderHud(g).includes("HP"), "HUD 描画");
assert(V.renderBuild(g).length > 0, "ビルド 描画");
assert(V.renderLog(g).includes("▸"), "ログ 描画");
assert(rewardHtml.includes("報酬") && rewardHtml.includes("card"), "報酬3択モーダル 描画");
assert(
  V.renderEndModal(g).includes(g.state === "win" ? "生還" : "力尽きた"),
  "終了モーダル 描画",
);
assert(V.renderStartModal().includes("武器") && V.renderStartModal().includes("weapon-pick"), "開始モーダル 描画");
assert(
  V.renderStatsModal({ n: 3, wins: 1, clearRate: 0.33, builds: { poison: 2, none: 1 } }).includes("戦績"),
  "戦績モーダル 描画",
);

// 盤面グリッドの整合（セル数 = w*h）
const g2 = new Game(777, "dagger");
const bd = V.renderBoard(g2);
const cellCount = (bd.html.match(/class="cell/g) ?? []).length;
assert(bd.cols === g2.level.w, "盤面 列数 = level.w");
assert(cellCount === g2.level.w * g2.level.h, `盤面セル数 = w*h (${cellCount})`);
assert(bd.html.includes("c-player"), "プレイヤー @ 描画");

console.log("\n全描画スモーク通過 ✅");
