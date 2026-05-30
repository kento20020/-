"""プロシージャル生成（設計仕様書 §4.1, §11）。

方針は「制約付き生成」：完全ランダムではなく、必須要素（入口・出口）
を保証し、生成直後に経路探索（BFS）で到達可能性を検証する。
クリア不能なシードは破棄して作り直すため、運だけで詰むことがない。
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

WALL = "#"
FLOOR = "."
EXIT = ">"


@dataclass
class Rect:
    x: int
    y: int
    w: int
    h: int

    @property
    def cx(self) -> int:
        return self.x + self.w // 2

    @property
    def cy(self) -> int:
        return self.y + self.h // 2

    def intersects(self, other: "Rect", pad: int = 1) -> bool:
        return (self.x - pad < other.x + other.w and
                self.x + self.w + pad > other.x and
                self.y - pad < other.y + other.h and
                self.y + self.h + pad > other.y)

    def inner_tiles(self):
        for yy in range(self.y, self.y + self.h):
            for xx in range(self.x, self.x + self.w):
                yield xx, yy


@dataclass
class Level:
    w: int
    h: int
    tiles: list = field(default_factory=list)
    rooms: list = field(default_factory=list)
    start: tuple = (0, 0)
    exit: tuple = (0, 0)

    def in_bounds(self, x, y):
        return 0 <= x < self.w and 0 <= y < self.h

    def is_floor(self, x, y):
        return self.in_bounds(x, y) and self.tiles[y][x] != WALL

    def floor_cells(self):
        return [(x, y) for y in range(self.h) for x in range(self.w)
                if self.tiles[y][x] != WALL]


def _carve_room(level: Level, room: Rect):
    for x, y in room.inner_tiles():
        level.tiles[y][x] = FLOOR


def _carve_h(level: Level, x1, x2, y):
    for x in range(min(x1, x2), max(x1, x2) + 1):
        level.tiles[y][x] = FLOOR


def _carve_v(level: Level, y1, y2, x):
    for y in range(min(y1, y2), max(y1, y2) + 1):
        level.tiles[y][x] = FLOOR


def _reachable(level: Level, src, dst) -> bool:
    """src から dst へ4方向移動で到達可能か（生成バリデーション）。"""
    seen = {src}
    q = deque([src])
    while q:
        x, y = q.popleft()
        if (x, y) == dst:
            return True
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if level.is_floor(nx, ny) and (nx, ny) not in seen:
                seen.add((nx, ny))
                q.append((nx, ny))
    return False


def generate(rng, floor_num: int, w: int = 48, h: int = 18,
             max_rooms: int = 10) -> Level:
    """1フロア分の地形を生成。到達可能性を保証して返す。"""
    for _attempt in range(50):
        level = Level(w, h, tiles=[[WALL] * w for _ in range(h)])
        rooms: list[Rect] = []
        for _ in range(max_rooms):
            rw = rng.randint(4, 9)
            rh = rng.randint(3, 6)
            rx = rng.randint(1, w - rw - 1)
            ry = rng.randint(1, h - rh - 1)
            cand = Rect(rx, ry, rw, rh)
            if any(cand.intersects(r) for r in rooms):
                continue
            _carve_room(level, cand)
            # 直前の部屋とL字通路で接続（接続グラフを連結に保つ）。
            if rooms:
                px, py = rooms[-1].cx, rooms[-1].cy
                if rng.random() < 0.5:
                    _carve_h(level, px, cand.cx, py)
                    _carve_v(level, py, cand.cy, cand.cx)
                else:
                    _carve_v(level, py, cand.cy, px)
                    _carve_h(level, px, cand.cx, cand.cy)
            rooms.append(cand)

        if len(rooms) < 3:
            continue

        level.rooms = rooms
        level.start = (rooms[0].cx, rooms[0].cy)
        ex, ey = rooms[-1].cx, rooms[-1].cy
        level.exit = (ex, ey)
        level.tiles[ey][ex] = EXIT

        # 必須要素の到達性を検証。満たさなければ作り直す。
        if _reachable(level, level.start, level.exit):
            return level

    # 50回失敗時のフォールバック（保険）：1部屋直線マップ。
    level = Level(w, h, tiles=[[WALL] * w for _ in range(h)])
    _carve_room(level, Rect(2, 2, w - 4, h - 4))
    level.rooms = [Rect(2, 2, w - 4, h - 4)]
    level.start = (4, h // 2)
    level.exit = (w - 5, h // 2)
    level.tiles[h // 2][w - 5] = EXIT
    return level
