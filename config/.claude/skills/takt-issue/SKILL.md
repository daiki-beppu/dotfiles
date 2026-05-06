---
name: takt-issue
description: |
  takt の workflow で GitHub issue を実行するスキル。`takt add` → `takt run` 経路で worktree を作成し、
  長時間 workflow を `Bash run_in_background` + `tasks.yaml` poll ループで完了検知、完了後に PR 化・積み上げ・クリーンアップまでを統一手順で行う。
  「takt で issue 対応」「takt で #N を進めて」「takt 回して」など、takt 経由で issue を実装する意図が読み取れる発話で発動する。
---

# takt-issue

## Overview

takt の `default-extended` workflow（多段レビュー + 自動スコープ外起票）で GitHub issue を実装する一連の手順を自動化するスキル。worktree 作成・長時間 workflow 監視・PR 化・積み上げ・クリーンアップを抜け漏れなく実行する。takt の自動コミットメッセージ（`takt: <slug>` 形式）はそのまま採用する。

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
| workflow 実行時間 | 中規模タスクで 20〜40 分 | `Bash run_in_background` で `.takt/tasks.yaml` の `status` を 30s 間隔で poll する until ループを起動し、完了時に 1 通知だけ受ける |

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

メインペインから `cmux new-split right` で右に分割し、その新規 pane で対話プロンプトに 1 つずつ応答する（メインペインは Claude の作業領域として残す）。プロンプトは 7 段階:

```
1. takt add '#<N>'                                   # issue 番号を引用符で囲む
2. カテゴリ: その他/ → Enter（default-extended は「その他」配下に自動分類される）
3. ワークフロー: default-extended → Enter（多段レビュー + 自動スコープ外起票）
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
# 以降、2-A と同じ対話プロンプトを 1 つずつ送る

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

メインペイン（呼び出し元）は Claude の監視・集約用に残し、そこでは takt を起動しない。各 takt セッションの完了は Step 4 の `Bash run_in_background` poll ループで一括検知する（`tasks.yaml` の `name` prefix で複数 task をまとめて待てるため、pane ごとに ScheduleWakeup を仕掛ける必要はない）。

サーフェス ID は `SURFACES=("$SURFACE1" "$SURFACE2" ...)` の配列で保持し、完了通知後にエラーログ確認用として `cmux read-screen` で参照する。

### 3. takt run（workflow 起動）

```bash
takt run    # 登録済み task を順次実行（worktree 作成 → workflow 開始）
```

worktree path とブランチ名がログに出る。控えておく:

```
Clone created: /Users/.../takt-worktrees/<timestamp>-<N>-<slug> (branch: takt/<N>/<slug>)
```

### 4. 長時間監視

`Bash run_in_background` で `.takt/tasks.yaml` の `status` フィールド（`running` → `completed` / `failed` / `aborted`）を 30s 間隔で poll する until ループを起動し、**完了時に 1 通知だけ受ける**。短い sleep ループを Claude の前景でポーリングしない。

#### 監視コストの比較

| 手段 | 起動回数 | 1 起動あたりのコスト | 向き不向き |
|---|---|---|---|
| `ScheduleWakeup` | 25 分ごとに 1 回（固定） | cache TTL (5 分) を超えるので毎回 cache miss → フルコンテキスト読み直し | 完了タイミングが完全に読めない時の保険。30 分仕事なら 1〜2 回、1h なら 3 回起動 |
| `Monitor`（素の `tail -f`） | stdout 行ごとに 1 通知 | 通知ごとに起動＋cache miss | 通知数が膨らんで一番高い |
| `Monitor`（selective filter） | 完了/失敗 行だけ emit | 1〜2 起動 | takt のように完了行が決まっている場合に有効 |
| **`Bash run_in_background` + `until` ループ** | **完了時に 1 起動** | **1 起動だけ** | **`tasks.yaml` の status を poll できる takt ではこれが最安。本 skill のデフォルト** |

#### 起動方法

`<task-name-prefix>` は `takt add` のログに出る `Task created: <slug>` の slug 部分。並列駆動時は複数 task で共通 prefix（例: `pr-127-https-github-com-daiki`）になるので、prefix で全件をまとめて待てる。

```bash
cat > /tmp/wait_takt_<slug>.sh <<'EOF'
#!/usr/bin/env bash
set -u
cd <repo path>
echo "[wait_takt] start $(date '+%H:%M:%S')"
until ruby -ryaml -e '
data = YAML.load_file(".takt/tasks.yaml")
tasks = data["tasks"].select { |t| t["name"].start_with?("<task-name-prefix>") }
exit(tasks.length >= <expected_count> && tasks.all? { |t| %w[completed failed aborted].include?(t["status"]) } ? 0 : 1)
'; do sleep 30; done
echo "[wait_takt] DONE $(date '+%H:%M:%S')"
ruby -ryaml -e '
data = YAML.load_file(".takt/tasks.yaml")
tasks = data["tasks"].select { |t| t["name"].start_with?("<task-name-prefix>") }
tasks.each { |t| puts "[#{t["status"]}] #{t["name"]} workflow=#{t["workflow"]} run_slug=#{t["run_slug"]}" }
'
EOF
chmod +x /tmp/wait_takt_<slug>.sh
```

これを `Bash` の `run_in_background: true` で投げる。timeout は workflow の最長想定（1〜2h）を考慮して `3600000ms` 程度。

#### 完了通知が来たら

`tasks.yaml` で各 task の最終 status を確認:

- `completed` → `cmux read-screen --surface <id> --lines 50` で末尾を確認、`Auto-committed: <SHA>` / `Workflow completed (<n> iterations, <m>s)` を控える
- `failed` / `aborted` → `cmux read-screen` で原因を読み、`.takt/tasks/<run_slug>/reports/` のレポートを確認

ポーリング中は他作業に Claude の context を使ってよい（前景で sleep 待ちしない）。

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

### 7. スコープ外の発見は別 issue 化

`default-extended` workflow では `report_spillover` step が並列レビュー後に自動実行され、検出したスコープ外問題を `gh issue create` で起票する。**本セクションは `report_spillover` が拾えなかった分の人手対応として位置付ける**。

takt の実行中・完了後にスコープ外の問題に気付いたら、**worktree 内で直接修正してはならない**。スコープを膨らませると PR レビューが肥大化し、takt builtin の「タスク指示書の文言を拡大解釈しない」スコープ規律にも反する。

代わりに次の手順で別 issue として起票する:

1. メインペイン（呼び出し元）に戻る
2. `issue` スキルを起動して、発見した問題を新規 issue として登録
3. 必要なら原 issue の PR 本文や takt の summary に「関連: #<新 issue>」を追記
4. 新 issue は次回の takt サイクルで処理する（その場で連続着手しない）

具体例:

| 発見 | 対応 |
|---|---|
| 無関係なテストの flakiness | 別 issue（バグ報告） |
| 触ったファイルの古いコメント / 型注釈不足 | 別 issue（chore） |
| 依存ライブラリの軽微な脆弱性 | 別 issue（security / chore） |
| 設計上の重複・抽象化したくなる箇所 | 別 issue（refactor）、ただし `repo-audit` で検出される類なら起票前に重複確認 |
| 同じ PR の他 issue 領域への波及 | takt のスコープ内なので worktree で直す（積み上げ運用なら base ブランチに merge してから次 takt） |

判断に迷うときの基準: **「この修正を入れたら PR タイトルが変わるか?」**。変わるならスコープ外 → 別 issue。

## Gotchas

- **takt -i は worktree を作らない**: 「対話モードで」と言われても worktree が必要なら `takt add` 経路を使う
- **cmux Enter 連鎖は permission 拒否**: `cmux send "\n\n\n"` のような連続送信は通らない。1 プロンプト 1 操作
- **`--branch` 省略不可**: `takt list --non-interactive --action delete` は branch 名を明示しないとエラー
- **完了検知の選択**: `Monitor`（素の `tail -f`）は通知ごとに cache miss が走るため selective filter を組まないと割高。`ScheduleWakeup` は完了タイミングが全く読めない場合の保険でしか正当化できない。`tasks.yaml` の status フィールドを poll できる takt では `Bash run_in_background` + `until` ループ（30s 間隔）が最安で、これを **本 skill のデフォルト**とする
- **`tasks.yaml` の name prefix**: `Task created: <slug>` の slug は task 説明文先頭から自動生成される（記号は除去、80 文字程度で truncate）。並列駆動時は複数 task で同じ prefix になりがちなので、prefix での絞り込みが効く
- **skill のスコープ判定**: 編集対象が **グローバル user skill**（dotfiles 管理のもの。例: takt-issue / parallel / cp など）なら `~/01-dev/dotfiles/config/.claude/skills/` を編集する（`~/.claude/` はシンボリックリンク）。一方、**project-scoped skill**（リポジトリの `.claude/skills/` に commit され、`yt-skills sync` などで downstream に配布されるもの）はそのリポジトリ内で編集する。両者を取り違えると配布経路が壊れる

## Rules

- 起動前に方針（base branch / auto-PR / 分割）をユーザーに確認する。auto モードでも判断確認は省かない
- worktree が必要な場合は `takt add` → `takt run` 経路を強制する
- 自動コミットメッセージ（`takt: <slug>`）は書き換えず、そのまま採用する
- 長時間監視は `Bash run_in_background` + `until` ループで `.takt/tasks.yaml` の status を 30s 間隔で poll する。`ScheduleWakeup` は完了タイミングが完全に読めない場合の保険。前景 sleep ループは禁止
- 現 issue のスコープ外の問題を見つけても worktree 内で直接修正しない。`report_spillover` step が拾えなかったものは `issue` スキルで別 issue として起票し、次回の takt サイクルに回す（判断基準: 「PR タイトルが変わるか?」変わるならスコープ外）
- ローカルブランチ削除は PR merge 後に `branch-clean` スキルへ委譲（merge 前に消さない）
- 単独 issue でもメインペインを `cmux new-split right` で右に分割し、新規 pane で takt を実行する（メインペインは Claude 用に残す）
- 並列駆動時は 1 つ目を `cmux new-split right` で右に分割、2 つ目以降は直前のサーフェスから `cmux new-split down --surface ...` で下に積み重ねる（parallel スキルと同じレイアウト）
- メインペイン（呼び出し元）では takt を起動しない。Claude の監視・集約用に残す
