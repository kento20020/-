/**
 * 状態シグネチャ（roguelike/equivalence.py の sig() と同一定義）。
 * 各手番の状態を一意な文字列にし、Python との 1手単位の一致を検証する。
 */
import type { Game } from "./engine.ts";

export function sig(g: Game): string {
  const p = g.player;
  const head = `${g.floorNum}|${g.turn}|${g.state}|${p.x},${p.y}|${p.hp}/${p.maxHp}|${p.attack}|${p.defense}`;
  const body = g.enemies
    .filter((e) => e.alive)
    .map((e) => `${e.etype.id},${e.x},${e.y},${e.hp},${e.poison},${e.telegraph ? 1 : 0}`)
    .join(";");
  return head + "#" + body;
}
