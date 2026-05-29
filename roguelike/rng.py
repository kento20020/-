"""乱数生成器（RNG）をシステム別に分離する（設計仕様書 §11）。

同一シードで同一の結果を再現できるよう、用途ごとに独立した
random.Random インスタンスを持つ。これにより「マップ生成は同じ
だがドロップだけ変えて検証する」といったデバッグも容易になる。
"""
from __future__ import annotations

import random


class GameRNG:
    """1ラン分の乱数源。用途別ストリームに分離する。"""

    def __init__(self, seed: int):
        self.seed = seed
        # 用途ごとに異なる派生シードを与え、ストリームを独立させる。
        self.map = random.Random(seed * 2 + 1)
        self.spawn = random.Random(seed * 3 + 7)
        self.loot = random.Random(seed * 5 + 13)
        self.combat = random.Random(seed * 7 + 17)
        self.ai = random.Random(seed * 11 + 23)

    def __repr__(self) -> str:
        return f"GameRNG(seed={self.seed})"
