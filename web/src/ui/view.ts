/**
 * 描画（DOM/CSS）。engine の状態を読み取りHTML文字列を組み立てる純粋関数群。
 * 盤面はグリッド、サイドバーにHP/ビルド/隣接プレビュー、下部にログ全文（§21）。
 */
import type { Game, Enemy } from "../engine.ts";
import { RELICS, ENEMIES, ARCHETYPES, WEAPONS } from "../data.ts";

const ARCH_LABEL: Record<string, string> = {
  power: "火力",
  poison: "状態異常",
  thorns: "防御反射",
  sustain: "持続",
  utility: "万能",
};

export function archLabel(a: string): string {
  return ARCH_LABEL[a] ?? a;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

export function dominantArch(game: Game): string {
  const counts: Record<string, number> = {};
  for (const a of ARCHETYPES) counts[a] = 0;
  for (const r of game.player.relics) counts[r.archetype] += 1;
  let best = "none";
  let bestVal = 0;
  for (const a of ARCHETYPES) {
    if (counts[a] > bestVal) {
      bestVal = counts[a];
      best = a;
    }
  }
  return best;
}

export function renderTopbar(game: Game): { floor: string; turn: string; seed: string } {
  return {
    floor: `F${game.floorNum}/${game.numFloors}${game.isBossFloor() ? "  ＜ボス階＞" : ""}`,
    turn: `${game.turn}手`,
    seed: `seed: ${game.seed}`,
  };
}

// 一目で分かるアイコン（絵文字は単一コードポイントの堅牢なものを選択）。
const PLAYER_ICON = "🧙";
const EXIT_ICON = "🪜";
const ENEMY_ICON: Record<string, string> = {
  rat: "🐀", slime: "🟢", bat: "🦇", archer: "🏹", brute: "👹", healer: "🩺",
  boss: "👑", twin_beast: "🐺",
};

export function renderBoard(game: Game): { html: string; cols: number } {
  const lvl = game.level;
  const danger = game.dangerCells();
  const epos = new Map<string, Enemy>();
  for (const e of game.enemies) if (e.alive) epos.set(`${e.x},${e.y}`, e);
  const out: string[] = [];
  for (let y = 0; y < lvl.h; y++) {
    for (let x = 0; x < lvl.w; x++) {
      const key = `${x},${y}`;
      const dg = danger.has(key) ? " c-danger" : "";
      if (x === game.player.x && y === game.player.y) {
        const cur = Math.max(0, game.player.hp);
        out.push(`<span class="cell c-player${dg}" title="あなた（HP ${cur}/${game.player.maxHp}）">${PLAYER_ICON}</span>`);
        continue;
      }
      const e = epos.get(key);
      if (e) {
        const tg = e.telegraph ? " c-telegraph" : "";
        const icon = ENEMY_ICON[e.etype.id] ?? "❓";
        const tip = `${e.etype.name}（HP ${Math.max(0, e.hp)}/${e.maxHp}${e.poison > 0 ? `・毒${e.poison}` : ""}）${e.telegraph ? " ⚠攻撃の予兆" : ""}`;
        out.push(`<span class="cell c-enemy${tg}${dg}" title="${esc(tip)}">${icon}</span>`);
        continue;
      }
      const ch = lvl.tiles[y][x];
      if (ch === "#") out.push(`<span class="cell c-wall"></span>`);
      else if (ch === ">") out.push(`<span class="cell c-exit${dg}" title="出口（降りる）">${EXIT_ICON}</span>`);
      else out.push(`<span class="cell c-floor${dg}"></span>`);
    }
  }
  return { html: out.join(""), cols: lvl.w };
}

export const LEGEND_HTML =
  `<b>🧙 あなた</b>　｜　敵: 🐀ネズミ 🟢スライム 🦇コウモリ 🏹射手 👹大兵 🩺治癒師　｜　👑/🐺 ボス　｜　🪜 出口　｜　` +
  `<span class="c-danger">&nbsp;赤マス&nbsp;</span> 予兆＝次の攻撃範囲（外へ動けば回避）。マスにカーソルで詳細`;

export function renderHud(game: Game): string {
  const p = game.player;
  const cur = Math.max(0, p.hp);
  const pct = (cur / p.maxHp) * 100;
  const col = pct > 50 ? "var(--hp-hi)" : pct > 25 ? "var(--hp-mid)" : "var(--hp-lo)";
  return (
    `<div class="hud-line"><span>HP</span><span>${cur} / ${p.maxHp}</span></div>` +
    `<div class="hpbar"><i style="width:${pct}%;background:${col}"></i></div>` +
    `<div class="hud-line"><span>攻 <b>${p.power}</b>　防 <b>${p.defense}</b></span><span>武器: ${esc(p.weapon.name)}</span></div>` +
    `<div class="hud-line"><span class="muted">所持金</span><span>${p.gold}</span></div>`
  );
}

export function renderBuild(game: Game): string {
  const p = game.player;
  if (p.relics.length === 0) {
    return `<div class="section-title">ビルド</div><div class="muted">レリックなし（フロア踏破で獲得）</div>`;
  }
  const dom = dominantArch(game);
  const chips = p.relics
    .map(
      (r) =>
        `<span class="chip" data-arch="${r.archetype}" title="${esc(r.desc)}">${esc(r.name)}</span>`,
    )
    .join("");
  return `<div class="section-title">ビルド（${archLabel(dom)}型）</div><div class="chips">${chips}</div>`;
}

export function renderPreview(game: Game): string {
  const p = game.player;
  const adj = game.enemies.filter(
    (e) => e.alive && Math.abs(e.x - p.x) + Math.abs(e.y - p.y) === 1,
  );
  if (adj.length === 0) {
    return `<div class="section-title">隣接</div><div class="muted">隣に敵なし</div>`;
  }
  const rows = adj
    .map((e) => {
      const pv = game.previewDamage(e);
      return `<div class="preview-row"><span>${esc(e.etype.name)}（残${Math.max(0, e.hp)}${e.poison > 0 ? `/毒${e.poison}` : ""}）</span><span>殴る<b>${pv.dealt}</b> / 被弾<b>${pv.taken}</b></span></div>`;
    })
    .join("");
  return `<div class="section-title">隣接（概算ダメージ）</div>${rows}`;
}

export function renderLog(game: Game): string {
  return game.log
    .slice(-14)
    .map((m) => `<div class="l">▸ ${esc(m)}</div>`)
    .join("");
}

export function renderRewardModal(game: Game): string {
  const cards = game.offered
    .map((rid, i) => {
      const r = RELICS.get(rid)!;
      return (
        `<button class="card" data-i="${i}" type="button">` +
        `<div class="k">[${i + 1}]</div>` +
        `<div class="name">${esc(r.name)}</div>` +
        `<div class="desc">${esc(r.desc)}</div>` +
        `<span class="arch" data-arch="${r.archetype}">${archLabel(r.archetype)}</span>` +
        `</button>`
      );
    })
    .join("");
  return (
    `<div class="modal"><h2>フロア踏破！ 報酬を選べ</h2>` +
    `<p class="sub">1つ獲得（トレードオフに注意）。キー <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> でも選べる。</p>` +
    `<div class="cards">${cards}</div></div>`
  );
}

export function renderEndModal(game: Game): string {
  const r = game.result();
  const win = r.result === "win";
  const cause = r.death_cause as string | null;
  const causeName = !cause ? "—" : ENEMIES.get(cause)?.name ?? cause;
  const relics = game.player.relics.map((x) => x.name).join("、") || "なし";
  return (
    `<div class="modal">` +
    `<h2 class="${win ? "win" : "lose"}">${win ? "★ 生還！ 深淵の王を討った ★" : "✝ 力尽きた…"}</h2>` +
    `<p class="sub">${win ? "おめでとう。" : "死因を振り返り、次の一手へ。"}</p>` +
    `<div class="stat-grid">` +
    `<span class="k">結果</span><span class="${win ? "win" : "lose"}">${win ? "クリア" : "死亡"}</span>` +
    `<span class="k">到達フロア</span><span>F${r.floors_reached}</span>` +
    `<span class="k">ターン数</span><span>${r.turns}</span>` +
    `<span class="k">撃破数</span><span>${r.kills}</span>` +
    `<span class="k">ビルド</span><span>${archLabel(String(r.build))}型</span>` +
    (cause ? `<span class="k">死因</span><span>${esc(causeName)}</span>` : "") +
    `<span class="k">遺物</span><span>${esc(relics)}</span>` +
    `<span class="k">seed</span><span>${r.seed}</span>` +
    `</div>` +
    `<div class="btnrow">` +
    `<button class="btn" id="end-again" type="button">もう一度（新シード）<kbd>R</kbd></button>` +
    `<button class="btn ghost" id="end-same" type="button">同じシードで再挑戦</button>` +
    `<button class="btn ghost" id="end-menu" type="button">武器を選び直す</button>` +
    `</div></div>`
  );
}

export function renderStartModal(): string {
  const cards = [...WEAPONS.values()]
    .map(
      (w) =>
        `<button class="card weapon-pick" data-w="${w.id}" type="button">` +
        `<div class="name">${esc(w.name)}</div>` +
        `<div class="desc">${esc(w.note)}</div>` +
        `<div class="k">攻 ${w.attack}${w.bonusPoison ? ` / 毒+${w.bonusPoison}` : ""}</div>` +
        `</button>`,
    )
    .join("");
  return (
    `<div class="modal"><h2>深淵ローグライト</h2>` +
    `<p class="sub">5フロアを降り、最深部の<b>深淵の王</b>を倒せばクリア。武器を選んで開始。<br>` +
    `操作: <kbd>WASD</kbd>/矢印=移動・攻撃（敵へ移動＝攻撃）、<kbd>Space</kbd>=待機。` +
    `<span class="c-danger">&nbsp;赤背景&nbsp;</span>=予兆（外れた位置へ動けば回避）。</p>` +
    `<div class="weapons">${cards}</div>` +
    `<div class="seedrow"><label class="muted">seed（任意・同じ地形を再現）</label>` +
    `<input id="start-seed" inputmode="numeric" placeholder="空=ランダム" /></div></div>`
  );
}

export function renderStatsModal(sum: {
  n: number;
  wins: number;
  clearRate: number;
  builds: Record<string, number>;
}): string {
  const builds = ARCHETYPES.concat(["none"])
    .filter((a) => sum.builds[a])
    .map((a) => `<span class="k">${a === "none" ? "無" : archLabel(a)}</span><span>${sum.builds[a]}</span>`)
    .join("");
  return (
    `<div class="modal"><h2>あなたの戦績（この端末）</h2>` +
    `<p class="sub">ローカル保存のみ。書き出して共有できます（人間プレイのデータ収集）。</p>` +
    `<div class="stat-grid">` +
    `<span class="k">プレイ数</span><span>${sum.n}</span>` +
    `<span class="k">クリア</span><span class="win">${sum.wins}</span>` +
    `<span class="k">クリア率</span><span>${(sum.clearRate * 100).toFixed(1)}%</span>` +
    builds +
    `</div>` +
    `<div class="btnrow">` +
    `<button class="btn" id="stats-dl" type="button">結果をJSONでダウンロード</button>` +
    `<button class="btn ghost" id="stats-copy" type="button">コピー</button>` +
    `<button class="btn ghost" id="stats-clear" type="button">消去</button>` +
    `<button class="btn ghost" id="stats-close" type="button">閉じる <kbd>Esc</kbd></button>` +
    `</div></div>`
  );
}
