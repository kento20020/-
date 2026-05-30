# CLAUDE.md — 深淵ローグライト（roguelike-web）

ブラウザで遊べるローグライト。**TypeScript/JS の静的サイト**で、GitHub Pages に置けば
URL を共有するだけで遊べる。数値バランスは `web/data.json` を唯一の真値とし、Node 上の
Bot シミュレーションで KPI を計測して意思決定する。**体感でなく「測ってから決める」**。

## 動かす（まずこれ）
- 遊ぶ（ローカル）: `cd web && npm install && npm run dev` → http://localhost:5173/
- 本番ビルド: `cd web && npm run build`
- 公開: `main` に push すると `.github/workflows/deploy.yml` が GitHub Pages へデプロイ
- 全検証を一括: `cd web && npm run check`（= doctor + test + sim assert + build）

## アーキテクチャ（ファイルが真実）
- エンジン（純ロジック・決定論）: `web/src/engine.ts` / `web/src/world.ts`（生成＋到達性）/ `web/src/rng.ts`（CPython MT19937 互換）/ `web/src/data.ts`（data.json ローダ＋効果レジストリ）
- Bot（シム用AI）: `web/src/bot.ts`（policy = balanced / aggressive / cautious）
- プレイUI（DOM/CSS）: `web/index.html` / `web/src/main.ts` / `web/src/ui/view.ts` / `web/src/ui/telemetry.ts`（localStorage）/ `web/src/styles.css`
- 数値真値: `web/data.json`（武器3・レリック17・敵8〈ボス2種〉・spawnTable・synergyCombos）
- 開発ツール（Node）: `web/scripts/sim.ts`（KPI）/ `web/scripts/report.ts`（人間データ分析）/ `web/scripts/gen-fixtures.ts`（ゴールデン再生成）/ `web/scripts/report-lib.ts` / `web/scripts/batch.ts` / `web/scripts/doctor.ts`
- 回帰テスト: `web/tests/rng.test.ts`（RNG bit一致）/ `web/tests/golden.test.ts`（result・trace の決定論一致）。基準は `web/fixtures/`

## 設計の3本柱（迷ったらここへ戻る）
1. **意味のある選択** — 全選択肢にトレードオフ（「とりあえず強い1択」を作らない）
2. **公平なランダム性** — 予兆（テレグラフ）で回避可能にし、運だけで死なせない
3. **知識が報われる** — 敵パターン・効果を一貫させ学習可能に
詳細は `docs/設計仕様書.md`、運用は `docs/開発運用ガイド.md`、Web移植方針は `docs/設計仕様書_Web版実装仕様.md`。
**要素（武器/レリック効果/敵/敵AI/ボス）の足し方は `docs/拡張ガイド.md`**（敵AIは `web/src/behaviors.ts` のレジストリ、効果は `web/src/data.ts` の EFFECTS に1個足すだけ＝engine 無編集）。

## バランス変更プロトコル（齟齬を出さない鉄則）
バランスは **必ず `web/data.json` だけ**を編集する（エンジンのロジックは変えない＝決定論を保つ）。
1. `web/data.json` を編集
2. `cd web && npm run sim -- --n 1000 --assert-kpi` で健全帯を確認
   （クリア率 35〜65% ／ 5系統すべて勝利 ／ 停滞0 ／ 死因がトラッシュmob偏重でない）
3. `npm run gen-fixtures` でゴールデン基準を再生成（Python不要）
4. `npm run test` が緑
5. `docs/統計レポート_分析.md`・`docs/KPIレポート_1000runs.txt`・`docs/設計仕様書.md` を同じPRで更新
- 単一Botへの過学習を避けるため `npm run sim -- --compare-policies` で複数方策の健全性も見る。
- 新しいレリック/敵は `web/data.json` への追記＋効果レジストリ（`web/src/data.ts`）への効果追加で。

## コマンド早見
- `npm run dev` / `npm run build` / `npm run preview` / `npm run test`
- `npm run sim`（`-- --n 1000 --assert-kpi` / `-- --compare-policies`）
- `npm run report`（`-- --from <results.json> [--compare]`：人間プレイ分析）
- `npm run gen-fixtures`（ゴールデン再生成）
- 分析: `npm run ab`（A/B介入＝因果効果）／`npm run sweep`（ノブ感度）／`npm run ev`（解析EV）／`npm run search`（探索ceiling）／`npm run tune`（自動調整の提案値）。詳細は `docs/分析ツール.md`
- `npm run doctor`（このCLAUDE.md・docsと実体の齟齬チェック）
- `npm run check`（doctor + test + sim assert + build を一括）

## 規約・DoD
- Node >= 22.6。テスト/シムは `--experimental-transform-types`（ランタイム依存ゼロ、ビルドのみ Vite/TS）。
- `main` 直 push 禁止・PR経由。`main` は常に「遊べてテストが通る」。
- ブランチ: `feature/` `fix/` `balance/` `docs/` `chore/`。コミットは `種別: 要約` ＋本文に「なぜ」。
- **変更を終える前に `cd web && npm run check` を緑にする**（Definition of Done）。
- コマンド/アーキテクチャ/KPI を変えたら、このファイル(`CLAUDE.md`)と `docs/` を同じPRで更新する。
  `npm run doctor` が CLAUDE.md の参照切れ（消えた script・ファイル）を自動検出する。

## 現在地（2026-05 時点）
- v0.2 バランス：クリア率 ≈40%（Bot, n=1000）。5系統勝利・停滞0・死因はボス中心。
- 追加：**踏破回復は2段階**（通常 floorClearHeal ／ たまに休憩 restHeal）。**ボスは2種**（深淵の王＝AoE/召喚 ／ 双牙の獣＝近接連撃）をボス階で `run.bossPool` からランダム出現。
- 複数Bot方策（balanced/aggressive/cautious）で 28.7〜54.3% に収まり全方策で5系統が勝利＝過学習小。
- **JS一本化完了**：Python 実装は撤去済み。真値(`web/data.json`)・ロジック・KPIツールはすべて web/ に集約。決定論基準は `web/fixtures/`（`npm run gen-fixtures` で再生成、Python不要）。
- 既知の調整候補：難易度のボス偏重（死因約67%を道中へ分散）、反射(鎧×外殻)・火力(狂×連撃)コンボの弱さ。**人間プレイのデータが集まってから** data 駆動で調整する。
