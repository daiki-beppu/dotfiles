---
name: takt-issue
description: |
  takt の workflow で GitHub issue を実行するスキル。`takt add` → `takt run` 経路で worktree を作成し、
  長時間 workflow を ScheduleWakeup で監視、完了後に commit メッセージ書き換え・PR 積み上げ・クリーンアップまでを統一手順で行う。
  「takt で issue 対応」「takt で #N を進めて」「takt 回して」など、takt 経由で issue を実装する意図が読み取れる発話で発動する。
---

# takt-issue

## Overview

takt の `default` workflow（plan → review → test_design → ... → reviewers の 9 step）で GitHub issue を実装する一連の手順を自動化するスキル。worktree 作成・長時間 workflow 監視・commit メッセージ書き換え・PR 積み上げ・クリーンアップを抜け漏れなく実行する。

## When to Use

- ユーザーが「takt で issue #N 進めて」「takt で対応して」「takt 回して」と依頼したとき
- takt の workflow で issue を実装する意図が読み取れたとき
- 既に takt が導入されたリポジトリで issue を実行する場合（未導入なら本 skill は対象外）

## 前提知識（必読）

takt の仕様で陥りやすい落とし穴。本 skill は以下を踏まえた手順を強制する。

| 項目 | 仕様 | 対処 |
|------|------|------|
| 対話モード `takt -i <issue>` | **worktree を作らない**（実装ハードコード）。現ブランチで作業する | worktree が欲しい場合は `takt add` → `takt run` 経路を使う |
| 自動コミットメッセージ | `takt: <slug>` 形式で生成される | プロジェクトに独自 commit 規約があれば cherry-pick で書き換え |
| `takt list --non-interactive --action delete` | `--branch <name>` 必須 | クリーンアップ時に明示的に渡す |
| cmux pane で対話プロンプト操作 | Enter 連鎖（`\n` を繋げて送る）は permission 拒否される | 1 プロンプト 1 操作で送る |
| workflow 実行時間 | 中規模タスクで 20〜40 分 | `ScheduleWakeup` で間隔を空けて確認、ポーリングしない |

## Context を収集

```bash
gh issue view <N> --json title,body,labels,state    # issue 内容
gh repo view --json nameWithOwner                    # リポジトリ
git branch --show-current                            # 現在のブランチ（base 候補）
cat .takt/config.yaml                                # takt 設定（draft_pr など）
cmux tree                                            # 利用可能な pane
```

## Task

### 1. 起動前確認

ユーザーに以下を確認する（ユーザー指定があればそれを優先）:

- **base branch**: 既存 PR に積み上げるか / `main` から新規か
- **auto-PR**: 新規 PR を作成するか / 既存 PR に積むなら不要
- **issue 分割**: issue が大きすぎるなら別 skill `issue` で sub issue を先に起票

ワンセンテンスで方針を提案し、ユーザーの判断を仰ぐ（auto モードでも方針判断は確認する）。

### 2. takt add（タスク登録）

cmux の空き pane（または新規 pane）で対話プロンプトに 1 つずつ応答する。プロンプトは 6 段階:

```
1. takt add '#<N>'                                   # issue 番号を引用符で囲む
2. ワークフロー: クイックスタート/ → Enter
3. カテゴリ: default → Enter（special workflow なら別選択）
4. Base branch: 現ブランチでよいか [Y/n] → 既存 PR 積み上げなら Y、main にするなら n で main を入力
5. Worktree path (Enter for auto)                    # Enter
6. Branch name (Enter for auto)                      # Enter
7. Auto-create PR? [Y/n]                             # 既存 PR 積み上げなら n、新規 PR なら Y
```

**重要**: 各プロンプトは個別に `cmux send-key Enter` か `cmux send "Y\n"` で送信し、`cmux read-screen` で次プロンプトの出現を確認してから次に進む。連続送信しない。

### 3. takt run（workflow 起動）

```bash
takt run    # 登録済み task を順次実行（worktree 作成 → workflow 開始）
```

worktree path とブランチ名がログに出る。控えておく:

```
Clone created: /Users/.../takt-worktrees/<timestamp>-<N>-<slug> (branch: takt/<N>/<slug>)
```

### 4. 長時間監視

`ScheduleWakeup` を使い、20〜30 分後に進捗確認する。**短い sleep でポーリングしない**（cache 効率が悪い）。

```
delaySeconds: 1500-1800   # 25-30 分
reason: "issue #<N> takt workflow 進捗チェック"
prompt: ユーザーの元プロンプトを再投入
```

確認時は `cmux read-screen --surface <id> --lines 50` で末尾を読み、

- `Workflow completed (<n> iterations, <m>s)` の行 → 完了
- `Auto-committed: <SHA>` → 自動コミット成立、SHA を控える
- `[ERROR]` / `Status: needs_fix` → 失敗、ログを確認

未完了なら再度 ScheduleWakeup で間隔を空ける。

### 5. 完了後処理

#### 5-A. 自動コミットの取り扱い

takt の自動コミットメッセージは `takt: <slug>` 形式。プロジェクトに独自 commit 規約（例: Conventional Commits）があれば書き換える:

```bash
# base ブランチに戻る
cd <main repo>
git checkout <base-branch>

# cherry-pick でメッセージのみ書き換え
git cherry-pick --no-commit <auto-commit-SHA>
git commit -m "$(cat <<'EOF'
<規約準拠のメッセージ> (#<N>)

<本文>
EOF
)"
```

`--no-commit` を使うことでステージのみ反映し、規約準拠のメッセージで新規コミットを作る。

#### 5-B. push と PR 更新

```bash
git push origin <base-branch>

# 既存 PR 積み上げの場合: PR 本文に Closes #<N> を追加
gh pr edit <PR#> --body "$(cat <<'EOF'
... 既存本文 ...
Closes #<N>
EOF
)"
```

新規 PR の場合は `gh pr create --draft` で起票（draft 既定はプロジェクト設定 `.takt/config.yaml: draft_pr: true` に従う）。

### 6. クリーンアップ

```bash
# 1. tasks.yaml と worktree 削除（--branch 必須）
takt list --non-interactive --action delete --branch takt/<N>/<slug> --yes

# 2. ローカルブランチ削除（cherry-pick 済みなら不要）
git branch -D takt/<N>/<slug>
```

ブランチ削除は破壊的操作なので、cherry-pick が成功して base ブランチに反映済みであることを `git log` で確認してから実行する。

## オプション: 独自 commit 規約への対応

プロジェクトの `CLAUDE.md` や `.takt/facets/policies/` に commit 規約が定義されている場合、takt の自動コミットでは規約を満たせない。本 skill では cherry-pick `--no-commit` 経路を既定とする。

例（specv-conventions の場合）:
- 日本語 Conventional Commits（`chore:` / `feat:` / `fix:` プレフィックス）
- issue 番号は `(#<N>)` でタイトル末尾に付与
- 本文に変更要点 3〜5 行

## Gotchas

- **takt -i は worktree を作らない**: 「対話モードで」と言われても worktree が必要なら `takt add` 経路を使う
- **cmux Enter 連鎖は permission 拒否**: `cmux send "\n\n\n"` のような連続送信は通らない。1 プロンプト 1 操作
- **`--branch` 省略不可**: `takt list --non-interactive --action delete` は branch 名を明示しないとエラー
- **lefthook pre-commit**: 多くのリポジトリで `vp check` / `knip` などが走る。cherry-pick 後に commit 失敗したら hook の出力を確認
- **Monitor の通知遅延**: workflow 完了通知が遅れることがある。確実なのは `cmux read-screen` で末尾を読む方法
- **CLAUDE.md の dotfiles 管理**: skill や設定の編集は `~/01-dev/dotfiles/config/.claude/` 側で行う（`~/.claude/` はシンボリックリンク）

## Rules

- 起動前に方針（base branch / auto-PR / 分割）をユーザーに確認する。auto モードでも判断確認は省かない
- worktree が必要な場合は `takt add` → `takt run` 経路を強制する
- 自動コミットメッセージは独自規約があれば必ず cherry-pick で書き換える
- 長時間監視は `ScheduleWakeup` を使う。短い sleep ループは禁止
- クリーンアップは破壊的操作なので、コミット反映を確認してから実行
