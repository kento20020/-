"""エントリポイント。

  python3 -m roguelike play          対話プレイ（curses。非ttyなら行入力）
  python3 -m roguelike play --line   行入力プレイ（どの端末でも動く）
  python3 -m roguelike demo          Botの自動プレイを観賞（動作確認に最適）
  python3 -m roguelike sim -n 500    KPI統計シミュレーション
"""
from __future__ import annotations

import argparse
import sys
import time

from .engine import Game
from . import ui, simulate


def cmd_play(args):
    game = Game(seed=args.seed, weapon_id=args.weapon, num_floors=args.floors)
    use_line = args.line or not sys.stdout.isatty()
    if use_line:
        ui.line_play(game)
    else:
        try:
            ui.curses_play(game)
        except Exception as e:  # cursesが使えない環境は行入力へ退避
            print(f"(curses不可: {e} → 行入力モードへ)")
            ui.line_play(game)


def cmd_demo(args):
    from .bot import Bot
    game = Game(seed=args.seed, weapon_id=args.weapon, num_floors=args.floors)
    bot = Bot(game, preferred_archetype=args.build)
    frames = 0
    while game.state in ("playing", "reward") and frames < args.max_frames:
        print(ui.CLEAR, end="")
        if game.state == "reward":
            print(ui.render_reward(game))
            time.sleep(args.delay * 4)
            game.take_reward(bot.choose_reward())
            bot._floor, bot._floor_steps, bot._rush = game.floor_num, 0, False
            continue
        print(ui.render(game))
        if game.floor_num != bot._floor:
            bot._floor, bot._floor_steps, bot._rush = game.floor_num, 0, False
        bot._floor_steps += 1
        if bot._floor_steps > 120 and not game._is_boss_floor():
            bot._rush = True
        game.player_act(bot.decide())
        frames += 1
        time.sleep(args.delay)
    print(ui.CLEAR, end="")
    print(ui.render_gameover(game))


def cmd_sim(args):
    results = simulate.run_batch(args.runs, args.floors, base_seed=args.seed)
    simulate.report(results, args.floors)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="roguelike", description="ローグライト MVP")
    sub = ap.add_subparsers(dest="cmd", required=True)

    pp = sub.add_parser("play", help="対話プレイ")
    pp.add_argument("--seed", type=int, default=1)
    pp.add_argument("--weapon", choices=["dagger", "sword", "hammer"], default="sword")
    pp.add_argument("--floors", type=int, default=5)
    pp.add_argument("--line", action="store_true", help="行入力モードを強制")
    pp.set_defaults(func=cmd_play)

    pd = sub.add_parser("demo", help="Bot自動プレイの観賞")
    pd.add_argument("--seed", type=int, default=1)
    pd.add_argument("--weapon", choices=["dagger", "sword", "hammer"], default="sword")
    pd.add_argument("--floors", type=int, default=5)
    pd.add_argument("--build", choices=["power", "poison", "thorns", "sustain", "utility"],
                    default="poison")
    pd.add_argument("--delay", type=float, default=0.08)
    pd.add_argument("--max-frames", type=int, default=2000, dest="max_frames")
    pd.set_defaults(func=cmd_demo)

    ps = sub.add_parser("sim", help="KPIシミュレーション")
    ps.add_argument("-n", "--runs", type=int, default=500)
    ps.add_argument("-f", "--floors", type=int, default=5)
    ps.add_argument("-s", "--seed", type=int, default=1000)
    ps.set_defaults(func=cmd_sim)

    args = ap.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
