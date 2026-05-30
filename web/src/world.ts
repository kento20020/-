/**
 * プロシージャル生成（roguelike/world.py の TS 版）。
 * 制約付き生成＋到達可能性（BFS）検証。rng（map ストリーム）の消費順を
 * Python と厳密一致させる（randint×4 →（部屋が既存なら）random() の順）。
 */
import type { PyRandom } from "./rng.ts";

export const WALL = "#";
export const FLOOR = ".";
export const EXIT = ">";

export type Coord = [number, number];

export class Rect {
  constructor(public x: number, public y: number, public w: number, public h: number) {}
  get cx(): number { return this.x + Math.floor(this.w / 2); }
  get cy(): number { return this.y + Math.floor(this.h / 2); }

  intersects(other: Rect, pad = 1): boolean {
    return (
      this.x - pad < other.x + other.w &&
      this.x + this.w + pad > other.x &&
      this.y - pad < other.y + other.h &&
      this.y + this.h + pad > other.y
    );
  }

  *innerTiles(): Generator<Coord> {
    for (let yy = this.y; yy < this.y + this.h; yy++) {
      for (let xx = this.x; xx < this.x + this.w; xx++) yield [xx, yy];
    }
  }
}

export class Level {
  rooms: Rect[] = [];
  start: Coord = [0, 0];
  exit: Coord = [0, 0];
  constructor(public w: number, public h: number, public tiles: string[][]) {}

  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.w && y >= 0 && y < this.h;
  }
  isFloor(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.tiles[y][x] !== WALL;
  }
  floorCells(): Coord[] {
    const out: Coord[] = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.tiles[y][x] !== WALL) out.push([x, y]);
      }
    }
    return out;
  }
}

function newTiles(w: number, h: number): string[][] {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => WALL));
}

function carveRoom(level: Level, room: Rect): void {
  for (const [x, y] of room.innerTiles()) level.tiles[y][x] = FLOOR;
}
function carveH(level: Level, x1: number, x2: number, y: number): void {
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) level.tiles[y][x] = FLOOR;
}
function carveV(level: Level, y1: number, y2: number, x: number): void {
  for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) level.tiles[y][x] = FLOOR;
}

export function reachable(level: Level, src: Coord, dst: Coord): boolean {
  const key = (x: number, y: number) => y * level.w + x;
  const seen = new Set<number>([key(src[0], src[1])]);
  const q: Coord[] = [[src[0], src[1]]];
  let head = 0;
  const dirs: Coord[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (head < q.length) {
    const [x, y] = q[head++];
    if (x === dst[0] && y === dst[1]) return true;
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (level.isFloor(nx, ny) && !seen.has(key(nx, ny))) {
        seen.add(key(nx, ny));
        q.push([nx, ny]);
      }
    }
  }
  return false;
}

export function generate(
  rng: PyRandom, floorNum: number, w = 48, h = 18, maxRooms = 10,
): Level {
  for (let attempt = 0; attempt < 50; attempt++) {
    const level = new Level(w, h, newTiles(w, h));
    const rooms: Rect[] = [];
    for (let i = 0; i < maxRooms; i++) {
      const rw = rng.randint(4, 9);
      const rh = rng.randint(3, 6);
      const rx = rng.randint(1, w - rw - 1);
      const ry = rng.randint(1, h - rh - 1);
      const cand = new Rect(rx, ry, rw, rh);
      if (rooms.some((r) => cand.intersects(r))) continue;
      carveRoom(level, cand);
      if (rooms.length > 0) {
        const prev = rooms[rooms.length - 1];
        const px = prev.cx, py = prev.cy;
        if (rng.random() < 0.5) {
          carveH(level, px, cand.cx, py);
          carveV(level, py, cand.cy, cand.cx);
        } else {
          carveV(level, py, cand.cy, px);
          carveH(level, px, cand.cx, cand.cy);
        }
      }
      rooms.push(cand);
    }

    if (rooms.length < 3) continue;

    level.rooms = rooms;
    level.start = [rooms[0].cx, rooms[0].cy];
    const ex = rooms[rooms.length - 1].cx, ey = rooms[rooms.length - 1].cy;
    level.exit = [ex, ey];
    level.tiles[ey][ex] = EXIT;

    if (reachable(level, level.start, level.exit)) return level;
  }

  // フォールバック（保険）：1部屋直線マップ。
  const level = new Level(w, h, newTiles(w, h));
  carveRoom(level, new Rect(2, 2, w - 4, h - 4));
  level.rooms = [new Rect(2, 2, w - 4, h - 4)];
  level.start = [4, Math.floor(h / 2)];
  level.exit = [w - 5, Math.floor(h / 2)];
  level.tiles[Math.floor(h / 2)][w - 5] = EXIT;
  return level;
}
