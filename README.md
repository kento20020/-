# 深淵ローグライト — リポジトリ

ブラウザで遊べるローグライト（**TypeScript/JS の静的サイト**）。プロシージャル生成・パーマデス・
メタ進行。設計 → 実装 → KPI計測 → 調整のループで育てる。**開発ガイドはまず [`CLAUDE.md`](./CLAUDE.md) を読む。**

## クイックスタート
```bash
cd web
npm install
npm run dev      # 遊ぶ → http://localhost:5173/ （WASD/矢印=移動・攻撃, Space=待機）
npm run check    # 全検証（doctor + テスト + KPI + ビルド）
npm run sim -- --n 1000 --assert-kpi   # KPIシミュレーション
```
ランタイム依存ゼロ（ビルドの Vite/TS のみ）。Node >= 22.6。

## 公開（GitHub Pages）
`main` に push → `.github/workflows/deploy.yml` が Pages へデプロイ →
`https://kento20020.github.io/-/` で誰でも遊べる（要：Settings → Pages → Source = GitHub Actions）。

## リポジトリ構成
```
.
├── CLAUDE.md          ← ★開発ガイド（最初に読む）
├── web/               ← ゲーム本体（TypeScript）
│   ├── src/           … engine / world / rng / data / bot ＋ ui（プレイ画面）
│   ├── scripts/       … sim(KPI) / report(人間データ分析) / gen-fixtures / doctor
│   ├── tests/ fixtures/ … 決定論リグレッション（RNG bit一致・result/trace 一致）
│   └── data.json      … 数値真値（武器・レリック・敵・spawn・synergyCombos）
├── .github/workflows/ … ci.yml / deploy.yml
└── docs/              ← 設計仕様・KPI記録（設計の経緯。日本語）
```

## 開発の進め方（要点）
- **`main` は常に「遊べてテストが通る」**。直接 push せず **PR 経由**。
- バランスは **`web/data.json` だけ**編集 → `npm run sim -- --assert-kpi` で健全帯確認 →
  `npm run gen-fixtures` → `npm run test` 緑 → `docs/` 更新。
- 迷ったら設計の3本柱（意味のある選択／公平なランダム性／知識が報われる）。
- **変更を終える前に `cd web && npm run check`**。詳細は [`CLAUDE.md`](./CLAUDE.md)。
