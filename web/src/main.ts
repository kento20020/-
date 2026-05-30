/**
 * エントリ／コントローラ。engine の Game を生成し、キーボード入力で駆動、
 * 各領域を再描画、ラン終了で localStorage に記録する（§21/§22）。
 */
import "./styles.css";
import { Game } from "./engine.ts";
import {
  renderTopbar,
  renderBoard,
  renderHud,
  renderBuild,
  renderPreview,
  renderLog,
  renderRewardModal,
  renderEndModal,
  renderStartModal,
  renderStatsModal,
  LEGEND_HTML,
} from "./ui/view.ts";
import { recordRun, summary, exportDownload, copyClipboard, clearRuns } from "./ui/telemetry.ts";

const $ = (id: string) => document.getElementById(id)!;
const els = {
  floor: $("tb-floor"),
  turn: $("tb-turn"),
  seed: $("tb-seed"),
  newBtn: $("tb-new"),
  statsBtn: $("tb-stats"),
  board: $("board"),
  legend: $("legend"),
  hud: $("hud"),
  build: $("build"),
  preview: $("preview"),
  log: $("log"),
  overlay: $("overlay"),
};

let game: Game | null = null;
let weaponId = "sword";
let recorded = false; // 同一ランの二重記録防止

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000) + 1;
}

function showOverlay(html: string): void {
  els.overlay.innerHTML = html;
  els.overlay.classList.remove("hidden");
}
function hideOverlay(): void {
  els.overlay.classList.add("hidden");
  els.overlay.innerHTML = "";
}

function render(): void {
  if (!game) return;
  const tb = renderTopbar(game);
  els.floor.textContent = tb.floor;
  els.turn.textContent = tb.turn;
  els.seed.textContent = tb.seed;

  const board = renderBoard(game);
  els.board.style.gridTemplateColumns = `repeat(${board.cols}, var(--cell))`;
  els.board.innerHTML = board.html;
  els.legend.innerHTML = LEGEND_HTML;

  els.hud.innerHTML = renderHud(game);
  els.build.innerHTML = renderBuild(game);
  els.preview.innerHTML = renderPreview(game);
  els.log.innerHTML = renderLog(game);
  els.log.scrollTop = els.log.scrollHeight;
}

function afterAct(): void {
  if (!game) return;
  render();
  if (game.state === "reward") {
    showOverlay(renderRewardModal(game));
    wireReward();
  } else if (game.state === "win" || game.state === "dead") {
    if (!recorded) {
      recordRun(game.result());
      recorded = true;
    }
    showOverlay(renderEndModal(game));
    wireEnd();
  }
}

function startRun(wId: string, seed: number): void {
  weaponId = wId;
  recorded = false;
  game = new Game(seed, wId);
  hideOverlay();
  render();
}

// ---- オーバーレイの配線 ----
function wireReward(): void {
  els.overlay.querySelectorAll<HTMLButtonElement>(".card").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.i);
      pickReward(i);
    });
  });
}
function pickReward(i: number): void {
  if (!game || game.state !== "reward") return;
  game.takeReward(i);
  hideOverlay();
  afterAct();
}

function wireEnd(): void {
  $("end-again").addEventListener("click", () => startRun(weaponId, randomSeed()));
  $("end-same").addEventListener("click", () => startRun(weaponId, game!.seed));
  $("end-menu").addEventListener("click", openStart);
}

function openStart(): void {
  showOverlay(renderStartModal());
  els.overlay.querySelectorAll<HTMLButtonElement>(".weapon-pick").forEach((btn) => {
    btn.addEventListener("click", () => {
      const w = btn.dataset.w!;
      const input = document.getElementById("start-seed") as HTMLInputElement | null;
      const raw = input?.value.trim();
      const seed = raw && /^\d+$/.test(raw) ? Number(raw) : randomSeed();
      startRun(w, seed);
    });
  });
}

function openStats(): void {
  showOverlay(renderStatsModal(summary()));
  $("stats-dl").addEventListener("click", exportDownload);
  $("stats-copy").addEventListener("click", async () => {
    const ok = await copyClipboard();
    ($("stats-copy") as HTMLButtonElement).textContent = ok ? "コピー済み" : "コピー失敗";
  });
  $("stats-clear").addEventListener("click", () => {
    clearRuns();
    openStats();
  });
  $("stats-close").addEventListener("click", () => {
    hideOverlay();
    if (!game || game.state === "win" || game.state === "dead") openStart();
  });
}

// ---- 入力 ----
const MOVE: Record<string, [number, number]> = {
  w: [0, -1], k: [0, -1], ArrowUp: [0, -1],
  s: [0, 1], j: [0, 1], ArrowDown: [0, 1],
  a: [-1, 0], h: [-1, 0], ArrowLeft: [-1, 0],
  d: [1, 0], l: [1, 0], ArrowRight: [1, 0],
};

window.addEventListener("keydown", (ev) => {
  const overlayOpen = !els.overlay.classList.contains("hidden");

  // 戦績/開始モーダル中は Esc のみ拾う（ボタン操作主体）
  if (overlayOpen) {
    if (game && game.state === "reward") {
      if (ev.key === "1" || ev.key === "2" || ev.key === "3") {
        ev.preventDefault();
        pickReward(Number(ev.key) - 1);
      }
      return;
    }
    if (game && (game.state === "win" || game.state === "dead")) {
      if (ev.key === "r" || ev.key === "R") {
        ev.preventDefault();
        startRun(weaponId, randomSeed());
      }
      return;
    }
    if (ev.key === "Escape" && $("stats-close")) {
      hideOverlay();
      if (!game) openStart();
    }
    return;
  }

  if (!game || game.state !== "playing") return;
  const key = ev.key;
  if (key === " " || key === ".") {
    ev.preventDefault();
    game.playerAct(["wait"]);
    afterAct();
    return;
  }
  const mv = MOVE[key];
  if (mv) {
    ev.preventDefault();
    game.playerAct(["move", mv[0], mv[1]]);
    afterAct();
  }
});

els.newBtn.addEventListener("click", openStart);
els.statsBtn.addEventListener("click", openStats);

// 起動：開始画面
openStart();
