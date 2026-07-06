---
name: takt-issue
description: >-
  takt の workflow で GitHub issue を実装する(worktree 作成 → background 実行 + exit で完了検知 → PR 化 → CI green まで監視 → クリーンアップ)。「takt で issue 対応」「takt で #N を進めて」「takt 回して」など、takt 経由で issue を実装する意図が読み取れる発話で発動。7 観点自動レビュー(takt-review)は対象外(CI green で完了)。
---

# takt-issue

## Overview

takt の workflow で GitHub issue を実装する一連の手順を自動化するスキル。worktree 作成・長時間 workflow 監視・PR 化（takt CLI の postExecutionFlow に委譲）・CI 監視・積み上げ・クリーンアップを抜け漏れなく実行する。**CI green の確認とクリーンアップで完了**とし、7 観点自動レビュー（takt-review スキル）は本 skill から呼ばない — ユーザーが明示的に依頼した場合のみ別途起動する。takt の自動コミットメッセージ（`takt: <slug>` 形式）はそのまま採用する。

workflow は issue の性質に応じて使い分ける（いずれも builtin。dotfiles 側のカスタムは持たない）:

- **`default`**（plan → write_tests → draft → peer-review の 4 ステップ。draft / peer-review は subworkflow で内包）: **新規 feature かつテスト先行が価値を持つ場合のみ**
- **`default-mini`**（plan → draft → peer-review の 3 ステップ。テスト実装をスキップ）: それ以外すべて — bugfix / chore / docs / refactor / 既存テストで担保できる変更。**迷ったらこちら**（トークン節約優先）

選択ロジックは Step 1「起動前確認」で扱う。

## When to Use

- ユーザーが「takt で issue #N 進めて」「takt で対応して」「takt 回して」と依頼したとき
- takt の workflow で issue を実装する意図が読み取れたとき
- 既に takt が導入されたリポジトリで issue を実行する場合（未導入なら本 skill は対象外）

## 前提知識（必読）

takt の仕様で陥りやすい落とし穴。本 skill は以下を踏まえた手順を強制する。

| 項目 | 仕様 | 対処 |
|------|------|------|
| 起動コマンド | `takt` は直接実行できる。`npx takt` は不要 | **常に `takt ...` を使う**。`npx` は使わない |
| 対話モード `takt -i <issue>` | **worktree を作らない**（実装ハードコード）。現ブランチで作業する | worktree が欲しい場合は `takt add` → `takt run` 経路を使う |
| 非 TTY の `takt add` | workflow 選択 UI に応答できず、先頭の `default` が選ばれやすい | **実行前に `.takt/tasks.yaml` の `workflow` を必ず確認・補正**。TTY で選びたい場合はローカルターミナルで直接叩く |
| 自動コミットメッセージ | `takt: <slug>` 形式で生成される | そのまま採用する。書き換えない |
| `takt list --non-interactive --action delete` | `--branch <name>` 必須 | クリーンアップ時に明示的に渡す |
| workflow 実行時間 | 中規模タスクで 20〜40 分 | `takt -q run` を background + log redirect で起動する。`takt -q run` は全 task を消化して exit するので、完了検知は Claude Code なら自動再呼び出し、Codex なら `while kill -0 ...; do sleep 30; done` の 1 コマンドブロッキング待機（単発チェックでは不可） |
| Codex / ChatGPT 側の token 消費 | `takt run` の stdout / JSONL / trace を前景で読むと、完了時に数十万 token のツール出力になる | **前景で `takt run` を監視しない**。stdout は `/tmp/takt-*.log` に逃がし、必要時だけ `tail -80` する |

### Token budget guard

この skill の最重要ルール。takt の workflow 自体より、呼び出し元エージェントが takt の長い標準出力を読むことが token 消費の主因になる。

- `takt run` は原則として `takt -q run > /tmp/takt_<slug>.log 2>&1 &` で起動する
- `write_stdin` / `tail -f` で全文ログを読まない
- 読んでよいのは `tasks.yaml` の該当 task、`tail -80 /tmp/takt_<slug>.log`、必要な report markdown の該当セクションだけ
- `.takt/runs/**/logs/*.jsonl` と `trace.md` は全文表示しない。調査時は `wc -c` / `du -sh` / `jq` で集計してから必要行だけ読む
- 完了後のユーザー報告は `status`、PR URL、テスト結果、review verdict に絞る

## Context を収集

```bash
gh issue view <N> --json title,body,labels,state    # issue 内容
gh repo view --json nameWithOwner                    # リポジトリ
git branch --show-current                            # 現在のブランチ（base 候補）
cat .takt/config.yaml                                # takt 設定（draft_pr など）
```

## Task

### 0. issue 本文の正規化（preflight）

`gh issue view` で取得した本文が takt の plan.md instruction が期待する構造を持つか検証する。`issue` スキル以外で作成された issue（`to-issues` / 手動 / sub-issue 分割）はこの構造を欠くことが多く、plan step の品質劣化 → レビュー REJECT ループの原因になる。

#### 必須セクション検証

本文を `## ` 見出し単位でパースし、以下 4 セクションの存在を確認する:

| 必須セクション | plan.md での用途 | 欠落時の影響 |
|---|---|---|
| `## 参照資料` | regex 抽出 → Read/Glob で自動展開 | plan が参照ファイルを読めず精度劣化 |
| `## 影響ファイル` | スコープ推定 | takt が無関係ファイルを変更しスコープ超過 |
| `## 要件` | 要件分解 → 完了判定 | 要件不明確で実装が発散 |
| `## スコープ外` | spillover 検出の境界 | スコープ外変更が混入しレビュー REJECT |

#### 判定

- 4 セクションすべて存在 → **正規化不要**。Step 1 に進む
- いずれか欠落 → 以下の正規化フローを実行

#### スコープ肥大の検出

正規化と同時に、issue のスコープが 1 takt run に対して大きすぎないかを検証する。以下のいずれかに該当する場合は **分割を提案** して Step 1 に進む前にユーザー判断を仰ぐ:

| 検出基準 | 判断 |
|---|---|
| `## 要件`（または `## 受入基準` / `## Acceptance criteria`）の項目数が **8 件以上** | 分割推奨 |
| `## 影響ファイル`（または本文中のファイルパス言及）が **10 ファイル以上** | 分割推奨 |
| 要件の中に **独立した機能領域が 2 つ以上** 混在（例: 「定数追加」と「UI 実装」が同一 issue） | 分割推奨 |

分割推奨時のアクション:
1. 分割案（sub-issue 候補）を 1-2 文ずつ提示
2. ユーザーが承認 → `issue` スキルで sub-issue を起票し、元 issue のスコープを縮小してから続行
3. ユーザーが却下 → そのまま Step 1 に進む（ただしレビュー時の判断材料として記録）

#### セクション名マッピング

| 検出パターン | 変換先 |
|---|---|
| `## What to build` / `## 作業内容` | `## 概要`（1-3 文の要約を先頭に抽出、詳細は本文に残す） |
| `## Acceptance criteria` / `## 受入基準` | `## 要件`（チェックリスト `- [ ]` → 番号付きリスト `1.`） |
| `## Background` / `## 背景` | `## 背景・目的` |
| `## Parent` / `## 親 issue` | そのまま保持（plan.md の抽出対象外） |
| `## Blocked by` / `## 依存` | そのまま保持 |
| `## 関連` / `## References` | そのまま保持 |

#### 不足セクション補完

- **`## 参照資料`**: 本文中のファイルパス（`path/to/*.ts`、`src/...`、拡張子付きパス）を抽出して箇条書きに変換。1 件も見つからなければ `(plan step で確定する)`
- **`## 影響ファイル`**: 同上。`**新規**` / `**変更**` / `**削除**` を文脈から推定。不足なら `(plan step で確定する)`。
  契約・データ形式・config キーの変更を含む issue では「兄弟入口・貫通先」
  （同責務の別 CLI / server / extension / Python・TS 対実装、config の定義→loader→実行→出力チェーン）を
  本文から推定して小節として補完する。推定できなければ `(plan step で確定する)` と明記
- **`## スコープ外`**: 以下の優先順で生成:
  1. 親 issue がある場合 → 兄弟 sub-issue のタイトルから「本 issue が担当しない領域」を列挙
  2. 本文中に「〜は別 issue」「〜は対象外」等の言及がある → 抽出
  3. いずれもない → 「本 issue のタイトルが変わるような変更は扱わない」を最低限の境界として記入
- **`## 実装方針（takt）`**: Step 1 の workflow 判断後に追記（この時点では空欄可）

#### ユーザー確認 → 更新

正規化版を以下の形式で提示する:

```
⚠ issue #<N> の本文が takt 非互換フォーマットです

追加: 参照資料, スコープ外
変換: 受入基準 → 要件
保持: 親 issue, 背景, 関連

（正規化後の本文プレビュー）

この内容で issue を更新しますか？
```

承認後に `gh issue edit <N> --body "..."` で更新。以降の Step 1〜7 は正規化済み本文を前提に進行する。

### 1. 起動前確認

ユーザーに以下を確認する（ユーザー指定があればそれを優先）:

- **base branch**: `main` から新規 PR を作るか / 既存 feature ブランチに積み上げるか。`takt add` の Step 4「Base branch」で選んだ branch がそのまま PR の base になる
- **issue 分割**: issue が大きすぎるなら別 skill `issue` で sub issue を先に起票
- **workflow**: `default` / `default-mini` のどちらで回すか（下表で判定）
PR 作成は takt CLI 本体の `postExecutionFlow` が workflow 完了後に自動実行する（auto-commit → push → `gh pr create`、既存 PR があれば `gh pr comment` で追記）。`takt add` の `Auto-create PR? [Y/n]` プロンプトは **Y を選ぶ**（PR を自動で作るため）。workflow 側の品質チェックは builtin の peer-review subworkflow に含まれる reviewers（arch / ai-antipattern / supervise）の並列レビューが担当する。

ワンセンテンスで方針を提案し、ユーザーの判断を仰ぐ（auto モードでも方針判断は確認する）。

#### workflow 判断基準

`gh issue view <N> --json title,body,labels` の結果から推奨を 1 文で提案する。

| issue の特徴 | 推奨 workflow |
|---|---|
| **新規 feature かつテスト先行が価値を持つ**（新しい振る舞いの追加で、テストを先に書くことで設計が改善する） | `default` |
| 上記以外すべて — bugfix / chore / docs / refactor / 既存テストで担保できる変更 | `default-mini` |
| 判断に迷う場合 | `default-mini`（write_tests 1 ステップ分 + 後続レビュー対象の縮小で 1 run あたり約 20-25% 軽い。トークン節約を優先） |

builtin の `default` / `default-mini` はいずれも **スコープ外発見の自動 issue 起票機能を持たない**。スコープ外を見つけたときは Step 7 の人手手順（`issue` スキルへの引き渡し）で対応する旨をユーザーに伝える。

#### provider 構成 (参考)

`coder` persona のみ Codex、その他（`planner` / `supervisor` / reviewer 系 4 persona）は Claude。実装で最も動く coder を Codex に振り、Claude Code Max のトークン枠を温存する構成。詳細と rate limit リカバリ手順は `~/.claude/skills/takt/SKILL.md` の `persona_providers` セクションを参照。

### 2. takt add（タスク登録）

#### デフォルト経路: 非 TTY で直叩き → tasks.yaml 補正

`takt add '#<N>'` を直接実行する。非 TTY なので workflow 選択 UI に応答できず、先頭の `default` が自動選択される。その後 `.takt/tasks.yaml` を読み、今回追加された `status: pending` の task の `workflow` を意図したものに補正する。

```bash
takt add '#<N>'
sed -n '1,220p' .takt/tasks.yaml
```

`default-mini` で回す判断なら、該当 task の `workflow: default` を `workflow: default-mini` に変更してから `takt run` する。既存 completed task の workflow は触らず、今回追加した `status: pending` の task だけを対象にする。

確認ポイント:

- `issue: <N>`
- `status: pending`
- `workflow: default` / `default-mini`
- `auto_pr: true`
- `draft_pr` は repo 設定に従う

補正後に再確認する:

```bash
sed -n '1,220p' .takt/tasks.yaml
```

`Auto-create PR? [Y/n]` の対話には応答できないが、非 TTY 時は `auto_pr: true` がデフォルトで yaml に書き込まれる前提（要確認なら直後の `tasks.yaml` で `auto_pr` フィールドを見る）。`false` になっていたら手で `true` に補正する。

#### 複数 issue を同時に回す場合

`takt add` を直列で N 回叩いて、N 個の task を `tasks.yaml` に `status: pending` で並べる。実行は Step 3 の **単一 `takt -q run`** が担当する。グローバル設定（`~/.takt/config.yaml`）に `concurrency: 3` を宣言済みなので、1 回の `takt -q run` が pending を **最大 3 task 並列**で消化する（ワーカーが空くたびに `task_poll_interval_ms` 間隔で次の pending を取得）。**`takt run` を N 個多重起動しない**。

```bash
takt add '#<N1>'
# tasks.yaml で N1 の workflow を補正
takt add '#<N2>'
# tasks.yaml で N2 の workflow を補正
# ...
```

各 task の `worktree_path` / `branch` / `run_slug` は `tasks.yaml` に出る。完了検知は Step 4 の「`takt -q run` の exit」で全 task を一括で待てる（`name` prefix は exit 後に `tasks.yaml` を絞り込む用途で使う）。並列実行の仕様詳細（`concurrency` / `task_poll_interval_ms` の範囲・graceful shutdown）は `~/.claude/skills/takt/SKILL.md` の「並列実行」節を参照。

全 task 完了後の CI 監視・fix・クリーンアップは Step 5 の「複数 task の並列処理（Phase 2 dispatch）」で Agent ごとに並列実行する。

#### TTY で対話的に選びたい場合（オプション）

workflow 選択 UI（カテゴリ → workflow の 2 段選択）を矢印キーで選びたい場合は、ローカルターミナルで `takt add '#<N>'` を直接叩く。Claude Code の Bash ツールからは TTY が無いので使えない経路。

カテゴリ全体の構造は `~/.bun/install/global/node_modules/takt/builtins/ja/workflow-categories.yaml` を参照。仕様の詳細は `~/.claude/skills/takt/SKILL.md` を参照。

### 3. takt run（workflow 起動）

#### 原則: 本体コマンドを直接 background（wrapper を作らない・agent 共通）

呼び出し元エージェントの token 消費を抑えるため、`takt run` は前景で流さない。`-q` はトップレベル option なので `takt -q run` の順で指定する。stdout は必ずログにリダイレクトする（前景で読むと完了時に数十万 token）。

`takt -q run` は pending task を worker pool で全消化し、**全 task が終わると exit する**。この「exit までブロックする」性質をそのまま完了検知に使い、agent ごとに投げ方だけ変える（別途の wait スクリプトは作らない）:

- **Claude Code**: `Bash` の `run_in_background: true` で `takt -q run > /tmp/takt_<slug>.log 2>&1` を投げる（`nohup` や末尾 `&` は不要）。プロセス exit で harness が自動再呼び出しするので、**こちらから poll しない**。下記 `nohup` 版は使わず、この一行だけを background 投げする。
- **Codex / その他 CLI**: 自動再呼び出しが無いので下記のように detach + pid 記録し、Step 4 で粗く生存確認する。

```bash
SLUG=<task-slug>
LOG=/tmp/takt_${SLUG}.log
PIDFILE=/tmp/takt_${SLUG}.pid
# Codex/その他 CLI 用: detach して pid を控える（Claude Code は run_in_background で上記一行を投げるだけ）
nohup takt -q run >"$LOG" 2>&1 &
echo $! >"$PIDFILE"
echo "takt pid=$(cat "$PIDFILE") log=$LOG"
```

worktree path とブランチ名は `tasks.yaml` と log に出る。全文ログは読まず、必要時だけ末尾を見る:

```bash
tail -80 "$LOG"
```

控える情報:

- `.takt/tasks.yaml` の `worktree_path`
- `.takt/tasks.yaml` の `branch`
- `.takt/tasks.yaml` の `run_slug`
- `.takt/tasks.yaml` の `pr_url`（完了後）

#### 複数 task pending の場合

複数 issue を Step 2 で追加しても、**起動は単一の `takt -q run` 1 回だけ**でよい。takt CLI の worker pool（`runAllTasks` → `claimNextTasks(concurrency)` → `runWithWorkerPool`）が pending を並列実行する。

- グローバル設定（`~/.takt/config.yaml`、dotfiles 実体は `config/.takt/config.yaml`）で `concurrency: 3` / `task_poll_interval_ms: 500` を宣言済み。よって 1 回の `takt -q run` が pending を最大 3 task 並列で消化し、ワーカーが空くたびに 500ms 間隔で次の pending を取得する
- `concurrency` は `1〜10`、`task_poll_interval_ms` は `100〜5000`（zod 検証）。並列度を一時的に変えたいときはグローバル設定の `concurrency` を編集する（CLI flag は無い）
- **`takt -q run` を `run_in_background` で N 個投げる旧手順は使わない**。多重起動すると各プロセスが個別に `claimNextTasks` するため実効並列度が `concurrency × 起動数` に膨らみ、worktree 競合やトークン消費の暴走を招く
- ログは単一プロセスなので `/tmp/takt_<slug>.log` も 1 本にまとまる。`concurrency > 1` のときは takt が task ごとに色分けラベルを付けるので、`tail -80` でもどの行がどの task か判別できる
- 単一の `takt -q run` は全 task を消化してから exit する。よって完了検知は Step 4 の「プロセス exit」で全 task をまとめて待てる（exit 後に `tasks.yaml` を 1 回読めば各 task の最終 status が揃っている）

### 4. 完了検知（wait スクリプトも進捗ループも作らない）

`takt -q run` が exit した時点で全 task が終わっている。**完了検知のための wait スクリプト・30s 進捗 echo ループ・`ScheduleWakeup`・`Monitor` は作らない／使わない**（いずれも token を無駄に食う。旧版の ruby `until` ループは廃止）。

- **Claude Code**: Step 3 で `run_in_background: true` を使っていれば、`takt -q run` の exit で harness が自動再呼び出しする。待っている間はこちらから何もしない（他作業に context を使ってよい）。timeout は workflow の最長想定（1〜2h）を考慮して `3600000ms` 程度。
- **Codex / その他 CLI**: 自動再呼び出しが無いため、`kill -0` を 1 回だけ確認して次に進んではならない（プロセスが生きている＝実行中のまま後続のステップに進んでしまう）。次のコマンドを 1 回実行し、プロセスが終わるまでその呼び出し自体をブロックさせる:

```bash
while kill -0 "$(cat /tmp/takt_<slug>.pid)" 2>/dev/null; do sleep 30; done
echo done
```

コマンドの実行環境に timeout があり `while` が途中で打ち切られた場合は、同じ `while kill -0 ...` の行だけ再実行すればよい（pid の生存確認のみでべき等）。

`done` が出力されたら（= Claude Code は再呼び出し）、下記「完了時の確認」に進む。複数 task を回していても単一プロセスが全 task 消化後に exit するので、この 1 判定で全件の完了を待てる。

#### 完了時の確認

自動再呼び出し（Claude Code）または `kill -0` が `done`（Codex）になったら、`tasks.yaml` で各 task の最終 status を確認:

- `completed` → `tail -80 /tmp/takt_<slug>.log` で末尾を読み、`Auto-committed: <SHA>` / `Workflow completed (<n> iterations, <m>s)` を控える
- `failed` / `aborted` → `tail -80 /tmp/takt_<slug>.log` で原因を読み、`.takt/tasks/<run_slug>/reports/` のレポートを確認

参照する 3 点のみ:

```bash
sed -n '1,220p' .takt/tasks.yaml      # 各 task の最終 status / pr_url
tail -80 /tmp/takt_<slug>.log         # 末尾出力（必要時のみ）
ls .takt/runs/<run_slug>/reports/     # peer-review のレポート一覧
```

待機中は他作業に context を使ってよい（前景で sleep 待ちしない）。

### 5. 完了後処理

PR 作成（auto-commit / push / `gh pr create` または既存 PR への `gh pr comment` 追記）は **takt CLI 本体の `postExecutionFlow` が workflow 完了直後に自動実行する**。skill 側で手動の `gh pr create` / `gh pr edit` は基本不要。品質チェックは builtin の peer-review subworkflow（arch-review / ai-antipattern-review / supervise の並列レビュー）が担当する。

#### 複数 task の並列処理（Phase 2 dispatch）

Step 4 で複数 task が完了した場合、**CI 監視（Step 5-C）+ Step 6（クリーンアップ）を Agent tool で task ごとにサブエージェントを並列起動**する。各エージェントが独立して CI 監視 → fix → クリーンアップを完走するため、直列処理に比べて wall-clock time が約 1/N になる。

**起動条件**: completed task が **2 件以上**。1 件なら従来通り 5-A 以降を直列実行（Agent 起動オーバーヘッドが不要）。

**手順**:

1. `tasks.yaml` から completed task の情報を収集:

```bash
ruby -ryaml -e '
data = YAML.load_file(".takt/tasks.yaml")
data["tasks"].select { |t| t["status"] == "completed" }.each { |t|
  puts "#{t["name"]} | worktree=#{t["worktree_path"]} | branch=#{t["branch"]} | run_slug=#{t["run_slug"]}"
}'
```

2. 各 task に対し Agent tool を **1 メッセージで並列起動**（`run_in_background: true`）。プロンプトテンプレート:

```
<repo_name> の PR の CI 監視〜クリーンアップを実行してください。

## 情報
- repo root: <repo_root>
- worktree: <worktree_path>
- branch: <branch>

## 手順

1. PR 番号取得
   gh pr list --head "<branch>" --json number -q '.[0].number'

2. CI 監視（takt-issue スキル Step 5-C 相当）
   待機前に gh pr view <PR#> --json mergeable,mergeStateStatus を確認し、CONFLICTING/DIRTY なら
   worktree で base を merge/rebase してコンフリクトを解消してから進む（CI 監視より優先）。
   mergeable なら gh pr checks <PR#> --watch --interval 30 > /tmp/ci_pr<PR#>.log 2>&1 を
   run_in_background で直接投げ(wrapper 不要)、exit の自動再呼び出しで完了を待つ。
   完了時も mergeable を再確認してから合否判定する（checks の合否だけで判断しない）。
   fail なら失敗ログを gh run view <run-id> --log-failed で取得し、
   worktree 内で修正 → commit → push → 再監視（最大 3 周。超過・スコープ外 fail は報告して停止）

3. クリーンアップ
   takt list --non-interactive --action delete --branch <branch> --yes

4. 最終結果を報告: status / PR URL / CI 結果 / 修正ラウンド数
```

3. 全エージェント完了後、結果をまとめてユーザーに報告

#### 5-A. 新規 PR（base = main / master）

`takt add` で `Auto-create PR? [Y/n]` に Y を選んでいれば、postExecutionFlow が `gh pr create` で新規 PR を作る。PR 本文は固定テンプレート（`## Summary` + `## Execution Report` + `Closes #<N>` + `<!-- takt:managed -->` マーカー）。

skill 側ですべきことは:

1. `tasks.yaml` の status が `completed` になったら `tasks.yaml` の `pr_url` フィールドを読む。空のときは `gh pr list --head takt/<N>/<slug> --json url -q '.[0].url'` で取得
2. PR URL と `.takt/runs/<run_slug>/reports/` 配下のレビューレポート（builtin の peer-review が出力する `architecture-review.md` / `ai-antipattern-review.md` / `supervisor-validation.md` など）を Read で読んでレビュー結果をユーザーに表示
3. `status: failed` で workflow 自体が落ちている場合は失敗ログを確認し、`fix` step でリカバリ済みか、人手介入が必要かを判断
4. PR 作成自体が失敗（auth エラー等）した場合は `tasks.yaml` の `prFailed: true` で検出できる。その時は手動で `gh pr create` するか、`/commit-commands:commit-push-pr` を親 repo で叩いてリカバリ

#### 5-B. 既存 PR への積み上げ（base = feature ブランチ等）

postExecutionFlow は既存 PR を検出すると新規作成せず `gh pr comment <N> --body <prBody>` でコメント追記するだけ。**worktree ブランチを base ブランチに merge する処理は builtin に無い** ため、必要なら以下を人手で実行する:

```bash
# 親 repo に戻る
cd <main repo path>
# 既存 PR の base ブランチに切り替えて worktree ブランチを merge
git checkout <BASE_BRANCH>
git pull --ff-only origin <BASE_BRANCH>
git merge --no-ff takt/<N>/<slug> -m "Merge takt/<N>/<slug> into <BASE_BRANCH>"
git push origin <BASE_BRANCH>
# 既存 PR 本文に Closes #<N> を追記
EXISTING_PR=$(gh pr list --head <BASE_BRANCH> --state open --json number -q '.[0].number')
gh pr edit "$EXISTING_PR" --body "$(gh pr view "$EXISTING_PR" --json body -q '.body')

Closes #<N>"
```

skill 側ですべきことは、merge 実行可否（人手承認）の確認、上記コマンドの実行、結果（既存 PR URL）のユーザー報告。

#### 5-C. CI 監視（CI green まで）

PR 作成（5-A）または積み上げ（5-B）の完了後、GitHub Actions が green になるまで監視する。`gh pr checks <PR#> --watch` は CI 完了までブロックして exit するので、**wrapper スクリプトで包まず** redirect 付きで直接 background する（前景で `--watch` を読まない）。

PR 番号は 5-A の `pr_url` 末尾、または `gh pr list --head takt/<N>/<slug> --json number -q '.[0].number'` で取得する。

```bash
PR_NUMBER=<PR#>
```

**待機を始める前に mergeable を確認する**。base とコンフリクトしていると checks がいつまでも揃わず `--watch` が完了しないまま伸び続けることがあるため、待つ前に弾いておく:

```bash
gh pr view ${PR_NUMBER} --json mergeable,mergeStateStatus -q '"mergeable=\(.mergeable) mergeStateStatus=\(.mergeStateStatus)"'
```

`mergeable=CONFLICTING`（または `mergeStateStatus=DIRTY`）なら、CI 監視より先に worktree（`tasks.yaml` の `worktree_path`）でコンフリクトを解消する:

```bash
cd <worktree_path>
git fetch origin <base_branch>
git merge origin/<base_branch>   # 解消しづらい場合は git rebase origin/<base_branch>
# コンフリクトマーカーを解消してから
git add -A && git commit
git push
```

解消後、上記の mergeable 確認を再実行し `MERGEABLE` になってから以下に進む。

- **Claude Code**: `Bash` の `run_in_background: true` で `gh pr checks ${PR_NUMBER} --watch --interval 30 > /tmp/ci_pr${PR_NUMBER}.log 2>&1` を投げる（timeout `2400000ms` = 40 分）。exit 時に自動再呼び出しされるので poll しない。exit code がそのまま合否（0=green）。
- **Codex / その他 CLI**: 自動再呼び出しが無いため、起動とブロッキング待機を 1 コマンドにまとめて実行する。`kill -0` を 1 回だけ確認して次に進むと CI 完了前に後続を実行してしまう:

  ```bash
  nohup gh pr checks ${PR_NUMBER} --watch --interval 30 > /tmp/ci_pr${PR_NUMBER}.log 2>&1 &
  echo $! > /tmp/ci_pr${PR_NUMBER}.pid
  while kill -0 "$(cat /tmp/ci_pr${PR_NUMBER}.pid)" 2>/dev/null; do sleep 30; done
  ```

  コマンドの実行環境に timeout があり `while` が途中で打ち切られた場合は、同じ `while kill -0 ...` の行だけ再実行すればよい（pid の生存確認のみでべき等）。

完了したら（Claude Code は再呼び出し / Codex は上記コマンドの return）、**まず mergeable を再確認してから** `gh pr checks ${PR_NUMBER}` で結果を確認する（待機中に base が進んでコンフリクトが発生していることがあるため、checks の合否だけで判断しない）:

```bash
gh pr view ${PR_NUMBER} --json mergeable,mergeStateStatus -q '"mergeable=\(.mergeable) mergeStateStatus=\(.mergeStateStatus)"'
```

- **mergeable=CONFLICTING** → checks の結果に関わらず上記の解消手順を行い、push 後に CI 監視をやり直す
- **mergeable=MERGEABLE** かつ **exit 0** → 全 check pass。Step 6 に進む
- **mergeable=MERGEABLE** かつ **exit ≠ 0** → 失敗 check を `gh pr checks ${PR_NUMBER}` で特定し、`gh run view <run-id> --log-failed` で失敗ログを取得。**worktree 内で修正**（repo root で修正すると main を汚染する）→ commit → push → CI 監視を再実行。fix ループは最大 3 周、超過したら人手判断を仰ぐ
- CI fail が対象 issue のスコープ外（flaky test 等）と判断した場合はユーザーに報告して判断を仰ぐ

7 観点自動レビュー（takt-review スキル）は本 skill では起動しない。ユーザーが明示的に依頼した場合のみ別途起動する（takt-review は read-only。レビュー結果を報告するだけで fix はしない）。

### 6. クリーンアップ

```bash
# tasks.yaml と worktree 削除（--branch 必須）
takt list --non-interactive --action delete --branch takt/<N>/<slug> --yes
```

ローカルブランチ `takt/<N>/<slug>` は PR が merge されたあとに `clean-branch` スキルで一括削除する（merge 前に削除すると PR の差分元が失われる）。

クリーンアップ後に takt-review を回しても問題ない。takt-review は read-only（レビュー結果を報告するだけで fix はしない）ため、worktree の再作成は不要。

### 7. スコープ外の発見は別 issue 化

builtin の `default` / `default-mini` workflow には **スコープ外発見の自動 issue 起票機能はない**（スコープ外を自動で `gh issue create` する step は builtin に含まれない）。スコープ外を見つけたら本セクションの人手手順（`issue` スキルへの引き渡し）で必ず別 issue に切り出す。

takt の実行中・完了後にスコープ外の問題に気付いたら、**worktree 内で直接修正してはならない**。スコープを膨らませると PR レビューが肥大化し、takt builtin の「タスク指示書の文言を拡大解釈しない」スコープ規律にも反する。

代わりに次の手順で別 issue として起票する:

1. 呼び出し元のセッションで作業を続ける（worktree 内では編集しない）
2. `issue` スキルを起動して、発見した問題を新規 issue として登録
3. 必要なら原 issue の PR 本文や takt の summary に「関連: #<新 issue>」を追記
4. 新 issue は次回の takt サイクルで処理する（その場で連続着手しない）

具体例:

| 発見 | 対応 |
|---|---|
| 無関係なテストの flakiness | 別 issue（バグ報告） |
| 触ったファイルの古いコメント / 型注釈不足 | 別 issue（chore） |
| 依存ライブラリの軽微な脆弱性 | 別 issue（security / chore） |
| 設計上の重複・抽象化したくなる箇所 | 別 issue（refactor）、ただし `improve` の監査で検出される類なら起票前に重複確認 |
| 同じ PR の他 issue 領域への波及 | takt のスコープ内なので worktree で直す（積み上げ運用なら base ブランチに merge してから次 takt） |

判断に迷うときの基準: **「この修正を入れたら PR タイトルが変わるか?」**。変わるならスコープ外 → 別 issue。

## Gotchas

- **to-issues / 手動作成の issue は takt 非互換**: `to-issues` スキルは `## What to build` / `## Acceptance criteria` テンプレートを使い、takt の plan.md が期待する `## 参照資料` / `## 要件` / `## スコープ外` を持たない。Step 0 の正規化で自動変換する。正規化なしで `takt run` すると plan の品質が劣化し、レビュー REJECT ループに陥りやすい
- **スコープ肥大 issue は分割が先**: 要件 8 件以上・影響ファイル 10 以上・独立機能領域 2 つ以上の issue は、takt run 前に sub-issue に分割する。大きすぎる issue を丸ごと回すとスコープ超過→レビュー REJECT→修正で結果的にトークンを浪費する
- **`npx takt` は不要**: `takt` を直接使う。`npx` は package resolution と余計なログの原因になるため、この skill では使わない
- **takt -i は worktree を作らない**: 「対話モードで」と言われても worktree が必要なら `takt add` 経路を使う
- **非 TTY の `takt add` は workflow を誤選択しやすい**: UI に応答できず `default` が選ばれることがある。非 TTY で追加したら `takt run` 前に `.takt/tasks.yaml` を読み、今回の `status: pending` task の `workflow` を確認・補正する
- **前景の `takt run` 監視は禁止**: 完了時に stdout / trace / JSONL が大量に返り、呼び出し元の会話コンテキストを数十万 token 消費しうる。stdout はログにリダイレクトし、完了は Claude Code なら `run_in_background` の自動再呼び出し、Codex なら `while kill -0 ...; do sleep 30; done` のブロッキング待機（1 コマンド）で検知する。`kill -0` の単発チェックだけで次に進むと、プロセスが実行中のまま後続が走ってしまう
- **全文ログを読まない**: `.takt/runs/**/logs/*.jsonl`、`trace.md`、長い log 出力は全文表示しない。`du` / `wc` / `jq` で集計し、必要なら `tail -80` または該当 report だけ読む
- **`--branch` 省略不可**: `takt list --non-interactive --action delete` は branch 名を明示しないとエラー
- **完了検知は poll しない**: `takt -q run` が exit した時点で全 task 完了。Claude Code は `run_in_background` の自動再呼び出しに任せて **こちらから poll しない**。Codex は自動再呼び出しが無いので `while kill -0 ...; do sleep 30; done` を 1 コマンドとして実行し、その呼び出し自体をプロセス終了までブロックさせる（`kill -0` を 1 回だけ確認して次に進むと、実行中のまま後続に進んでしまう）。`Monitor` / `ScheduleWakeup` / エージェント側の 30s 進捗 echo ループ・別 wait スクリプトは token を無駄に食うので作らない（shell 内で完結する 1 コマンドの `while` はこれに該当しない）
- **`tasks.yaml` の name prefix**: `Task created: <slug>` の slug は task 説明文先頭から自動生成される（記号は除去、80 文字程度で truncate）。複数 issue を同時に回すときは複数 task で同じ prefix になりがちなので、prefix での絞り込みが効く
- **skill のスコープ判定**: 編集対象が **グローバル user skill**（dotfiles 管理のもの。例: takt-issue / cmux など）なら `~/01-dev/dotfiles/config/.claude/skills/` を編集する（`~/.claude/` はシンボリックリンク）。一方、**project-scoped skill**（リポジトリの `.claude/skills/` に commit され、`yt-skills sync` などで downstream に配布されるもの）はそのリポジトリ内で編集する。両者を取り違えると配布経路が壊れる
- **builtin にスコープ外自動起票は無い**: builtin の `default` / `default-mini` はいずれも spillover step を持たない。スコープ外発見は必ず Step 7 の人手手順で `issue` スキルに引き渡す
- **PR 作成で終わらない**: takt CLI の postExecutionFlow が `gh pr create` した後に GitHub Actions が走る。workflow 内のレビューはコード読みだけで CI を回さないため、必ず Step 5-C の CI 監視で green を確認してから完了とする
- **`Auto-create PR? [Y/n]` は Y を選ぶ**: takt CLI 本体の postExecutionFlow が PR を作る経路を有効化するため。workflow 側に PR 作成 step は存在しないので二重起動の懸念はない
- **既存 PR 積み上げは人手**: postExecutionFlow は既存 PR を検出すると `gh pr comment` でコメント追記するだけで base ブランチへの merge は行わない。積み上げ運用なら Step 5-B の手動 merge 手順を実行する
- **7 観点レビューは対象外**: takt-review スキルは本 skill から呼ばない。ユーザーが明示的に依頼した場合のみ別途起動する。takt-review は read-only（レビュー結果を報告するだけで fix はしない）
- **実行時間の目安**: 実装（20-40 分）+ CI（数分〜十数分）+ fix ループ（CI fail 時のみ、最大 3 周）

## Rules

- `gh issue view` で取得した本文に `## 参照資料` / `## 影響ファイル` / `## 要件` / `## スコープ外` のいずれかが欠落している場合、Step 0 の正規化を必ず実行してから Step 1 に進む。正規化をスキップして `takt run` してはならない
- 要件 8 件以上・影響ファイル 10 以上・独立機能領域混在の issue は分割を提案する。ユーザーが却下した場合のみそのまま進行する
- 起動前に方針（base branch / 分割 / workflow）をユーザーに確認する。auto モードでも判断確認は省かない
- workflow（builtin の `default` / `default-mini`）を起動前に判断・確認する。判断軸は label / 影響範囲 / テスト先行の要否。bugfix / chore / docs / 小規模 refactor は `default-mini`、feature / 中〜大規模は `default`、迷ったら `default`。いずれを選んでも builtin には spillover 自動起票がないので Step 7 の人手チェックは必須
- `npx` は使わず、`takt` を直接実行する
- 非 TTY で `takt add` した場合は、`takt run` 前に `.takt/tasks.yaml` を確認し、今回追加された `status: pending` task の `workflow` が意図通りか必ず補正する
- `Auto-create PR? [Y/n]` プロンプトは **Y** を選ぶ。PR 作成は takt CLI 本体の `postExecutionFlow` が担当する
- worktree が必要な場合は `takt add` → `takt run` 経路を強制する
- 自動コミットメッセージ（`takt: <slug>`）は書き換えず、そのまま採用する
- `takt run` は stdout をログにリダイレクトして background 起動し、前景で stdout を読まない。Claude Code は `run_in_background: true` で `takt -q run > log 2>&1` を直接投げる（`nohup`/`&` 不要）。Codex は `nohup ... &` で detach し pid を控える
- 完了検知に別 wait スクリプト・エージェント側の 30s 進捗ループ・`ScheduleWakeup`・`Monitor` を作らない。`takt -q run` は全 task 消化後に exit するので、Claude Code は exit の自動再呼び出しを待ち（poll しない）、Codex は `while kill -0 "$(cat pidfile)" 2>/dev/null; do sleep 30; done` を 1 コマンドとして実行しプロセス終了までブロックする。禁止されるのは「エージェントが複数ターンに分けて `kill -0` を再チェックする」進捗ループであり、1 コマンド内で完結する `while` ループは該当しない（`kill -0` を 1 回だけ見て次に進んではならない）
- `.takt/runs/**/logs/*.jsonl` と `trace.md` は全文表示しない。必要時は `wc` / `du` / `jq` / `tail -80` で絞る
- レビュー結果は `.takt/runs/<run_slug>/reports/` 配下のレポート（builtin の peer-review が出力する `architecture-review.md` / `ai-antipattern-review.md` / `supervisor-validation.md` 等）に出力される。完了後はこれを Read で読んでユーザーに表示する。PR URL は `tasks.yaml` の `pr_url` または `gh pr list --head takt/<N>/<slug>` で取得する
- 既存 PR 積み上げ（5-B）は builtin に無いため skill 側で手動 merge → `gh pr edit` を実行する。新規 PR 作成（5-A）は postExecutionFlow に任せ、`gh pr create` を手動実行しない
- PR 作成・積み上げ後は Step 5-C の CI 監視で green を確認してから完了とする。CI 監視は前景で `--watch` せず、`gh pr checks --watch` を wrapper なしで redirect 付き background 投げする（Claude Code は exit の自動再呼び出し / Codex は pid の `kill -0`）
- CI 監視は checks の合否だけで判断しない。待機の前後で `gh pr view --json mergeable,mergeStateStatus` を確認し、`CONFLICTING`/`DIRTY` なら checks の結果に関わらずコンフリクト解消を優先する（base とコンフリクトしていると checks がいつまでも揃わず待機が伸び続けることがあるため）
- CI fail 時は worktree 内で修正する（repo root で修正すると main を汚染する）。fix ループは最大 3 周、超過やスコープ外 fail（flaky 等）はユーザーに報告して判断を仰ぐ
- 7 観点自動レビュー（takt-review スキル）は実行しない。ユーザーが明示的に依頼した場合のみ別途起動する
- 現 issue のスコープ外の問題を見つけても worktree 内で直接修正しない。builtin の `default` / `default-mini` には spillover 自動起票がないので、スコープ外発見は必ず `issue` スキルで別 issue として起票し、次回の takt サイクルに回す（判断基準: 「PR タイトルが変わるか?」変わるならスコープ外）
- ローカルブランチ削除は PR merge 後に `clean-branch` スキルへ委譲（merge 前に消さない）
- 複数 issue を同時に回すときは `takt add` を直列で N 回叩いて `tasks.yaml` に並べ、`takt -q run` を **1 回だけ** background 起動する（Phase 1）。グローバル設定の `concurrency: 3` により単一プロセスが pending を最大 3 並列で消化するので、`takt run` を多重起動してはならない（実効並列度が膨らみ worktree 競合・トークン暴走を招く）。単一プロセスは全 task 消化後に exit するので、完了検知はその exit（Claude Code は自動再呼び出し / Codex は `kill -0`）で全件まとめて待つ
- 複数 task 完了後の CI 監視・fix・クリーンアップは Agent tool で task ごとにサブエージェントを並列起動する（Phase 2 dispatch）。各エージェントが Step 5-C + Step 6 を独立実行する。単一 task のときは Agent 起動不要で直列実行
