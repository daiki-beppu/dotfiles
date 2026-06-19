---
name: takt-issue
description: >-
  takt の workflow で GitHub issue を実装する(worktree 作成 → background 実行 + poll で完了検知 → PR 化 → 7 観点自動レビュー → 修正ループ → クリーンアップ)。「takt で issue 対応」「takt で #N を進めて」「takt 回して」など、takt 経由で issue を実装する意図が読み取れる発話で発動。
---

# takt-issue

## Overview

takt の workflow で GitHub issue を実装する一連の手順を自動化するスキル。worktree 作成・長時間 workflow 監視・PR 化（takt CLI の postExecutionFlow に委譲）・積み上げ・クリーンアップを抜け漏れなく実行する。takt の自動コミットメッセージ（`takt: <slug>` 形式）はそのまま採用する。

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
| workflow 実行時間 | 中規模タスクで 20〜40 分 | `takt -q run` を background + log redirect で起動し、`.takt/tasks.yaml` の `status` だけを 30s 間隔で poll する |
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

各 task の `worktree_path` / `branch` / `run_slug` は `tasks.yaml` に出る。`name` prefix が共通になるので、完了検知は Step 4 の prefix poll で一括で待てる。並列実行の仕様詳細（`concurrency` / `task_poll_interval_ms` の範囲・graceful shutdown）は `~/.claude/skills/takt/SKILL.md` の「並列実行」節を参照。

全 task 完了後のレビュー・修正は Step 5 の「複数 task の並列レビュー（Phase 2 dispatch）」で Agent ごとに並列実行する。

#### TTY で対話的に選びたい場合（オプション）

workflow 選択 UI（カテゴリ → workflow の 2 段選択）を矢印キーで選びたい場合は、ローカルターミナルで `takt add '#<N>'` を直接叩く。Claude Code の Bash ツールからは TTY が無いので使えない経路。

カテゴリ全体の構造は `~/.bun/install/global/node_modules/takt/builtins/ja/workflow-categories.yaml` を参照。仕様の詳細は `~/.claude/skills/takt/SKILL.md` を参照。

### 3. takt run（workflow 起動）

#### 原則: background + quiet + log redirect

呼び出し元エージェントの token 消費を抑えるため、`takt run` は前景で流さない。`-q` はトップレベル option なので `takt -q run` の順で指定する。

```bash
SLUG=<task-slug>
LOG=/tmp/takt_${SLUG}.log
PIDFILE=/tmp/takt_${SLUG}.pid
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
- 完了検知は Step 4 の `name` prefix poll で全 task をまとめて待つ（単一プロセスでも `tasks.yaml` の各 task の `status` は独立に更新される）

### 4. 長時間監視

`.takt/tasks.yaml` の `status` フィールド（`running` → `completed` / `failed` / `aborted`）を 30s 間隔で poll し、**完了時に 1 通知だけ受ける**。短い sleep ループを呼び出し元エージェントの前景でポーリングしない。

#### 監視コストの比較

| 手段 | 起動回数 | 1 起動あたりのコスト | 向き不向き |
|---|---|---|---|
| `ScheduleWakeup` | 25 分ごとに 1 回（固定） | cache TTL (5 分) を超えるので毎回 cache miss → フルコンテキスト読み直し | 完了タイミングが完全に読めない時の保険。30 分仕事なら 1〜2 回、1h なら 3 回起動 |
| `Monitor`（素の `tail -f`） | stdout 行ごとに 1 通知 | 通知ごとに起動＋cache miss | 通知数が膨らんで一番高い |
| `Monitor`（selective filter） | 完了/失敗 行だけ emit | 1〜2 起動 | takt のように完了行が決まっている場合に有効 |
| **background shell + `until` ループ** | **完了時に 1 起動** | **1 起動だけ** | **`tasks.yaml` の status を poll できる takt ではこれが最安。本 skill のデフォルト** |

#### 起動方法

`<task-name-prefix>` は `takt add` のログまたは `tasks.yaml` の `name` フィールドに出る slug 部分。複数 issue を同時に回すときは task で共通 prefix（例: `pr-127-https-github-com-daiki`）になるので、prefix で全件をまとめて待てる。

```bash
cat > /tmp/wait_takt_<slug>.sh <<'EOF'
#!/usr/bin/env bash
set -u
cd <repo path>
PREFIX="<task-name-prefix>"
EXPECTED=<expected_count>
STARTED=$(date +%s)
echo "[wait_takt] start $(date '+%H:%M:%S') (${EXPECTED} tasks)"
until ruby -ryaml -e '
data = YAML.load_file(".takt/tasks.yaml")
tasks = data["tasks"].select { |t| t["name"].start_with?(ARGV[0]) }
exit(tasks.length >= ARGV[1].to_i && tasks.all? { |t| %w[completed failed aborted].include?(t["status"]) } ? 0 : 1)
' "$PREFIX" "$EXPECTED"; do
  ELAPSED=$(( $(date +%s) - STARTED ))
  MINS=$(( ELAPSED / 60 ))
  SECS=$(( ELAPSED % 60 ))
  ruby -ryaml -e '
data = YAML.load_file(".takt/tasks.yaml")
tasks = data["tasks"].select { |t| t["name"].start_with?(ARGV[0]) }
summary = tasks.map { |t| "#{t["name"].split("-")[0..2].join("-")}:#{t["status"]}" }.join(" | ")
puts summary
' "$PREFIX"
  printf "[wait_takt] %dm%02ds elapsed\n" "$MINS" "$SECS"
  sleep 30
done
echo "[wait_takt] DONE $(date '+%H:%M:%S')"
ruby -ryaml -e '
data = YAML.load_file(".takt/tasks.yaml")
tasks = data["tasks"].select { |t| t["name"].start_with?(ARGV[0]) }
tasks.each { |t| puts "[#{t["status"]}] #{t["name"]} workflow=#{t["workflow"]} run_slug=#{t["run_slug"]}" }
' "$PREFIX"
EOF
chmod +x /tmp/wait_takt_<slug>.sh
```

Claude Code ではこれを `Bash` の `run_in_background: true` で投げる。Codex では `nohup /tmp/wait_takt_<slug>.sh >/tmp/wait_takt_<slug>.log 2>&1 &` で投げ、必要時だけ wait log の末尾を見る。timeout は workflow の最長想定（1〜2h）を考慮して `3600000ms` 程度。

#### 完了通知が来たら

`tasks.yaml` で各 task の最終 status を確認:

- `completed` → `tail -80 /tmp/takt_<slug>.log` で末尾を読み、`Auto-committed: <SHA>` / `Workflow completed (<n> iterations, <m>s)` を控える
- `failed` / `aborted` → `tail -80 /tmp/takt_<slug>.log` で原因を読み、`.takt/tasks/<run_slug>/reports/` のレポートを確認

参照する 3 点のみ:

```bash
sed -n '1,220p' .takt/tasks.yaml      # 各 task の最終 status / pr_url
tail -80 /tmp/takt_<slug>.log         # 末尾出力（必要時のみ）
ls .takt/runs/<run_slug>/reports/     # peer-review のレポート一覧
```

ポーリング中は他作業に context を使ってよい（前景で sleep 待ちしない）。

### 5. 完了後処理

PR 作成（auto-commit / push / `gh pr create` または既存 PR への `gh pr comment` 追記）は **takt CLI 本体の `postExecutionFlow` が workflow 完了直後に自動実行する**。skill 側で手動の `gh pr create` / `gh pr edit` は基本不要。品質チェックは builtin の peer-review subworkflow（arch-review / ai-antipattern-review / supervise の並列レビュー）が担当する。

#### 複数 task の並列レビュー（Phase 2 dispatch）

Step 4 で複数 task が完了した場合、5-C〜5-F + Step 6 を **Agent tool で task ごとにサブエージェントを並列起動**する。各エージェントが独立して CI 監視 → レビュー → 修正 → クリーンアップを完走するため、直列処理に比べて wall-clock time が約 1/N になる。

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
<repo_name> の PR レビュー〜クリーンアップを実行してください。

## 情報
- repo root: <repo_root>
- worktree: <worktree_path>
- branch: <branch>
- run_slug: <run_slug>

## 手順（repo root で実行）

1. PR 番号取得
   gh pr list --head "<branch>" --json number -q '.[0].number'

2. CI 監視（run_in_background, timeout 2400000ms）
   gh pr checks <PR#> --watch --interval 30
   - fail → gh run view <run-id> --log-failed → worktree で修正 → push → 再監視

3. レビュー（run_in_background, timeout 3600000ms）
   takt -q -t "#<PR#>" -w review-takt-default > /tmp/takt_review_<PR#>.log 2>&1

4. 判定
   RUN_SLUG=$(ls -t .takt/runs/ | head -1)
   cat .takt/runs/${RUN_SLUG}/reports/*review-summary.md
   - APPROVE → Step 6 へ
   - REJECT → Step 5 へ

5. 修正ループ（REJECT 時のみ、run_in_background, timeout 3600000ms）
   takt -q -t "#<PR#>" -w review-fix-takt-default > /tmp/takt_reviewfix_<PR#>.log 2>&1

6. クリーンアップ
   takt list --non-interactive --action delete --branch <branch> --yes

7. 最終結果を報告: status / PR URL / review verdict / 修正回数
```

3. 全エージェント完了後、結果をまとめてユーザーに報告

**注意**: サブエージェント内では `takt -t` による直接実行のみ使う（`takt add` / `takt run` は不要）。`-t` は `tasks.yaml` のキューを経由しないので複数エージェント間の競合は起きない。

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

#### 5-C. CI チェック監視

postExecutionFlow が PR を作成または積み上げた直後に GitHub Actions の完了まで待つ。`tasks.yaml` の poll と同じ「background 実行 + 完了時 1 通知」パターンで投げ、前景 sleep ループは使わない。

PR 番号は 5-A の URL 末尾、または `gh pr list --head takt/<N>/<slug> --json number -q '.[0].number'` で取得する。

```bash
PR_NUMBER=<PR#>    # 5-A は postExecutionFlow が出力した URL 末尾、5-B は積み上げ先の既存 PR 番号

cat > /tmp/wait_ci_<slug>.sh <<EOF
#!/usr/bin/env bash
set -u
cd <repo path>
echo "[wait_ci] start \$(date '+%H:%M:%S') PR=#${PR_NUMBER}"
gh pr checks ${PR_NUMBER} --watch --interval 30
EXIT=\$?
echo "[wait_ci] DONE \$(date '+%H:%M:%S') exit=\$EXIT"
gh pr checks ${PR_NUMBER}
exit \$EXIT
EOF
chmod +x /tmp/wait_ci_<slug>.sh
```

Claude Code ではこれを `Bash` の `run_in_background: true` で投げる。Codex では `nohup /tmp/wait_ci_<slug>.sh >/tmp/wait_ci_<slug>.log 2>&1 &` で投げ、必要時だけ末尾を見る。timeout は CI 最長想定 + α で `2400000ms`（40 分）程度。

完了通知が来たら:

- **exit 0** → 全 check pass。レビュー依頼へ進める
- **exit ≠ 0** → 失敗 check の job を `gh pr checks ${PR_NUMBER}` の出力で特定し、`gh run view <run-id> --log-failed` で失敗ログを取得して原因判断。修正は worktree（5-A）または積み上げ先ブランチ（5-B）で行い、push 後に再度 5-C を回す

CI fail が takt スコープ外（flaky test など）と判断した場合は Step 7 に従って別 issue に切り出す。

#### 5-D. 自動レビュー

CI pass 後、`review-takt-default` で 7 観点 read-only レビューを自動起動する。

```bash
PR_NUM=$(gh pr list --head "takt/<N>/<slug>" --json number -q '.[0].number')
REVIEW_LOG="/tmp/takt_review_${PR_NUM}.log"
```

`run_in_background: true` で実行（timeout は `3600000ms` = 60 分）:

```bash
takt -q -t "#${PR_NUM}" -w review-takt-default > "$REVIEW_LOG" 2>&1
```

完了通知が届いたら `review-summary.md` を読む:

```bash
RUN_SLUG=$(ls -t .takt/runs/ | head -1)
cat .takt/runs/${RUN_SLUG}/reports/*review-summary.md
```

`tail -80 "$REVIEW_LOG"` で末尾も確認し、takt 自体のエラーがないか見る。

#### 5-E. 判定

`review-summary.md` の `## 総合判定:` を確認:

- **APPROVE** → PR URL + review-summary の要点をユーザーに報告 → Step 6（クリーンアップ）へ
- **REJECT** → 指摘内容をユーザーに共有し、Step 5-F へ進む旨を伝える

#### 5-F. review-fix 起動（REJECT 時のみ）

`review-fix-takt-default` で再レビュー + 修正ループを自動実行する。

```bash
FIX_LOG="/tmp/takt_reviewfix_${PR_NUM}.log"
```

`run_in_background: true` で実行（timeout は `3600000ms` = 60 分）:

```bash
takt -q -t "#${PR_NUM}" -w review-fix-takt-default > "$FIX_LOG" 2>&1
```

`review-fix-takt-default` の内部フロー:
1. gather（対象情報収集）
2. reviewers（7 並列: arch / security / QA / testing / AI-antipattern / pure / coding）
3. needs_fix → fix（coder = Codex が修正）→ ai-antipattern 事前チェック → reviewers に戻る
4. 最大 5 周ループ（`loop_monitors` の supervisor が非生産的と判断したら打ち切り）
5. supervise → COMPLETE or fix_supervisor

完了通知が届いたら最終結果を確認:

```bash
RUN_SLUG=$(ls -t .takt/runs/ | head -1)
cat .takt/runs/${RUN_SLUG}/reports/*supervisor-validation.md
cat .takt/runs/${RUN_SLUG}/reports/*summary.md
```

結果をユーザーに報告 → Step 6（クリーンアップ）へ。

### 6. クリーンアップ

```bash
# tasks.yaml と worktree 削除（--branch 必須）
takt list --non-interactive --action delete --branch takt/<N>/<slug> --yes
```

ローカルブランチ `takt/<N>/<slug>` は PR が merge されたあとに `clean-branch` スキルで一括削除する（merge 前に削除すると PR の差分元が失われる）。

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

- **`npx takt` は不要**: `takt` を直接使う。`npx` は package resolution と余計なログの原因になるため、この skill では使わない
- **takt -i は worktree を作らない**: 「対話モードで」と言われても worktree が必要なら `takt add` 経路を使う
- **非 TTY の `takt add` は workflow を誤選択しやすい**: UI に応答できず `default` が選ばれることがある。非 TTY で追加したら `takt run` 前に `.takt/tasks.yaml` を読み、今回の `status: pending` task の `workflow` を確認・補正する
- **前景の `takt run` 監視は禁止**: 完了時に stdout / trace / JSONL が大量に返り、呼び出し元の会話コンテキストを数十万 token 消費しうる。`takt -q run > /tmp/takt_<slug>.log 2>&1 &` で起動し、`tasks.yaml` だけ poll する
- **全文ログを読まない**: `.takt/runs/**/logs/*.jsonl`、`trace.md`、長い log 出力は全文表示しない。`du` / `wc` / `jq` で集計し、必要なら `tail -80` または該当 report だけ読む
- **`--branch` 省略不可**: `takt list --non-interactive --action delete` は branch 名を明示しないとエラー
- **完了検知の選択**: `Monitor`（素の `tail -f`）は通知ごとに cache miss が走るため selective filter を組まないと割高。`ScheduleWakeup` は完了タイミングが全く読めない場合の保険でしか正当化できない。`tasks.yaml` の status フィールドを poll できる takt では background shell + `until` ループ（30s 間隔）が最安で、これを **本 skill のデフォルト**とする
- **`tasks.yaml` の name prefix**: `Task created: <slug>` の slug は task 説明文先頭から自動生成される（記号は除去、80 文字程度で truncate）。複数 issue を同時に回すときは複数 task で同じ prefix になりがちなので、prefix での絞り込みが効く
- **skill のスコープ判定**: 編集対象が **グローバル user skill**（dotfiles 管理のもの。例: takt-issue / cmux など）なら `~/01-dev/dotfiles/config/.claude/skills/` を編集する（`~/.claude/` はシンボリックリンク）。一方、**project-scoped skill**（リポジトリの `.claude/skills/` に commit され、`yt-skills sync` などで downstream に配布されるもの）はそのリポジトリ内で編集する。両者を取り違えると配布経路が壊れる
- **builtin にスコープ外自動起票は無い**: builtin の `default` / `default-mini` はいずれも spillover step を持たない。スコープ外発見は必ず Step 7 の人手手順で `issue` スキルに引き渡す
- **PR 作成で終わらない**: takt CLI の postExecutionFlow が `gh pr create` した後に GitHub Actions が走る。workflow 内のレビューはコード読みだけで CI を回さないため、必ず Step 5-C の `gh pr checks --watch` で GitHub Actions の完了まで待つ
- **`Auto-create PR? [Y/n]` は Y を選ぶ**: takt CLI 本体の postExecutionFlow が PR を作る経路を有効化するため。workflow 側に PR 作成 step は存在しないので二重起動の懸念はない
- **既存 PR 積み上げは人手**: postExecutionFlow は既存 PR を検出すると `gh pr comment` でコメント追記するだけで base ブランチへの merge は行わない。積み上げ運用なら Step 5-B の手動 merge 手順を実行する
- **Codex review の厳しさ**: dotfiles の `persona_providers.coder.provider: codex` は `coder` persona だけを Codex に振っており、reviewer 系は Claude（デフォルト）。Codex でレビューを回しているわけではないため、過剰指摘ループが起きるなら原因は reviewer instruction 側（builtin の `facets/instructions/review-*.md` や `ai-antipattern-review.md`）の判定基準にある。必要なら eject して「軽微 APPROVE / 重大のみ ABORT」を明記する
- **レビュー workflow の使い分け**: `review-takt-default`（read-only 7 観点）で先に判定し、REJECT 時のみ `review-fix-takt-default`（レビュー + 修正ループ一体）を起動する。`review-fix-takt-default` は内部で再レビューするため、report を PR コメントに転記する必要はない
- **レビュー込みの実行時間**: 実装（20-40 分）+ レビュー（10-20 分）+ 修正ループ（REJECT 時のみ、最大 5 周）。最悪ケースで 2-3 時間。全て `run_in_background` で起動するので呼び出し元の token 消費は最小限

## Rules

- 起動前に方針（base branch / 分割 / workflow）をユーザーに確認する。auto モードでも判断確認は省かない
- workflow（builtin の `default` / `default-mini`）を起動前に判断・確認する。判断軸は label / 影響範囲 / テスト先行の要否。bugfix / chore / docs / 小規模 refactor は `default-mini`、feature / 中〜大規模は `default`、迷ったら `default`。いずれを選んでも builtin には spillover 自動起票がないので Step 7 の人手チェックは必須
- `npx` は使わず、`takt` を直接実行する
- 非 TTY で `takt add` した場合は、`takt run` 前に `.takt/tasks.yaml` を確認し、今回追加された `status: pending` task の `workflow` が意図通りか必ず補正する
- `Auto-create PR? [Y/n]` プロンプトは **Y** を選ぶ。PR 作成は takt CLI 本体の `postExecutionFlow` が担当する
- worktree が必要な場合は `takt add` → `takt run` 経路を強制する
- 自動コミットメッセージ（`takt: <slug>`）は書き換えず、そのまま採用する
- `takt run` は `takt -q run > /tmp/takt_<slug>.log 2>&1 &` で起動し、前景で stdout を読まない
- 長時間監視は background shell + `until` ループで `.takt/tasks.yaml` の status を 30s 間隔で poll する。`ScheduleWakeup` は完了タイミングが完全に読めない場合の保険。前景 sleep ループは禁止
- `.takt/runs/**/logs/*.jsonl` と `trace.md` は全文表示しない。必要時は `wc` / `du` / `jq` / `tail -80` で絞る
- レビュー結果は `.takt/runs/<run_slug>/reports/` 配下のレポート（builtin の peer-review が出力する `architecture-review.md` / `ai-antipattern-review.md` / `supervisor-validation.md` 等）に出力される。完了後はこれを Read で読んでユーザーに表示する。PR URL は `tasks.yaml` の `pr_url` または `gh pr list --head takt/<N>/<slug>` で取得する
- 既存 PR 積み上げ（5-B）は builtin に無いため skill 側で手動 merge → `gh pr edit` を実行する。新規 PR 作成（5-A）は postExecutionFlow に任せ、`gh pr create` を手動実行しない
- PR 作成・積み上げ後は必ず Step 5-C で `gh pr checks --watch` を background 実行で投げて GitHub Actions の完了を待つ（`tasks.yaml` poll と同じ「完了時 1 通知」パターン）。CI fail なら `gh run view <run-id> --log-failed` で原因を確認し、修正 push → 5-C 再実行までを skill 内で完結させる
- 現 issue のスコープ外の問題を見つけても worktree 内で直接修正しない。builtin の `default` / `default-mini` には spillover 自動起票がないので、スコープ外発見は必ず `issue` スキルで別 issue として起票し、次回の takt サイクルに回す（判断基準: 「PR タイトルが変わるか?」変わるならスコープ外）
- ローカルブランチ削除は PR merge 後に `clean-branch` スキルへ委譲（merge 前に消さない）
- 複数 issue を同時に回すときは `takt add` を直列で N 回叩いて `tasks.yaml` に並べ、`takt -q run` を **1 回だけ** background 起動する（Phase 1）。グローバル設定の `concurrency: 3` により単一プロセスが pending を最大 3 並列で消化するので、`takt run` を多重起動してはならない（実効並列度が膨らみ worktree 競合・トークン暴走を招く）。完了検知は `name` prefix の単一 poll で全件まとめて待つ
- 複数 task 完了後のレビュー・修正は Agent tool で task ごとにサブエージェントを並列起動する（Phase 2 dispatch）。各エージェントが `takt -t` で直接実行するため `tasks.yaml` の競合は起きない。単一 task のときは Agent 起動不要で直列実行
- Step 5-C（CI pass）後は必ず Step 5-D〜F（自動レビュー → 判定 → 修正）を実行する。レビューを省略しない
- Step 5-D の `review-takt-default` で APPROVE なら 5-F（review-fix）は実行しない。修正不要で即完了
- Step 5-F の内部ループ制御は `review-fix-takt-default` の `loop_monitors` に委譲する（最大 5 周、supervisor 打ち切り）。skill 側で反復カウンタは持たない
- レビュー / 修正の takt ログも `tail -80` で必要時のみ読む（token budget guard は実装フェーズと同じ）
