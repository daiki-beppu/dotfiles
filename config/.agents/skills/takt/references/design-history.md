# 設計根拠と過去の実測

仕様の根拠やバージョン差異を調べる場合に読む。以下は SKILL.md から分離した過去の記録で、現行のレーンや API の保証ではない。通常の投入は SKILL.md の条件と [enqueue.md](enqueue.md) に従う。

## intake と step fragment

- **intake を持つレーンでは issue が実質必須**。takt 本体は issue 番号が無くても
  `{ exists: false }` を返すだけでエラーにしない(`DefaultSystemStepServices` の `issue_context`)。
  blocked にするのは workflow 側の規約で、yt-auto-* / tayk-* の intake は「issue 番号を確定
  できない実行は blocked」を明示している。order.md だけ渡すと 3 回とも blocked →
  auto_requeue 上限(2/2)で failed する(実装には一切入らない)。builtin の `simple-*` には
  intake が無いのでこの制約もかからない
- **intake の組み込み方は 2 通りある**。`kind: workflow_call` で別 workflow を呼ぶ形と、
  0.55.0 で入った step fragment(`uses: intake` で `.takt/steps/intake.yaml` を展開)の形。
  **後者は `.takt/workflows/` に出てこない**ので、レーン一覧に `*-intake` が無いことを
  「intake 無し」と読み違えない(実測: `00-automation` は fragment 形式、
  `youtube-automation` / `tayk` は workflow 形式)

## 過去のレーン構成

実測(2026-08-04 時点):

| リポジトリ | プロジェクト固有レーン | 選択軸 |
| --- | --- | --- |
| `~/ghq/github.com/daiki-beppu/tayk` | `tayk-{audit-architecture,audit-runs,feature,fix,intake}` (5) | 意図別 |
| `~/ghq/github.com/daiki-beppu/youtube-automation` | `yt-auto-*` + `audit-unit-split` | 意図別 |
| `~/ghq/github.com/daiki-beppu/libecity` | `article-rewrite` / `knowhow-article` | 成果物別 |
| `~/ghq/github.com/daiki-beppu/{dotfiles,takt,specv}` | 無し(builtin のみ) | スタック × 深度 |

**本数が減ってもレーンの廃止とは限らない**。`youtube-automation` は 2026-08-01 時点で 8 本だったが、
0.55.0 の step fragment 化で `.takt/steps/` へ移った分だけ `.takt/workflows/` から消えている
(実測: `intake.yaml` が `.takt/steps/` にあり、各レーンが `uses: intake` で展開している。
review 系も `reviewers.yaml` / `design-review.yaml` などとして同じ場所にある)。
**投入対象として選べるレーンが減った**のは事実だが、機能が消えたわけではない。

レーン構成は更新で変わり得るため、表だけで判断せず、
**作業ディレクトリの `.takt/workflows/` を直接見る**。

`.takt/steps/` は 0.55.0 で入った再利用可能な単一ステップ部品(`uses: <name>` で展開される)。
探索先は `.takt/steps/` / `~/.takt/steps/` / builtin `steps/` / repertoire パッケージの `steps/`
の 4 か所で、**レーンとしては投入できない**。一覧に出てこない機能がレーンに埋まっていることの
説明になるので、「思ったより本数が少ない」ときはここを見る。

## callable の拒否タイミング

**投入は素通りする。落ちるのは run のとき**。`determineWorkflow` は callable を弾かず
そのまま tasks.yaml に積み(実測)、`WorkflowEngine` の構築時に初めて
`Configuration error: callable workflow "<name>" must be started from a workflow_call` を投げる。
つまり**存在しないレーン名と違って積んだ時点では気づけない**ので、ここで確認する。

プロジェクト固有レーンでは `intake` / `impl-review` が該当しがち(`00-automation` のように
step fragment に移行済みのものはそもそも一覧に出ない)。

## なぜ CLI ではなく内部 API なのか

`takt add` の対話は**グローバル option では 1 つも埋められない**。`addTask` が読むのは
`opts.workflow` と `opts.prNumber` だけで、worktree 設定は必ず `promptWorktreeSettings(cwd)`
から取るため、**`-b` / `--auto-pr` / `--draft` を渡しても捨てられる**。

`TAKT_NO_TTY=1`(`shared/prompt/tty.js` の公式分岐)を立てれば `promptInput` は `null`、
`confirm` は既定値かパイプ入力を返すので対話ゼロにはなる。だが **`promptInput` はパイプを
読まないので `Branch name` だけが auto に固定される**(`confirm` にはパイプ経路があるのに
`promptInput` には無い、takt 側の非対称)。`script(1)` で疑似 TTY を与える手は、入力が
先読みされて EOF で落ちるため成立しない(実測)。gh-stack 前提で branch を指定する運用では
どれも足りないので、`saveEnqueuedTaskFile` を直接呼ぶ。

## 内部 API の検証記録

**0.62.0 で検証済み**: [enqueue.md](enqueue.md) の投入レシピにある3つの import パスと引数の形はそのまま通る(実測)。`SaveEnqueuedTaskFileOptions` は
`managedPr` / `shouldPublishBranchToOrigin` / `contextPrNumber` が増えたが、いずれも
省略時は従来の挙動だったため、当時の投入レシピの変更は不要だった。

## 既存 PR への積み増しの根拠

- `clone.js::createSharedClone` の分岐順は **リモートに同名ブランチあり → clone して origin から
  fetch → `checkout -B`** が最優先。メインチェックアウトの HEAD やローカルブランチに依存しないので、
  メインが別ブランチにいても起点は push 済みの PR HEAD に確定する
- `postExecution.js` は完了後に `findExistingPr(branch)` を引き、見つかれば新規作成せず
  **push + PR へのコメント追記**で終わる(`gh pr create` の重複エラーにはならない)
- `activeTaskTarget.js::findActiveTaskTargetConflict` の競合判定対象は **pending / running のみ**。
  同じ branch の completed タスクが既にあっても積める
