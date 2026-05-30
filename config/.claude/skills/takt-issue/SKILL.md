---
name: takt-issue
description: |
  takt の workflow で GitHub issue を実行するスキル。`takt add` → `takt run` 経路で worktree を作成し、
  長時間 workflow を background 実行 + `tasks.yaml` poll ループで完了検知、完了後の PR 化（takt CLI の postExecutionFlow に委譲）と積み上げ・クリーンアップまでを統一手順で行う。
  「takt で issue 対応」「takt で #N を進めて」「takt 回して」など、takt 経由で issue を実装する意図が読み取れる発話で発動する。
---

# takt-issue

## Overview

takt の workflow で GitHub issue を実装する一連の手順を自動化するスキル。worktree 作成・長時間 workflow 監視・PR 化（takt CLI の postExecutionFlow に委譲）・積み上げ・クリーンアップを抜け漏れなく実行する。takt の自動コミットメッセージ（`takt: <slug>` 形式）はそのまま採用する。

workflow は issue の性質に応じて使い分ける（いずれも builtin。dotfiles 側のカスタムは持たない）:

- **`default`**（plan → write_tests → draft → peer-review の 4 ステップ。draft / peer-review は subworkflow で内包）: feature / enhancement、複数ファイル、テスト先行で進めたい中〜大規模タスク
- **`default-mini`**（plan → draft → peer-review の 3 ステップ。テスト実装をスキップ）: bugfix / chore / docs / 小規模 refactor、単一〜少数ファイル、既存テストで挙動を確認できる軽量タスク

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
| 非 TTY の `takt add` | workflow 選択 UI に応答できず、先頭の `default` が選ばれやすい | cmux/TTY で選ぶ。非 TTY で追加した場合は **実行前に `.takt/tasks.yaml` の `workflow` を必ず確認・補正** |
| 自動コミットメッセージ | `takt: <slug>` 形式で生成される | そのまま採用する。書き換えない |
| `takt list --non-interactive --action delete` | `--branch <name>` 必須 | クリーンアップ時に明示的に渡す |
| cmux pane で対話プロンプト操作 | Enter 連鎖（`\n` を繋げて送る）は permission 拒否される | 1 プロンプト 1 操作で送る |
| workflow 実行時間 | 中規模タスクで 20〜40 分 | `takt -q run` を background + log redirect で起動し、`.takt/tasks.yaml` の `status` だけを 30s 間隔で poll する |
| Codex / ChatGPT 側の token 消費 | `takt run` の stdout / JSONL / trace を前景で読むと、完了時に数十万 token のツール出力になる | **前景で `takt run` を監視しない**。stdout は `/tmp/takt-*.log` に逃がし、必要時だけ `tail -80` する |

### Token budget guard

この skill の最重要ルール。takt の workflow 自体より、呼び出し元エージェントが takt の長い標準出力を読むことが token 消費の主因になる。

- `takt run` は原則として `takt -q run > /tmp/takt_<slug>.log 2>&1 &` で起動する
- `write_stdin` / `cmux read-screen` / `tail` で全文ログを読まない
- 読んでよいのは `tasks.yaml` の該当 task、`tail -80 /tmp/takt_<slug>.log`、必要な report markdown の該当セクションだけ
- `.takt/runs/**/logs/*.jsonl` と `trace.md` は全文表示しない。調査時は `wc -c` / `du -sh` / `jq` で集計してから必要行だけ読む
- 完了後のユーザー報告は `status`、PR URL、テスト結果、review verdict に絞る

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

- **base branch**: `main` から新規 PR を作るか / 既存 feature ブランチに積み上げるか。`takt add` の Step 4「Base branch」で選んだ branch がそのまま PR の base になる
- **issue 分割**: issue が大きすぎるなら別 skill `issue` で sub issue を先に起票
- **workflow**: `default` / `default-mini` のどちらで回すか（下表で判定）

PR 作成は takt CLI 本体の `postExecutionFlow` が workflow 完了後に自動実行する（auto-commit → push → `gh pr create`、既存 PR があれば `gh pr comment` で追記）。`takt add` の `Auto-create PR? [Y/n]` プロンプトは **Y を選ぶ**（PR を自動で作るため）。workflow 側の品質チェックは builtin の peer-review subworkflow に含まれる reviewers（arch / ai-antipattern / supervise）の並列レビューが担当する。

ワンセンテンスで方針を提案し、ユーザーの判断を仰ぐ（auto モードでも方針判断は確認する）。

#### workflow 判断基準

`gh issue view <N> --json title,body,labels` の結果から推奨を 1 文で提案する。

| issue の特徴 | 推奨 workflow |
|---|---|
| ラベル: `bug` / `chore` / `docs` / 小規模 `refactor`、単一〜少数ファイル、既存テストで挙動を確認できる | `default-mini` |
| ラベル: `feature` / `enhancement`、複数ファイル、テスト先行で進めたい | `default` |
| 判断に迷う場合 | `default`（fail-safe 側） |

builtin の `default` / `default-mini` はいずれも **スコープ外発見の自動 issue 起票機能を持たない**。スコープ外を見つけたときは Step 7 の人手手順（`issue` スキルへの引き渡し）で対応する旨をユーザーに伝える。

#### provider 構成 (参考)

`coder` persona のみ Codex、その他（`planner` / `supervisor` / reviewer 系 4 persona）は Claude。実装で最も動く coder を Codex に振り、Claude Code Max のトークン枠を温存する構成。詳細と rate limit リカバリ手順は `~/.claude/skills/takt/SKILL.md` の `persona_providers` セクションを参照。

### 2. takt add（タスク登録）

#### 2-A. 単独 issue の場合

メインペインから `cmux new-split right` で右に分割し、その新規 pane で対話プロンプトに 1 つずつ応答する（メインペインは Claude の作業領域として残す）。Codex など cmux を使わない環境では、下の「非 TTY / Codex fallback」を使う。

プロンプトは（順に）:

```
1. takt add '#<N>'                                    # issue 番号を引用符で囲む
2. Select workflow:                                   # カテゴリ選択 (下の表参照)
3. Select workflow category:                          # 個別 workflow 選択
4. Base branch: 現ブランチでよいか [Y/n]              # 現ブランチが main の場合は自動スキップされる（main が base に自動採用）。
                                                      # 既存 feature ブランチ等の場合のみ出現。積み上げなら Y、main にしたいなら n で main を入力
5. Worktree path (Enter for auto)                     # Enter
6. Branch name (Enter for auto)                       # Enter
7. Auto-create PR? [Y/n]                              # Y（PR 作成は takt CLI 本体の postExecutionFlow が担当）
```

#### 非 TTY / Codex fallback

Codex の `exec_command` などで `takt add '#<N>'` を非 TTY 実行すると、workflow 選択 UI に応答できず先頭の `default` が自動選択されることがある。非 TTY で追加した場合は、**`takt run` 前に必ず `.takt/tasks.yaml` を確認し、意図した workflow に補正する**。

```bash
takt add '#<N>'
sed -n '1,220p' .takt/tasks.yaml
```

`default-mini` で回す判断なら、該当 task の `workflow: default` を `workflow: default-mini` に変更してから実行する。既存 completed task の workflow は触らず、今回追加した `status: pending` の task だけを対象にする。

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

#### workflow カテゴリ階層（UI 上の所在）

カテゴリ → workflow の 2 段選択。dotfiles では overlay を持たず builtin の階層をそのまま使う:

| カテゴリ (出現順) | 配下の workflow | カーソル操作 (workflow 確定まで) |
|---|---|---|
| **🚀 クイックスタート/** | `default` / `default-mini` / `default-high` / `frontend` / `backend` / `dual` | Enter → Enter (`default`) / Enter → ↓1 + Enter (`default-mini`) |
| **⚡ Mini/** | `default-mini` / `frontend-mini` / `backend-mini` / `backend-cqrs-mini` / `dual-mini` / `dual-cqrs-mini` | ↓1 + Enter → Enter (`default-mini`) |

カテゴリ全体の構造は `~/.bun/install/global/node_modules/takt/builtins/ja/workflow-categories.yaml` を参照。仕様の詳細は `~/.claude/skills/takt/SKILL.md` を参照。

**重要**: 各プロンプトは個別に `cmux send-key <key>` か `cmux send "<text>\n"` で送信し、`cmux read-screen` で次プロンプトの出現を確認してから次に進む。連続送信しない（Enter 連鎖は permission 拒否される）。`↓` は `cmux send-key --surface <id> down`、確定は `cmux send-key --surface <id> enter`。

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

メインペイン（呼び出し元）は Claude の監視・集約用に残し、そこでは takt を起動しない。各 takt セッションの完了は Step 4 の background poll ループで一括検知する（`tasks.yaml` の `name` prefix で複数 task をまとめて待てるため、pane ごとに ScheduleWakeup を仕掛ける必要はない）。

サーフェス ID は `SURFACES=("$SURFACE1" "$SURFACE2" ...)` の配列で保持し、完了通知後にエラーログ確認用として `cmux read-screen` で参照する。

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

cmux pane で実行する場合も `takt -q run` を使い、pane の画面全体を読み続けない。完了後に末尾 50〜80 行だけ読む。

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

Claude Code ではこれを `Bash` の `run_in_background: true` で投げる。Codex では `nohup /tmp/wait_takt_<slug>.sh >/tmp/wait_takt_<slug>.log 2>&1 &` で投げ、必要時だけ wait log の末尾を見る。timeout は workflow の最長想定（1〜2h）を考慮して `3600000ms` 程度。

#### 完了通知が来たら

`tasks.yaml` で各 task の最終 status を確認:

- `completed` → `cmux read-screen --surface <id> --lines 50` で末尾を確認、`Auto-committed: <SHA>` / `Workflow completed (<n> iterations, <m>s)` を控える
- `failed` / `aborted` → `cmux read-screen` で原因を読み、`.takt/tasks/<run_slug>/reports/` のレポートを確認

Codex では `cmux read-screen` の代わりに以下だけ読む:

```bash
sed -n '1,220p' .takt/tasks.yaml
tail -80 /tmp/takt_<slug>.log
```

ポーリング中は他作業に context を使ってよい（前景で sleep 待ちしない）。

### 5. 完了後処理

PR 作成（auto-commit / push / `gh pr create` または既存 PR への `gh pr comment` 追記）は **takt CLI 本体の `postExecutionFlow` が workflow 完了直後に自動実行する**。skill 側で手動の `gh pr create` / `gh pr edit` は基本不要。品質チェックは builtin の peer-review subworkflow（arch-review / ai-antipattern-review / supervise の並列レビュー）が担当する。

#### 5-A. 新規 PR（base = main / master）

`takt add` で `Auto-create PR? [Y/n]` に Y を選んでいれば、postExecutionFlow が `gh pr create` で新規 PR を作る。PR 本文は固定テンプレート（`## Summary` + `## Execution Report` + `Closes #<N>` + `<!-- takt:managed -->` マーカー）。

skill 側ですべきことは:

1. `tasks.yaml` の status が `completed` になったら `cmux read-screen` 末尾 50 行を読み、PR URL を抽出（`https://github.com/.../pull/<N>` 形式）
2. PR URL と `.takt/runs/<run_slug>/reports/` 配下のレビューレポート（builtin の peer-review が出力する `architecture-review.md` / `ai-antipattern-review.md` / `supervisor-validation.md` など）を Read で読んでレビュー結果をユーザーに表示
3. `status: failed` で workflow 自体が落ちている場合は失敗ログを確認し、`fix` step でリカバリ済みか、人手介入が必要かを判断
4. PR 作成自体が失敗（auth エラー等）した場合は `tasks.yaml` の `prFailed: true` で検出できる。その時は手動で `gh pr create` するか、`/cp` skill を親 repo で叩いてリカバリ

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

### 6. クリーンアップ

```bash
# tasks.yaml と worktree 削除（--branch 必須）
takt list --non-interactive --action delete --branch takt/<N>/<slug> --yes
```

ローカルブランチ `takt/<N>/<slug>` は PR が merge されたあとに `branch-clean` スキルで一括削除する（merge 前に削除すると PR の差分元が失われる）。

### 7. スコープ外の発見は別 issue 化

builtin の `default` / `default-mini` workflow には **スコープ外発見の自動 issue 起票機能はない**（スコープ外を自動で `gh issue create` する step は builtin に含まれない）。スコープ外を見つけたら本セクションの人手手順（`issue` スキルへの引き渡し）で必ず別 issue に切り出す。

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

- **`npx takt` は不要**: `takt` を直接使う。`npx` は package resolution と余計なログの原因になるため、この skill では使わない
- **takt -i は worktree を作らない**: 「対話モードで」と言われても worktree が必要なら `takt add` 経路を使う
- **非 TTY の `takt add` は workflow を誤選択しやすい**: UI に応答できず `default` が選ばれることがある。非 TTY で追加したら `takt run` 前に `.takt/tasks.yaml` を読み、今回の `status: pending` task の `workflow` を確認・補正する
- **前景の `takt run` 監視は禁止**: 完了時に stdout / trace / JSONL が大量に返り、呼び出し元の会話コンテキストを数十万 token 消費しうる。`takt -q run > /tmp/takt_<slug>.log 2>&1 &` で起動し、`tasks.yaml` だけ poll する
- **全文ログを読まない**: `.takt/runs/**/logs/*.jsonl`、`trace.md`、長い pane 出力は全文表示しない。`du` / `wc` / `jq` で集計し、必要なら `tail -80` または該当 report だけ読む
- **cmux Enter 連鎖は permission 拒否**: `cmux send "\n\n\n"` のような連続送信は通らない。1 プロンプト 1 操作
- **`--branch` 省略不可**: `takt list --non-interactive --action delete` は branch 名を明示しないとエラー
- **完了検知の選択**: `Monitor`（素の `tail -f`）は通知ごとに cache miss が走るため selective filter を組まないと割高。`ScheduleWakeup` は完了タイミングが全く読めない場合の保険でしか正当化できない。`tasks.yaml` の status フィールドを poll できる takt では background shell + `until` ループ（30s 間隔）が最安で、これを **本 skill のデフォルト**とする
- **`tasks.yaml` の name prefix**: `Task created: <slug>` の slug は task 説明文先頭から自動生成される（記号は除去、80 文字程度で truncate）。並列駆動時は複数 task で同じ prefix になりがちなので、prefix での絞り込みが効く
- **skill のスコープ判定**: 編集対象が **グローバル user skill**（dotfiles 管理のもの。例: takt-issue / parallel / cp など）なら `~/01-dev/dotfiles/config/.claude/skills/` を編集する（`~/.claude/` はシンボリックリンク）。一方、**project-scoped skill**（リポジトリの `.claude/skills/` に commit され、`yt-skills sync` などで downstream に配布されるもの）はそのリポジトリ内で編集する。両者を取り違えると配布経路が壊れる
- **builtin にスコープ外自動起票は無い**: builtin の `default` / `default-mini` はいずれも spillover step を持たない。スコープ外発見は必ず Step 7 の人手手順で `issue` スキルに引き渡す
- **PR 作成で終わらない**: takt CLI の postExecutionFlow が `gh pr create` した後に GitHub Actions が走る。workflow 内のレビューはコード読みだけで CI を回さないため、必ず Step 5-C の `gh pr checks --watch` で GitHub Actions の完了まで待つ
- **`Auto-create PR? [Y/n]` は Y を選ぶ**: takt CLI 本体の postExecutionFlow が PR を作る経路を有効化するため。workflow 側に PR 作成 step は存在しないので二重起動の懸念はない
- **既存 PR 積み上げは人手**: postExecutionFlow は既存 PR を検出すると `gh pr comment` でコメント追記するだけで base ブランチへの merge は行わない。積み上げ運用なら Step 5-B の手動 merge 手順を実行する
- **Codex review の厳しさ**: dotfiles の `persona_providers.coder.provider: codex` は `coder` persona だけを Codex に振っており、reviewer 系は Claude（デフォルト）。Codex でレビューを回しているわけではないため、過剰指摘ループが起きるなら原因は reviewer instruction 側（builtin の `facets/instructions/review-*.md` や `ai-antipattern-review.md`）の判定基準にある。必要なら eject して「軽微 APPROVE / 重大のみ ABORT」を明記する

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
- レビュー結果は `.takt/runs/<run_slug>/reports/` 配下のレポート（builtin の peer-review が出力する `architecture-review.md` / `ai-antipattern-review.md` / `supervisor-validation.md` 等）に出力される。完了後はこれを Read で読んでユーザーに表示する。PR URL は `cmux read-screen` 末尾または `gh pr list --head takt/<N>/<slug>` で取得する
- 既存 PR 積み上げ（5-B）は builtin に無いため skill 側で手動 merge → `gh pr edit` を実行する。新規 PR 作成（5-A）は postExecutionFlow に任せ、`gh pr create` を手動実行しない
- PR 作成・積み上げ後は必ず Step 5-C で `gh pr checks --watch` を background 実行で投げて GitHub Actions の完了を待つ（`tasks.yaml` poll と同じ「完了時 1 通知」パターン）。CI fail なら `gh run view <run-id> --log-failed` で原因を確認し、修正 push → 5-C 再実行までを skill 内で完結させる
- 現 issue のスコープ外の問題を見つけても worktree 内で直接修正しない。builtin の `default` / `default-mini` には spillover 自動起票がないので、スコープ外発見は必ず `issue` スキルで別 issue として起票し、次回の takt サイクルに回す（判断基準: 「PR タイトルが変わるか?」変わるならスコープ外）
- ローカルブランチ削除は PR merge 後に `branch-clean` スキルへ委譲（merge 前に消さない）
- 単独 issue でもメインペインを `cmux new-split right` で右に分割し、新規 pane で takt を実行する（メインペインは Claude 用に残す）
- 並列駆動時は 1 つ目を `cmux new-split right` で右に分割、2 つ目以降は直前のサーフェスから `cmux new-split down --surface ...` で下に積み重ねる（parallel スキルと同じレイアウト）
- メインペイン（呼び出し元）では takt を起動しない。Claude の監視・集約用に残す
