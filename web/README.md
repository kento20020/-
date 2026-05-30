# roguelike-web（TypeScript エンジン）

Python 版（`../roguelike/`）の**忠実移植**。数値真値は `../roguelike/data.json` を共有し、
Python と **bit 単位で等価**であることを自動検証する（設計仕様書_Web版 §19・§24）。

このディレクトリは現在 **エンジン＋等価性検証（Step 1〜3）** まで。プレイ画面（UI）は
次フェーズ（Step 4〜6・Vite 導入）。

## 必要環境
- Node.js >= 22.6（`--experimental-transform-types` を使用。依存パッケージはゼロ）

## 構成
```
web/
├── src/
│   ├── rng.ts      … CPython random.Random（MT19937）完全互換
│   ├── data.ts     … ../roguelike/data.json ローダ＋効果レジストリ
│   ├── world.ts    … 制約付きマップ生成＋到達性
│   ├── engine.ts   … 戦闘・敵AI・フック・報酬・result（engine.py 移植）
│   ├── bot.ts      … 統計用ヒューリスティックAI（bot.py 移植）
│   └── trace.ts    … 状態シグネチャ（equivalence.py と同一定義）
├── tests/
│   ├── rng.test.ts     … RNG が Python と 1bit 一致
│   └── golden.test.ts  … result/trace が Python と完全一致
├── scripts/sim.ts      … 分布チェック（KPI が健全帯・5系統勝利・停滞0）
└── fixtures/           … Python が生成する基準データ（再生成可）
```

## 使い方
```bash
# 基準フィクスチャを Python から（再）生成
cd ..
python -m roguelike export-fixture --out web/fixtures

# 等価性テスト（RNG / result / trace）
cd web
node --experimental-transform-types --test "tests/**/*.test.ts"

# 分布チェック（n=1000、KPI を検証）
node --experimental-transform-types scripts/sim.ts --n 1000 --seed 1000 --assert-kpi
```

## 等価性の原則（重要）
- **バランス調整は必ず Python 側で**行い、`data.json` を変更 → Python sim で再検証する。
- TS 側はロジックを変えない（UI 接続のみ）。`data.json` は Python と同一ファイルを参照。
- 数値を変えたら `export-fixture` で基準を作り直し、TS テストで一致を再確認する。
