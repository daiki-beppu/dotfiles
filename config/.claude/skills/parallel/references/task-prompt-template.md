# pane 起動時に送るタスク指示プロンプトのテンプレート

parallel スキルの Step 5 で、各 pane に対して以下のプロンプトを `/tmp/parallel-prompt-<name>.md` に書き出してから pane の Claude に Read させる。

## 差し込み変数

| 変数 | 説明 |
|---|---|
| `{{TASK_NAME}}` | 短縮名（英数字・ハイフン） |
| `{{TASK_DESCRIPTION}}` | タスクの説明（長文可） |
| `{{WORKTREE_PATH}}` | worktree の絶対パス |
| `{{BRANCH_NAME}}` | ブランチ名（`<type>/parallel-<name>`） |

## テンプレート本文

以下をそのまま `/tmp/parallel-prompt-<name>.md` に書き出す。変数は Step 5 で置換する。

```markdown
# 並列タスク: {{TASK_NAME}}

あなたは parallel スキルから起動された独立 Claude Code セッションです。
以下のタスクを最後まで自走で完了させてください。

## タスク内容

{{TASK_DESCRIPTION}}

## 完了までの手順

1. 必要に応じてリポジトリを探索し、実装方針を決める
2. タスクに該当する変更を実装する
3. 動作確認が必要なら型チェック / テストを走らせる
4. 実装が完了したら `/cp` スキルを呼び出してコミット＆プッシュ
5. 続けて `/pr` スキルを呼び出して PR を作成
6. PR URL が表示されたら作業完了。何もせず待機して構いません

## 重要な制約

- このセッションは git worktree `{{WORKTREE_PATH}}` で動作している
- ブランチは `{{BRANCH_NAME}}` — すでに checkout 済み
- 他の並列タスクと競合しないよう、このタスクの範囲外のファイルは触らない
- 途中で判断に迷ったら、その旨を画面に出した上で待機する（メインエージェントが画面を監視している）
- `/pr` が品質チェックで失敗したら、失敗内容を直して再度 `/pr` を試みる

## 完了のシグナル

`/pr` スキルが最後に出力する PR URL (`https://github.com/.../pull/N`) がメインの完了シグナルです。
このパターンが画面に出れば監視側が自動検知します。
```

## 送信方法（Step 5 から呼ぶ手順）

1. 上記テンプレートを Read ツールで取得
2. 変数を置換して `/tmp/parallel-prompt-<name>.md` に Write
3. pane 起動 & `sleep 8` の後、以下を送信:

```bash
cmux send --surface "$SURFACE" "/tmp/parallel-prompt-${SAFE_NAME}.md を Read ツールで読んで、書かれた手順に従ってタスクを完了させて\n"
```

`cmux send` の長文破壊を避けるため、送信は 1 行の短い指示のみ。本文は pane 側 Claude が Read で取得する。
