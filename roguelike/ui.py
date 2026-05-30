"""端末向けの最小ビジュアル（設計仕様書 §9 UI/UX）。

方針：ビジュアルは凝らないが「今なにが起きているか」「敵味方」「なぜ死んだか」
が一目で分かることを最優先する。色とHUDで可読性を担保する。

render(game) は副作用のない純粋関数（フレーム文字列を返す）なので、
ヘッドレスでもテスト・録画できる。実プレイは play()（curses）と
line_play()（行入力・どの端末でも動く）の2系統を用意する。
"""
from __future__ import annotations

from . import data

RESET = "\x1b[0m"
BOLD = "\x1b[1m"


def _c(code):
    return f"\x1b[{code}m"


# 敵味方を色で即判別（§9 可読性）
COLORS = {
    "@": _c("1;92"),       # プレイヤー：明るい緑
    ">": _c("1;96"),       # 出口：明るいシアン
    "#": _c("90"),         # 壁：灰
    ".": _c("90"),         # 床：暗い灰
}
ENEMY_COLOR = {
    "boss": _c("1;95"),    # ボス：明るいマゼンタ
    "brute": _c("1;91"),   # 大兵：明るい赤
    "healer": _c("93"),    # 治癒師：黄
    "archer": _c("91"),    # 射手：赤
    "default": _c("31"),   # その他：赤
}


def _danger_tiles(game):
    """予兆（射手の射線・ボスのスラム範囲）を可視化するためのタイル集合。"""
    tiles = set()
    for e in game.enemies:
        if not e.alive:
            continue
        if e.behavior == "ranged" and e.telegraph:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                x, y = e.x, e.y
                for _ in range(e.etype.sight):
                    x, y = x + dx, y + dy
                    if not game.level.is_floor(x, y):
                        break
                    tiles.add((x, y))
        if e.behavior == "boss" and e.telegraph:
            for dx in range(-3, 4):
                for dy in range(-3, 4):
                    tiles.add((e.x + dx, e.y + dy))
    return tiles


def render_map(game):
    lvl = game.level
    danger = _danger_tiles(game)
    epos = {(e.x, e.y): e for e in game.enemies if e.alive}
    rows = []
    for y in range(lvl.h):
        line = []
        for x in range(lvl.w):
            if (x, y) == (game.player.x, game.player.y):
                line.append(COLORS["@"] + "@" + RESET)
                continue
            e = epos.get((x, y))
            if e:
                col = ENEMY_COLOR.get(e.etype.id, ENEMY_COLOR["default"])
                sym = e.symbol
                if e.telegraph:                 # 攻撃を溜めている敵を点滅強調
                    col = _c("1;93")
                line.append(col + sym + RESET)
                continue
            ch = lvl.tiles[y][x]
            if (x, y) in danger:                # 予兆タイルは赤背景で警告
                line.append(_c("41") + ("." if ch != ">" else ">") + RESET)
            elif ch == ">":
                line.append(COLORS[">"] + ">" + RESET)
            elif ch == "#":
                line.append(COLORS["#"] + "#" + RESET)
            else:
                line.append(COLORS["."] + "." + RESET)
        rows.append("".join(line))
    return "\n".join(rows)


def _hp_bar(cur, mx, width=20):
    cur = max(0, cur)
    n = int(round(width * cur / max(1, mx)))
    color = _c("92") if cur > mx * 0.5 else _c("93") if cur > mx * 0.25 else _c("91")
    return color + "█" * n + _c("90") + "·" * (width - n) + RESET


def render_hud(game):
    p = game.player
    lines = []
    boss = " ＜ボス階＞" if game._is_boss_floor() else ""
    lines.append(f"{BOLD}フロア {game.floor_num}/{game.num_floors}{boss}{RESET}"
                 f"   ターン {game.turn}   所持金 {p.gold}")
    lines.append(f"HP {_hp_bar(p.hp, p.max_hp)} {max(0,p.hp):3d}/{p.max_hp}"
                 f"   攻 {p.power}  防 {p.defense}  武器:{p.weapon.name}")
    if p.relics:
        rel = "  ".join(f"{r.name}({r.archetype[:3]})" for r in p.relics)
        lines.append(f"{_c('96')}遺物:{RESET} {rel}")
    return "\n".join(lines)


def render_log(game, n=4):
    tail = game.log[-n:]
    return "\n".join(_c("37") + " » " + m + RESET for m in tail)


LEGEND = (_c("1;92") + "@あなた  " + RESET + _c("91") + "r/s/b/a/B/h 敵  " + RESET +
          _c("1;95") + "D ボス  " + RESET + _c("1;96") + "> 出口  " + RESET +
          _c("41") + " 赤背景=予兆(危険) " + RESET)


def render(game):
    parts = [render_hud(game), "", render_map(game), "", render_log(game), "", LEGEND]
    return "\n".join(parts)


def render_reward(game):
    lines = [BOLD + "── フロア踏破！ 報酬を選べ（1/2/3） ──" + RESET]
    for i, rid in enumerate(game.offered, 1):
        r = data.RELICS[rid]
        lines.append(f"  [{i}] {_c('96')}{r.name}{RESET} ({r.archetype})  {r.desc}")
    return "\n".join(lines)


def render_gameover(game):
    res = game.result()
    title = (_c("1;92") + "★ 生還！ 深淵の王を討った ★" if res["result"] == "win"
             else _c("1;91") + "✝ 力尽きた…")
    cause = res["death_cause"]
    cause_name = data.ENEMIES[cause].name if cause in data.ENEMIES else cause
    lines = [title + RESET, ""]
    lines.append(f"  結果      : {res['result']}")
    lines.append(f"  到達フロア: {res['floors_reached']}")
    lines.append(f"  ターン数  : {res['turns']}")
    lines.append(f"  撃破数    : {res['kills']}")
    lines.append(f"  所持金    : {res['gold']}")
    if cause:
        lines.append(f"  死因      : {cause_name}  ← 回避できたか振り返ろう")
    lines.append(f"  ビルド    : {res['build']}  武器:{data.WEAPONS[res['weapon']].name}")
    if game.player.relics:
        lines.append("  遺物      : " + ", ".join(r.name for r in game.player.relics))
    return "\n".join(lines)


CLEAR = "\x1b[2J\x1b[H"


# ---------------------------------------------------------------------------
# 行入力プレイ（どの端末でも動く。デバッグ容易・最優先の互換モード）
# ---------------------------------------------------------------------------
def line_play(game):
    import sys
    moves = {"w": (0, -1), "s": (0, 1), "a": (-1, 0), "d": (1, 0)}
    print(CLEAR, end="")
    while game.state in ("playing", "reward"):
        print(CLEAR, end="")
        if game.state == "reward":
            print(render_reward(game))
            ch = input("選択> ").strip()
            game.take_reward(int(ch) - 1 if ch in "123" else 0)
            continue
        print(render(game))
        print("\n操作: w/a/s/d 移動・攻撃, '.' 待機, q 終了")
        ch = input("> ").strip().lower()
        if ch == "q":
            print("中断しました。")
            return
        if ch == ".":
            game.player_act(("wait",))
        elif ch and ch[0] in moves:
            game.player_act(("move", *moves[ch[0]]))
    print(CLEAR, end="")
    print(render_gameover(game))


# ---------------------------------------------------------------------------
# curses プレイ（キー即応の本命体験。tty が必要）
# ---------------------------------------------------------------------------
def curses_play(game):
    import curses

    def strip(s):  # cursesにはANSIを渡せないので色コードを除去して描画
        import re
        return re.sub(r"\x1b\[[0-9;]*m", "", s)

    def loop(scr):
        curses.curs_set(0)
        scr.nodelay(False)
        keymap = {ord("w"): (0, -1), ord("s"): (0, 1), ord("a"): (-1, 0),
                  ord("d"): (1, 0), curses.KEY_UP: (0, -1), curses.KEY_DOWN: (0, 1),
                  curses.KEY_LEFT: (-1, 0), curses.KEY_RIGHT: (1, 0)}
        while game.state in ("playing", "reward"):
            scr.erase()
            if game.state == "reward":
                frame = strip(render_reward(game))
            else:
                frame = strip(render(game)) + "\n\n操作: WASD/矢印 移動・攻撃, '.' 待機, q 終了"
            for i, ln in enumerate(frame.split("\n")):
                try:
                    scr.addstr(i, 0, ln)
                except curses.error:
                    pass
            scr.refresh()
            k = scr.getch()
            if game.state == "reward":
                if k in (ord("1"), ord("2"), ord("3")):
                    game.take_reward(k - ord("1"))
                continue
            if k == ord("q"):
                return
            if k == ord("."):
                game.player_act(("wait",))
            elif k in keymap:
                game.player_act(("move", *keymap[k]))
        scr.erase()
        for i, ln in enumerate(strip(render_gameover(game)).split("\n")):
            try:
                scr.addstr(i, 0, ln)
            except curses.error:
                pass
        scr.addstr(i + 2, 0, "キーを押して終了")
        scr.refresh()
        scr.getch()

    curses.wrapper(loop)
