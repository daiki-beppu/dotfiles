# 非対話の投入

起票済み issue を投入するときに読む。以下は takt 0.68.0 で確認したもの。現行版の MCP の入力と CLI を照合し、互換性を確認できない場合は fallback を使う。

**`takt add` は使わない**。ユーザーに 6 問のプロンプトを手入力させる代わりに、
takt MCP の `takt_enqueue_task` で対話ゼロで積む。

### MCP が代わりにやらないこと

`takt_enqueue_task` は渡された値をそのまま `tasks.yaml` に保存する。`takt add` が持っていた次の処理は
無いので、呼ぶ前に自分で済ませる。

- **workflow の検証**。`cd <repo_root> && takt workflow doctor <workflow>` を通す。存在しない名前は
  exit 1(`Workflow not found`)、定義が壊れていても落ちる。省くと、**存在しないレーン名がそのまま
  tasks.yaml に積まれ**、runner が拾うまで気付けない。doctor は callable な部品を通すので、
  [workflow-catalog.md](workflow-catalog.md) の callable 確認も通す
- **issue 本文の取得**。`issue.number` は紐付けるだけで本文を取らない。`task` に次の出力を入れる
  (takt の `resolveIssueTask` と同じ形式)。自前の要約に替えると「issue が仕様の正本」が崩れる

  ```sh
  gh issue view <N> --json number,title,body,labels,comments --jq '
    ["## Issue #\(.number): \(.title)"]
    + (if .body != "" then ["", .body] else [] end)
    + (if (.labels | length) > 0 then ["", "### Labels", (.labels | map(.name) | join(", "))] else [] end)
    + (if (.comments | length) > 0 then ["", "### Comments"] + (.comments | map("**\(.author.login)**: \(.body)")) else [] end)
    | join("\n")'
  ```

- **base の実在確認**。`taskContext.baseBranch` は書式しか見ない。渡す前に `git rev-parse --verify <base>` を通す

### 投入

`takt_enqueue_task` を次の入力で呼ぶ。

```json
{
  "cwd": "<repo_root の絶対パス>",
  "task": "<上の jq の出力>",
  "workflow": "<doctor を通した workflow>",
  "worktree": true,
  "autoPr": true,
  "issue": { "number": <N> },
  "taskContext": { "branch": "<branch>", "baseBranch": "<base>" }
}
```

- **`worktree: true` は省略時の既定だが明示する**。落とすと run が隔離クローンを作らず、worktree 必須の規約が崩れる
- `autoPr` は必須。`--no-auto-pr` のときだけ `false`
- `taskContext` は branch / base を指定するときだけ入れる。空なら takt が自動で決める
- **`cwd` は MCP を起動したリポジトリの配下に限られる**(`takt-mcp-root` がメインチェックアウトを
  許可範囲にする)。別リポジトリの issue は、そのリポジトリで動くセッションから積む

### draft は repo の設定で決まる

MCP の入力に draft の指定は無く、repo の `.takt/config.yaml` の `draft_pr` に従う。`--draft` を
受けたら、その repo の `draft_pr` を確認する。`false` なら 1 件だけ draft にはできないので、
投入前にその旨を伝え、通常 PR で積むか、PR 作成後に `gh pr ready --undo` で draft に戻すかを確認する。

### 書かれたレコードの確認

投入後は `<repo_root>/.takt/tasks.yaml` の該当レコードを読み(書き換えない)、issue・workflow・
`worktree`・`branch`・`base_branch`・`auto_pr` が意図どおりか確認する。`takt_list_tasks` は name・
status・workflow しか返さないので、branch と base の確認には使えない。応答が不明なときもまず
このレコードを照合し、二重投入を避ける。

### MCP が使えないとき

MCP ツールが見えない・呼び出しが失敗するときは**続行せず** [fallbacks.md](fallbacks.md) の
「MCP が使えないとき」に従う(対話 6 問の値の入れ方まで書いてある)。

### 既存 PR への積み増し

`taskContext.branch` に既存ブランチ名を入れるだけで成立し、新しい PR は作られない。
`--pr <番号>` で渡されたときは head ブランチを引いてから入れる:

```sh
gh pr view <番号> --json headRefName --jq .headRefName
```

既存ブランチは push 済みリモート HEAD が起点になる。ローカルの未 push 変更は入らない。
完了後は既存 PR へ push とコメント追記を行う。同じ branch の pending / running は競合対象だが、completed タスクがあっても積める。
