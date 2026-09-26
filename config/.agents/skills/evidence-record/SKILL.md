---
name: evidence-record
description: 指示されたブラウザ操作を playwright-cli の screencast でステップタイトル付き動画に録画し、GitHub PR に添付する。動画はローカルに残さない。
allowed-tools: Bash(playwright-cli:*) Bash(ni:*) Bash(node:*) Bash(ffmpeg:*) Bash(ffprobe:*) Bash(gh:*) Bash(mktemp:*) Bash(test:*) Bash(mkdir:*) Bash(rm:*) Bash(ls:*)
---

# evidence-record — ブラウザ操作のエビデンス動画を PR に添付する

`/evidence-record <録画したい操作の自由記述>` で起動する。
指示された操作を `playwright-cli` の `page.screencast` で録画し、**ステップタイトル付き・疑似カーソル/クリック強調つき**の動画にして、対象 PR の本文へ `gh pr edit --attach` で添付する。
録画は一時ディレクトリで行い、**添付を確認したら削除する**。動画の保存先は PR 上の添付 URL だけになる。

このスキルの役割は**指示された操作をきれいな動画にして PR に載せること**に限定する。何を撮るかの判断（diff 解析）や dev server の起動は呼び出し側が行う。

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
- `ffmpeg` が無ければ mp4 化はスキップし webm を添付する。
- 添付先 PR を確定する。指定が無ければ現ブランチの PR を使い、PR が無ければ**録画せずに止める**（ローカルに動画だけ残る状態を作らない）。
  ```bash
  gh pr view [<PR番号>] --json number,url,headRefOid
  ```
- `gh pr edit --help` に `--attach` があるか確認する（GitHub CLI 2.99.0 以上）。無ければ録画前に止めて更新を案内する。添付にはリポジトリへの push 権限が要る。GitHub Enterprise Server は未対応。

### 1. 操作をセットアップとテストステップに仕分けて提示
- 起動時の引数、または起動後の指示から「録画する操作」を読み取る。
- まず操作を **2 種類に仕分ける**:
  - **セットアップ（録画しない前準備）**: ログイン・Cookie 同意・テスト開始画面までの初期ナビなど、テスト本体に関係ない前準備。**動画には含めない**（実行はするがカメラを回す前に済ませる）。
  - **録画するテストステップ**: エビデンスとして残したい本題の操作。最初のステップは通常「テスト対象画面での最初の操作」。
- 録画する操作を**ステップに分解**し、各ステップに短いタイトルと説明を付ける。
- ステップ一覧（番号・タイトル・操作の要点）を**箇条書きでユーザーに提示してから**録画に進む。**どれがセットアップ（録画対象外）か**も明記する。
- 各ステップの**最後の操作を「確認項目」**にする（`waitFor`/可視チェック等）。ここが落ちたら撮影中断になる。

### 2. 一時ディレクトリを作る
```bash
OUT="$(mktemp -d "${TMPDIR:-/tmp}/evidence-record.XXXXXX")"
```
以降 `run.mjs` / `evidence.webm` / `evidence.mp4` / `fail.png` / `body.md` は**すべて `$OUT` 配下（絶対パス）**に置く。作業ツリーの外なのでリポジトリにコミットされない。

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
  - `run.mjs` と途中の `evidence.webm` は原因調査用に一時ディレクトリへ残す。**mp4 化も PR 添付もしない**。
- 成功（`fail.png` が無く `evidence.webm` がある）→ 次へ。

### 6. mp4 変換と動画の確認
```bash
ffmpeg -y -i "$OUT/evidence.webm" -movflags +faststart -pix_fmt yuv420p "$OUT/evidence.mp4"
test -s "$OUT/evidence.mp4" && ffprobe -v error -show_entries format=duration,size -of json "$OUT/evidence.mp4"
```
- 動画を再生して、期待結果と機密情報の映り込みが無いことを確認する。
- 添付上限は Free 10 MB、有料プラン 100 MB。超える場合は添付せず、サイズと対処（ステップの分割・短縮）を報告する。

### 7. PR に添付する
既存本文を `$OUT/body.md` に取得し、`## 動画エビデンス` 欄だけを追加または置換する（再実行で欄を重複させない。他の本文は保持する）。欄にはステップ一覧・録画した commit SHA と、**独立した段落**の `![](<動画の絶対パス>)` を置く。単独段落でないと動画プレイヤーにならない。
```bash
gh pr view <PR番号> --json body --jq .body > "$OUT/body.md"
# body.md の「## 動画エビデンス」欄を編集してから:
gh pr edit <PR番号> --body-file "$OUT/body.md" --attach "$OUT/evidence.mp4"
```
本文の参照と `--attach` には同じパスを渡す。gh がアップロードしてローカルパスを添付 URL に置き換える。

`gh pr view <PR番号> --json body` で本文にローカルパスが残らず添付 URL に置き換わったことを確認する。

### 8. 後始末と報告
- 添付を確認できたら `rm -rf "$OUT"` で一時ディレクトリを削除する。
- PR URL・添付 URL・録画した commit SHA・ステップ一覧を報告する。
- 添付に失敗したら一時ディレクトリを残し、エラーと `$OUT` のパスを報告する（再添付に使える）。

---

## 実測で判明した落とし穴（必ず守る）
1. **クリーンセッション必須**: 録画直前に `playwright-cli close && open`。怠ると前回のオーバーレイが残る。
2. **絶対パス必須**: `playwright-cli` は自前 cwd で動く。相対パスだと webm/png が行方不明。
3. **`setViewportSize` で録画サイズと一致**: 揃えないと下部に灰色帯。
4. **アプリの状態を冪等に**: 必要なら開始時に `localStorage.clear()` 等でクリーンな初期状態にする。
5. **映したくない操作は録画開始前に**: ログイン等は `screencast.start()` の前に `setup()` で実行する。`page.screencast` に pause は無いので、start 後の操作はすべて動画に残る。

## スコープ外
diff からの確認項目自動生成、dev server 自動検出・起動は行わない（指示された操作の録画と PR 添付に専念する）。

## Source

vendored from [dninomiya/evidence-record](https://github.com/dninomiya/evidence-record)（MIT）。アップデートを取り込む場合は上流を再確認して手動でマージする。
