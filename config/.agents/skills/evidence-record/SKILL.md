---
name: evidence-record
description: 実行時に指示されたブラウザ操作を、playwright-cli の screencast でステップタイトル付き動画（カーソル/クリック強調つき）として録画する。スクリプトと動画は ~/Downloads 配下の専用ディレクトリに出力し、誤コミットを防ぐ。/evidence-record で起動します。
allowed-tools: Bash(playwright-cli:*) Bash(ni:*) Bash(node:*) Bash(ffmpeg:*) Bash(ffprobe:*) Bash(mkdir:*) Bash(rm:*) Bash(ls:*) Bash(date:*) Bash(open:*)
---

# evidence-record — ブラウザ操作のエビデンス動画を撮る

`/evidence-record <録画したい操作の自由記述>` で起動する。
指示された操作を `playwright-cli` の `page.screencast` で録画し、**ステップタイトル付き・疑似カーソル/クリック強調つき**の動画にする。
出力（スクリプトと動画）は **`~/Downloads/evidence-record-<timestamp>/`** にまとめて置く。
作業ツリーの外なので**リポジトリに誤ってコミットされない**。

このスキルの役割は「何を撮るか（diff解析・PR添付・dev server起動）」ではなく、**指示された操作をきれいな動画にすること**に限定する。

## 同梱ファイル
- `scripts/recorder-helpers.md` … 生成スクリプトの先頭に **inline する正典ヘルパー**（step帯 / 疑似カーソル / clickFx / fillFx）。
- `scripts/example-evidence.mjs` … 生成結果の**完成例**（TodoMVC を題材）。雛形としてこれを真似る。

---

## 手順

### 0. 前提チェック
- `playwright-cli` が使えるか確認する。
  ```bash
  playwright-cli --version
  ```
  無ければ導入する（このスキルは playwright-cli に依存する）。
  ```bash
  ni -g @playwright/cli@latest
  ```
- `ffmpeg` が無ければ mp4 化はスキップし webm のみ案内する。

### 1. 操作をセットアップとテストステップに仕分けて提示
- 起動時の引数、または起動後の指示から「録画する操作」を読み取る。
- まず操作を **2 種類に仕分ける**:
  - **セットアップ（録画しない前準備）**: ログイン・Cookie 同意・テスト開始画面までの初期ナビなど、テスト本体に関係ない前準備。**動画には含めない**（実行はするがカメラを回す前に済ませる）。
  - **録画するテストステップ**: エビデンスとして残したい本題の操作。最初のステップは通常「テスト対象画面での最初の操作」。
- 録画する操作を**ステップに分解**し、各ステップに短いタイトルと説明を付ける。
- ステップ一覧（番号・タイトル・操作の要点）を**箇条書きでユーザーに提示してから**録画に進む。**どれがセットアップ（録画対象外）か**も明記する。
- 各ステップの**最後の操作を「確認項目」**にする（`waitFor`/可視チェック等）。ここが落ちたら撮影中断になる。

### 2. 出力ディレクトリを作る
```bash
OUT="$HOME/Downloads/evidence-record-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
```
以降 `run.mjs` / `evidence.webm` / `evidence.mp4` / `fail.png` は**すべて `$OUT` 配下（絶対パス）**に置く。

### 3. 録画スクリプト `$OUT/run.mjs` を生成
- **`scripts/recorder-helpers.md` のコードブロック（ヘルパー前文）を、`run.mjs` の `async page => {` 直後にそのまま inline する**（run-code はモジュール解決が不安定なので import しない）。
- 続けて本体を書く。骨格と書き方は `scripts/example-evidence.mjs` に従う。要点:
  - `EVREC.total` に **録画する `step()` の数だけ**を入れる（プリアンブルは数えない）。
  - `globalThis.__EVREC_FAIL_PNG__ = "<OUT>/fail.png"`（**絶対パス**）。
  - `await page.setViewportSize({ width: 1280, height: 800 })` … 揃えないと下部に灰色余白が出る。`screencast.start()` より前に置く。
  - **プリアンブル（ログイン等の録画しない前準備）は `screencast.start()` の前に `await setup(page, "ラベル", async () => { … })` で実行する**。`page.screencast` に pause は無いので、映したくない操作は録画開始前に済ませる。前準備が無ければ省略してよい。
  - `await page.screencast.start({ path: "<OUT>/evidence.webm", size: { width:1280, height:800 } })`（**絶対パス**）を最初のテストステップの直前で呼ぶ。
  - 各ステップ = `await step(page, n, "タイトル", "説明", async () => { 操作 + 確認 })`。
    - `step()` が **showChapter（章カード）→ sticky 帯 → 操作** を行い、操作が throw したら撮影を止めて投げ直す。
  - クリックは `clickFx(page, locator)`、入力は `fillFx(page, locator, text)` を使う（カーソル/波紋/ハイライトが付く）。
  - ロケータは `getByRole` / `getByText` 等の堅牢なものを優先。CSS セレクタは最終手段。
  - 末尾で `await page.screencast.stop()`。
- `<OUT>` はすべて実際の `$OUT` の絶対パスに置換すること。

### 4. クリーンセッションで録画する（重要）
`playwright-cli` のブラウザ/ページは `run-code` をまたいで生き続け、**screencast オーバーレイが前回実行分まで蓄積**する（帯やカーソルが二重に映る）。
必ず**開き直してから**録画する。
```bash
playwright-cli close   # 失敗は無視してよい
playwright-cli open
playwright-cli run-code --filename="$OUT/run.mjs"
```

### 5. 結果判定
- 出力に **`SETUP FAILED`**（録画開始前の前準備での失敗）が出た場合 → **撮影中断**。
  - `evidence.webm` は生成されていない。どの前準備で落ちたか・エラー要旨・`$OUT/fail.png` のパスを報告する。**mp4 化はしない**。
- 出力に **`STEP n FAILED` / `Error`** が出た、または `$OUT/fail.png` が生成された場合 → **撮影中断**。
  - どのステップで落ちたか・エラー要旨・`$OUT/fail.png` のパスをユーザーに報告する。
  - `run.mjs` と途中の `evidence.webm` は `$OUT` に残し、原因調査に使えると伝える。**mp4 化はしない**。
- 成功（`fail.png` が無く `evidence.webm` がある）→ 次へ。

### 6. mp4 変換 ＋ 報告
```bash
ffmpeg -y -i "$OUT/evidence.webm" -movflags +faststart -pix_fmt yuv420p "$OUT/evidence.mp4"
```
- 完了を報告し、`$OUT`（`run.mjs` / `evidence.webm` / `evidence.mp4`）のパスを示す。
- `open "$OUT"` で Finder に表示する（任意）。
- **「出力はすべて ~/Downloads 配下なのでリポジトリにはコミットされない」**ことを明記する。

---

## 実測で判明した落とし穴（必ず守る）
1. **クリーンセッション必須**: 録画直前に `playwright-cli close && open`。怠ると前回のオーバーレイが残る。
2. **絶対パス必須**: `playwright-cli` は自前 cwd で動く。相対パスだと webm/png が行方不明。
3. **`setViewportSize` で録画サイズと一致**: 揃えないと下部に灰色帯。
4. **アプリの状態を冪等に**: 必要なら開始時に `localStorage.clear()` 等でクリーンな初期状態にする。
5. **映したくない操作は録画開始前に**: ログイン等は `screencast.start()` の前に `setup()` で実行する。`page.screencast` に pause は無いので、start 後の操作はすべて動画に残る。

## スコープ外
diff からの確認項目自動生成、dev server 自動検出・起動、PR への動画添付は行わない（指示された操作の録画に専念する）。

## Source

vendored from [dninomiya/evidence-record](https://github.com/dninomiya/evidence-record)（MIT）。アップデートを取り込む場合は上流を再確認して手動でマージする。
