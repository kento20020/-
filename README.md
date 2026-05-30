# Roguelite Game — リポジトリ

プロシージャル生成・パーマデス・メタ進行を備えたローグライトを開発するリポジトリ。
設計仕様 → 実装 → KPI計測 → 調整、のループを回しながら育てる。

## クイックスタート
```bash
# 遊ぶ（端末。w/a/s/d=移動・攻撃, .=待機, q=終了）
python3 -m roguelike play --line --weapon sword

# Botの自動プレイを観賞（動作確認）
python3 -m roguelike demo --build poison

# KPI統計（面白さをデータで裏取り）
python3 -m roguelike sim -n 1000

# 回帰テスト
python3 -m roguelike.tests
```
依存はなし（Python 3.8+ 標準ライブラリのみ）。詳しい遊び方は [`roguelike/README.md`](./roguelike/README.md)。

## リポジトリ構成
```
.
├── README.md                  ← このファイル（入口）
├── pyproject.toml             ← パッケージ定義・メタデータ
├── roguelike/                 ← ゲーム本体（Pythonパッケージ）
│   ├── rng / data / world / engine / bot / ui / simulate / tests
│   └── README.md              ← 遊び方・モジュール解説
└── docs/                      ← ドキュメント
    ├── 設計仕様書.md           ← 設計の最上位（3本柱とKPIが判断基準）
    ├── 統計レポート_分析.md     ← KPI計測と調整の記録
    ├── KPIレポート_1000runs.txt ← simの生出力（再生成可能）
    ├── 開発運用ガイド.md        ← ★ブランチ運用・開発フロー（最初に読む）
    └── archive/               ← 本ゲームとは無関係の過去の検討（保管）
        └── 業種選定プロセス/    ← 事業アイデアの思考演習。経緯保存のため残置
```

## 開発の進め方（要点）
- **`main` は常に「遊べる・テストが通る」状態を保つ**。直接 push しない。
- 作業は用途別のブランチを切り、**Pull Request 経由で `main` にマージ**する。
- 仕様・バランスで迷ったら **設計仕様書の「3本柱」と「KPI」** に立ち返る。
- バランス変更は感覚でなく **`sim` のKPI** を根拠にする。

詳細なルールは [`docs/開発運用ガイド.md`](./docs/開発運用ガイド.md) を参照。
