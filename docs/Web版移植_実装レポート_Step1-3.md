# Web版移植 実装レポート（Step 1〜3）

設計仕様書_Web版 §25 ロードマップの Step 1〜3 を実装した。ゴールは
**「凍結バランスが TypeScript で動き、Python と数値的に等価であることを検証可能な形で証明する」**。
結論：**TS エンジンは Python と bit 単位で完全一致**（統計的等価を超える完全等価）を達成した。
作業ブランチ `feature/web-ts-engine`。**未コミット**（確認後にコミット/PR）。

---

## 1. サマリ（達成事項）

| 項目 | 結果 |
|---|---|
| Step1: data.json 外部化＋Python を JSON 駆動化 | 完了・**KPI 完全不変**（snapshot digest 一致） |
| Step2: web/ TS 雛形（依存ゼロ） | 完了 |
| Step3: engine.ts 忠実移植＋等価性検証 | 完了・**RNG/結果/トレース/分布 すべて完全一致** |
| 回帰テスト（Python） | 全緑 |
| 等価性テスト（TS, 7件） | 全 pass |
| 分布チェック n=1000（TS） | クリア率 58.5% 等、Python と**完全一致** |

---

## 2. Step 1：data.json 外部化＋Python を JSON 駆動化

### 変更
- **新規 `roguelike/data.json`**：両エンジン共通の数値真値（武器3・レリック17・敵7・spawnTable・run・player）。
  効果の定数（毒+3、反射50%、狂戦士×10 等）を `hooks[].params` に抽出。
- **`roguelike/data.py`**：ハードコードを廃し data.json をロードして `Weapon/Relic/EnemyType/WEAPONS/RELICS/ENEMIES/SPAWN_TABLE/ARCHETYPES` を再構築。
  効果は **`EFFECTS` レジストリ**（effect-id→実装）で params から束ねる。`RUN`/`PLAYER` も公開。
- **`roguelike/engine.py`**：4箇所を data 由来に（Player HP/atk、踏破回復率、スポーン上限 `caps`、フロア数）。値は同一。
- **`pyproject.toml`**：`data.json` を package-data に登録。

### 検証（挙動不変の証明）
- 代表 105 ラン（seed 123/2000〜2005 × 武器3 × ビルド5）の `result()` が**リファクタ前後でバイト完全一致**（SHA256 先頭 `75364ee12865ab2f`、`MATCH baseline: True`）。
- `python -m roguelike sim -n 1000 -s 1000` が baseline と **diff ゼロ**（クリア率 58.5%、死因・ビルド分布すべて同一）。
- `python -m roguelike.tests` 全緑。

---

## 3. Step 2：web/ TS プロジェクト雛形

- `web/`（`package.json` / `tsconfig.json` / `README.md`）。**ランタイム依存ゼロ**。
- Node 22 ネイティブの TS 変換（`--experimental-transform-types`）＋ `node:test` で動作。
  ※ パラメータプロパティ（`constructor(public x...)`）を使うため strip-only では不可、transform-types を採用。Vite は UI（Step 4）で導入予定。
- `web/src/data.ts`：`../../roguelike/data.json` を import し、Python と同一の効果レジストリで構築（**data.json は単一ファイルを共有**＝二重管理なし）。

## 4. Step 3：engine.ts 忠実移植＋等価性検証

### 移植（Python→TS、ロジック・定数・RNG 消費順を厳密ミラー）
- `web/src/rng.ts`：**CPython `random.Random`（MT19937）完全互換**（init_by_array シード、53bit `random()`、`_randbelow`/`choice`/`choices(weights)`/`shuffle`/`randint`）。5ストリーム派生も同一。
- `web/src/world.ts`：制約付き生成＋到達性（generate の randint×4→random の順序を一致）。
- `web/src/engine.ts`：戦闘・毒tick・敵AI6挙動・フック・報酬3択・`result()`。
- `web/src/bot.ts`：BFS・危険推定・報酬選択・rush（探索順／タイブレークを一致）。
- `web/src/trace.ts`：状態シグネチャ（`equivalence.py` と同一定義）。
- Python 側：**`roguelike/equivalence.py`** と **`export-fixture` サブコマンド**を追加（基準データ生成：§24）。

### 等価性の結果（すべて完全一致）

| 検証 | 内容 | 結果 |
|---|---|---|
| RNG bit 一致 | random/randbelow/choice/choices/shuffle ×11 seed | **完全一致** |
| ゴールデン result | 180 ラン（12 seed×3 武器×5 ビルド）の `result()` | **完全一致** |
| ゴールデン trace | 6 ランの**各手番シグネチャ列**（1手単位） | **完全一致** |
| 分布 n=1000 | クリア率 / 平均ターン / ビルド分布 / 死因分布 | **Python と完全一致** |

分布チェック（TS, n=1000, seed=1000）：
```
クリア率   : 58.5% (585/1000)      ← Python 基準と一致
平均ターン : 288.1 / 最短85 / 最長1104
死因       : boss 261 / archer 62 / brute 59 / bat 17 / rat 14 / healer 1 / slime 1
ビルド(クリア): thorns182 / power166 / poison121 / sustain95 / utility21
KPI ASSERT OK ✅（健全帯・5系統勝利・停滞0・死因偏重なし）
```
→ TS は統計的等価（z検定/カイ二乗）を超え、**同一 seed で完全に同一の系列**を生成する。

### CI（`.github/workflows/ci.yml`）
Python 検証の後に、`export-fixture` で基準を再生成 → TS 等価性テスト → TS 分布 assert（n=200）を追加。

---

## 5. 移植中に判明した既存実装の事実（要記録）
- **武器 `defense_mod` は未使用**：`hammer` の `defense_mod=-3` はエンジンのどこからも参照されず no-op。大槌の高勝率（64%）は `atk=7` 由来。data.json には `defMod` として保持（挙動維持のため適用しない）。
- **`venom`（毒の刃）の説明文と実値の不一致**：desc は「毒2」だが実コードは**毒+3**を付与。KPI 維持のため `amount: 3` で確定（文言は将来要修正の候補）。
- **旧ドラフト `docs/data.json`**：ID・効果が `data.py` と不一致（`iron_will` vs `ironwall` 等）。正本を `roguelike/data.json` に一本化したため**削除推奨**（今回は権限の都合で未削除のまま残置）。

---

## 6. 検証手順（再現方法）
```bash
cd -/                                   # リポジトリルート（"-" ディレクトリ）
python -m roguelike.tests               # Python 回帰テスト（全緑）
python -m roguelike sim -n 1000         # KPI が凍結帯
python -m roguelike export-fixture      # TS 基準フィクスチャ生成（web/fixtures）
cd web
node --experimental-transform-types --test "tests/**/*.test.ts"          # 7件 pass
node --experimental-transform-types scripts/sim.ts --n 1000 --seed 1000 --assert-kpi
```

## 7. 変更ファイル一覧
- 変更（tracked）：`roguelike/data.py`, `roguelike/engine.py`, `roguelike/__main__.py`, `pyproject.toml`, `.github/workflows/ci.yml`
- 新規：`roguelike/data.json`, `roguelike/equivalence.py`, `web/`（src 6・tests 2・scripts 1・fixtures 3・README・package.json・tsconfig）

## 8. 次フェーズ（本パス対象外）
- **Step 4〜6**：プレイ画面（3領域・WASD・予兆・ダメプレビュー・ルックモード）→ 報酬3択/死亡画面 → テーマ適用。Vite 導入。
- **テーマ選択**（4候補）：UIパレット＋読み替え設計。Step 4 着手前に決定。
- 後片付け：`docs/data.json`（旧ドラフト）の削除、`web/` の `.gitignore`（node_modules を導入する場合）。
