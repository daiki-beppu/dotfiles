---
name: takt-issue
description: |
  takt の workflow で GitHub issue を実行するスキル。`takt add` → `takt run` 経路で worktree を作成し、
  長時間 workflow を ScheduleWakeup で監視、完了後に PR 化・積み上げ・クリーンアップまでを統一手順で行う。
  「takt で issue 対応」「takt で #N を進めて」「takt 回して」など、takt 経由で issue を実装する意図が読み取れる発話で発動する。
---

# takt-issue

## Overview

takt の `default` workflow（plan → review → test_design → ... → reviewers の 9 step）で GitHub issue を実装する一連の手順を自動化するスキル。worktree 作成・長時間 workflow 監視・PR 化・積み上げ・クリーンアップを抜け漏れなく実行する。takt の自動コミットメッセージ（`takt: <slug>` 形式）はそのまま採用する。

## When to Use

- ユーザーが「takt で issue #N 進めて」「takt で対応して」「takt 回して」と依頼したとき
- takt の workflow で issue を実装する意図が読み取れたとき
- 既に takt が導入されたリポジトリで issue を実行する場合（未導入なら本 skill は対象外）

## 前提知識（必読）

takt の仕様で陥りやすい落とし穴。本 skill は以下を踏まえた手順を強制する。

| 項目 | 仕様 | 対処 |
|------|------|------|
| 対話モード `takt -i <issue>` | **worktree を作らない**（実装ハードコード）。現ブランチで作業する | worktree が欲しい場合は `takt add` → `takt run` 経路を使う |
| 自動コミットメッセージ | `takt: <slug>` 形式で生成される | そのまま採用する。書き換えない |
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

#### 2-A. 単独 issue の場合

メインペインから `cmux new-split right` で右に分割し、その新規 pane で対話プロンプトに 1 つずつ応答する（メインペインは Claude の作業領域として残す）。プロンプトは 6 段階:

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

#### 2-B. 並列駆動（複数 issue 同時）の場合

複数 issue を同時に takt で回す場合は、**1 つ目はメインペインから右に分割**して起動し、**2 つ目以降は直前のサーフェスからさらに下に分割**して縦に積み重ねる（parallel スキルと同じレイアウト）。

```bash
# 1 つ目: メインペインから右に分割
SURFACE1=$(cmux new-split right 2>&1 | awk '{print $2}')
cmux send --surface "$SURFACE1" "takt add '#<N1>'\n"
# 以降、2-A と同じ 6 段階の対話プロンプトを 1 つずつ送る

# 2 つ目以降: 直前のサーフェスから下に分割
SURFACE2=$(cmux new-split down --surface "$SURFACE1" 2>&1 | awk '{print $2}')
cmux send --surface "$SURFACE2" "takt add '#<N2>'\n"
```

レイアウト:

```
┌──────────────┬──────────────┐
│              │  takt #N1   │
│  メインペイン ├──────────────┤
│  (Claude)    │  takt #N2   │
│              ├──────────────┤
│              │  takt #N3   │
└──────────────┴──────────────┘
```

メインペイン（呼び出し元）は Claude の監視・集約用に残し、そこでは takt を起動しない。各 takt セッションの完了は `ScheduleWakeup` + `cmux read-screen --surface "$SURFACEn"` で確認する（Step 4 と同じ手順を pane ごとに繰り返す）。

サーフェス ID は `SURFACES=("$SURFACE1" "$SURFACE2" ...)` の配列で保持し、監視ループで順次読む。

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

takt が worktree 内で `takt/<N>/<slug>` ブランチに自動コミットしているので、そのブランチをそのまま push → PR 化する。**自動コミットメッセージ（`takt: <slug>` 形式）は書き換えない**。

#### 5-A. push と PR 化

```bash
cd <worktree path>
git push -u origin takt/<N>/<slug>

# 新規 PR（draft 既定はプロジェクト設定 .takt/config.yaml: draft_pr に従う）
gh pr create --base <base-branch> --draft --title "..." --body "$(cat <<'EOF'
... 概要 ...

Closes #<N>
EOF
)"
```

#### 5-B. 既存 PR 積み上げ

既存 PR のブランチに統合する場合は、worktree ブランチを既存 PR ブランチに merge する:

```bash
cd <main repo>
git checkout <existing-pr-branch>
git merge --no-ff takt/<N>/<slug>
git push origin <existing-pr-branch>

# PR 本文に Closes #<N> を追加
gh pr edit <PR#> --body "$(cat <<'EOF'
... 既存本文 ...
Closes #<N>
EOF
)"
```

### 6. クリーンアップ

```bash
# tasks.yaml と worktree 削除（--branch 必須）
takt list --non-interactive --action delete --branch takt/<N>/<slug> --yes
```

ローカルブランチ `takt/<N>/<slug>` は PR が merge されたあとに `branch-clean` スキルで一括削除する（merge 前に削除すると PR の差分元が失われる）。

## Gotchas

- **takt -i は worktree を作らない**: 「対話モードで」と言われても worktree が必要なら `takt add` 経路を使う
- **cmux Enter 連鎖は permission 拒否**: `cmux send "\n\n\n"` のような連続送信は通らない。1 プロンプト 1 操作
- **`--branch` 省略不可**: `takt list --non-interactive --action delete` は branch 名を明示しないとエラー
- **Monitor の通知遅延**: workflow 完了通知が遅れることがある。確実なのは `cmux read-screen` で末尾を読む方法
- **skill のスコープ判定**: 編集対象が **グローバル user skill**（dotfiles 管理のもの。例: takt-issue / parallel / cp など）なら `~/01-dev/dotfiles/config/.claude/skills/` を編集する（`~/.claude/` はシンボリックリンク）。一方、**project-scoped skill**（リポジトリの `.claude/skills/` に commit され、`yt-skills sync` などで downstream に配布されるもの）はそのリポジトリ内で編集する。両者を取り違えると配布経路が壊れる

## Rules

- 起動前に方針（base branch / auto-PR / 分割）をユーザーに確認する。auto モードでも判断確認は省かない
- worktree が必要な場合は `takt add` → `takt run` 経路を強制する
- 自動コミットメッセージ（`takt: <slug>`）は書き換えず、そのまま採用する
- 長時間監視は `ScheduleWakeup` を使う。短い sleep ループは禁止
- ローカルブランチ削除は PR merge 後に `branch-clean` スキルへ委譲（merge 前に消さない）
- 単独 issue でもメインペインを `cmux new-split right` で右に分割し、新規 pane で takt を実行する（メインペインは Claude 用に残す）
- 並列駆動時は 1 つ目を `cmux new-split right` で右に分割、2 つ目以降は直前のサーフェスから `cmux new-split down --surface ...` で下に積み重ねる（parallel スキルと同じレイアウト）
- メインペイン（呼び出し元）では takt を起動しない。Claude の監視・集約用に残す
