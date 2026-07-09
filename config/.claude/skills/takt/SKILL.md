---
name: takt
description: >-
  takt CLI(タスク登録・workflow 駆動・worktree 自動生成・catalog)のコマンドリファレンス。「takt の使い方」「default と lite の違い」「workflow を eject したい」など takt 本体の仕様・コマンド・設定の場面で発動。issue → PR の実行は takt-issue スキルを使う。
---

# takt — コマンドリファレンス

> Note: 本文に記載のあるコマンド・設定ファイル・workflow 概要に限定し、未収録のサブコマンド挙動は保証しない。

takt は AI エージェントによるタスク実行を **workflow** として段階化し、worktree 単位で並走させる
CLI ツール。issue や自然文タスクを `.takt/tasks.yaml` に積み、step ごとに persona / policy /
instruction を切り替えながら計画 → 実装 → レビューを進める。

本 skill は CLI そのもののリファレンス。issue → PR まで通して回す手順は
`takt-issue` skill に任せ、こちらは「コマンドの引数」「workflow の中身」「設定ファイル」を
即引きするための参照源として位置付ける。

## 全体像

takt の構成要素は 4 階層に分かれる。

| 層 | 役割 | 実体 |
|----|------|------|
| **workflow** | step の連なりとループ制御 | `~/.bun/install/global/node_modules/takt/builtins/ja/*.yaml`（builtin） / `~/.takt/workflows/*.yaml`（eject 後の上書き） / `.takt/workflows/*.yaml`（プロジェクト） |
| **step** | 1 回の AI 実行単位。persona・policy・instruction・output_contract を組み合わせる | workflow YAML 内 `steps:` |
| **facet** | step に注入される素材（persona / policy / knowledge / instruction / output-contract） | builtin カタログ + `.takt/facets/<type>/<name>.md` で上書き |
| **タスク状態** | 実行中の task 一覧と status、run ログ | `.takt/tasks.yaml`, `.takt/runs/`, `.takt/clone-meta/` |

workflow 詳細（builtin `default` とカスタム `lite` の step 構成・subworkflow 内訳）は
`references/workflows.md`、facet カタログの個別一覧は `references/catalog.md` を参照。

## コマンドリファレンス

### takt add

```bash
takt add '#28'              # GitHub issue を task として登録（引用符必須）
takt add "リファクタの方針を整理"   # 自然文タスクで登録
takt add                    # 引数省略時は対話プロンプトで task 内容を入力
```

実行すると以下の対話プロンプトが順に出る。

1. カテゴリ選択
2. workflow 選択（後述の `default` / `lite` など）
3. base branch 確認 `[Y/n]`
4. worktree path（Enter で auto）
5. branch name（Enter で auto → `takt/<N>/<slug>`）
6. auto-create PR `[Y/n]`

登録された task は `.takt/tasks.yaml` に追記され、`takt run` で実行される。

### takt run

```bash
takt run                    # pending な task を実行（concurrency 設定で並列化）
takt run --ignore-exceed    # max_steps 超過しても継続
```

各 task について `.takt/clone-meta/` に worktree を作成し、workflow を起動する。
進行中の status は `.takt/tasks.yaml` の `status` フィールド（`running` → `completed` /
`failed` / `aborted`）に反映される。`takt run` は pending task を全て消化してから exit するため、
長時間 workflow の完了検知は `status` を外部から poll せず、この exit をそのまま使う
（background 実行 + exit 検知。詳細は `takt-issue` skill を参照）。

**`takt run` 1 コマンドで pending を並列消化する**。`concurrency`（後述の設定ファイル節）が
`1` なら逐次、`2` 以上ならワーカープールで最大 `concurrency` 件を同時実行し、ワーカーが空くたびに
次の pending を `task_poll_interval_ms` 間隔で取得する（`runAllTasks` → `claimNextTasks(concurrency)`
→ `runWithWorkerPool`）。複数 issue を並列で回すために `takt run` を多重起動する必要はない。

### takt watch

```bash
takt watch                  # tasks.yaml を監視して新規 task を自動実行
takt watch --ignore-exceed
```

`takt run` の常駐版。`takt add` で task が増えるたびに即座に実行する。

### takt list

worktree（task ブランチ）の管理コマンド。デフォルトは対話 TUI。

```bash
takt list                                          # TUI で一覧 → 操作選択

# 非対話モード（CI / スクリプト用）
takt list --non-interactive --action diff
takt list --non-interactive --action delete --branch takt/28/refactor-foo --yes
takt list --non-interactive --action merge  --branch takt/28/refactor-foo
takt list --non-interactive --action try    --branch takt/28/refactor-foo
takt list --non-interactive --format json   --action diff
```

| `--action` | 動作 |
|------------|------|
| `diff`   | task ブランチの差分表示 |
| `try`    | 一時的に main に merge してビルド確認 |
| `merge`  | 本番 merge |
| `delete` | worktree とブランチ削除（`--branch` 必須） |

### takt workflow

workflow 定義の作成・検証ユーティリティ。

```bash
takt workflow init my-flow      # 雛形を .takt/workflows/my-flow.yaml に生成
takt workflow doctor             # 全 workflow を検証
takt workflow doctor my-flow     # 特定 workflow のみ検証
```

builtin workflow の中身を見るときは `takt eject` で取り出すか、
`~/.takt/workflows/` 配下を直接読む（後述 [Workflow](#workflow) 節参照）。

### takt catalog

builtin facet の一覧を表示する。

```bash
takt catalog                    # 型ごとの件数サマリ
takt catalog personas           # persona 一覧
takt catalog policies           # policy 一覧
takt catalog knowledge          # knowledge 一覧
takt catalog instructions       # instruction 一覧
takt catalog output-contracts   # output-contract 一覧
```

各 facet の中身は `takt catalog` では表示されない。中身を読みたい場合は次の
`takt eject` で取り出す。個別 facet の名前と役割は `references/catalog.md` を参照。

### takt eject

builtin の workflow や facet をプロジェクトにコピーしてカスタマイズ可能にする。

```bash
takt eject default                            # workflow をコピー → .takt/workflows/
takt eject persona planner                    # persona facet をコピー → .takt/facets/personas/
takt eject instruction finalize-pr            # instruction facet をコピー → .takt/facets/instructions/
takt eject persona planner --global           # ~/.takt/ にコピー（全プロジェクト共通化）
```

eject 後、workflow 内で同名 facet を参照すると **プロジェクト版が builtin より優先**される。
編集対象は元の builtin ではなく eject 後のローカル版である点に注意。

### takt prompt

step 実行前に組み立てられる prompt をプレビューする（実行はしない）。

```bash
takt prompt default             # default の各 step の prompt をプレビュー
takt prompt                     # 現在のプロジェクト workflow をプレビュー
```

workflow の挙動をデバッグするときに使う。

### takt export-cc / takt export-codex

workflow / persona / instruction を Claude Code skill 形式（`~/.claude/`）や
Codex skill 形式（`~/.agents/`）にエクスポートする。

```bash
takt export-cc        # ~/.claude/ 配下に skill としてエクスポート
takt export-codex     # ~/.agents/ 配下にエクスポート
```

dotfiles で skill を管理している環境では、エクスポート先がシンボリックリンクで上書き
される可能性があるため利用前に注意する。

### その他

```bash
takt clear            # AI セッション履歴をクリア
takt reset            # 設定をデフォルトに戻す
takt metrics          # 分析メトリクス表示
takt purge            # 古いメトリクスファイルを削除
takt repertoire       # repertoire パッケージ管理
```

## グローバルオプション

`takt <task>` または `takt -i <N>` のように **サブコマンド未指定で task を直接実行** する場合に使う。

| オプション | 意味 | 注意 |
|------------|------|------|
| `-i <N>` / `--issue <N>` | issue 番号で task 起動 | **対話モード扱い。worktree を作らない。現ブランチで実行する** |
| `--pr <N>` | PR のレビューコメントを取得して修正 task を起動 | |
| `-w <name>` / `--workflow <name>` | workflow を指定 | builtin 名 or ファイルパス |
| `-b <name>` / `--branch <name>` | ブランチ名指定 | 省略時は `takt/<N>/<slug>` |
| `--auto-pr` | 実行成功後に PR を作成 | |
| `--draft` | PR を draft で作成 | `--auto-pr` または config の `auto_pr` 必須 |
| `--repo <owner/repo>` | 対象リポジトリ | 省略時はカレント |
| `--provider <name>` | agent プロバイダ上書き | `claude-sdk` / `claude` / `codex` / `opencode` / `cursor` / `copilot` / `mock` |
| `--model <name>` | model 上書き | provider 依存 |
| `-t <text>` / `--task <text>` | task 内容を文字列指定 | issue 番号の代替 |
| `--pipeline` | パイプラインモード（非対話・worktree なし・直接ブランチ作成） | CI 用 |
| `--skip-git` | branch / commit / push をスキップ | `--pipeline` 併用 |
| `-q` / `--quiet` | AI 出力を抑制 | CI 用 |
| `-c` / `--continue` | 直前のアシスタントセッションから継続 | |

**`-i` の落とし穴**: 対話モード扱いで worktree を作らない。worktree が欲しい場合は
`takt add` → `takt run` 経路を使う（takt-issue skill のデフォルト経路）。

## 設定ファイル

### グローバル設定（`~/.takt/config.yaml`）

dotfiles 環境では `~/01-dev/dotfiles/config/.takt/config.yaml` への symlink。

```yaml
provider: claude     # デフォルト agent provider
language: ja         # 出力言語
```

### 並列実行（`concurrency` / `task_poll_interval_ms`）

`takt run` / `takt watch` の **task 並列駆動** を制御するキー。グローバル設定（`~/.takt/config.yaml`）
またはプロジェクト設定（`.takt/config.yaml`）の **どちらでも** 宣言でき、解決はプロジェクト → グローバル
の順（local 優先）。

```yaml
concurrency: 3               # 同時実行する task 数。1=逐次（デフォルト）、2〜10=ワーカープール並列
task_poll_interval_ms: 500   # 空きワーカーが次の pending を探す間隔（ms）。デフォルト 500、範囲 100〜5000
```

- **デフォルトは `concurrency: 1`（逐次）**。`2` 以上にすると `takt run` 1 コマンドが pending を
  最大 `concurrency` 件まで同時実行し、終わったワーカーが `task_poll_interval_ms` 間隔で次を取得する
- zod スキーマ上の制約: `concurrency` は整数 `1〜10`、`task_poll_interval_ms` は整数 `100〜5000`。
  範囲外は config ロード時に弾かれる
- YAML はスネークケース（`task_poll_interval_ms`）で書くが、takt 内部では camelCase
  （`taskPollIntervalMs`）に正規化される
- `concurrency > 1` のときだけ task ごとに **色分け（color index）付きの出力ラベル** が付き、
  どのログ行がどの task かを判別できる（逐次時は無色）
- 実行中に `Ctrl+C` を送ると graceful shutdown に入り、走行中の task の完了を待ってから終了する。
  ただし待ち時間は無限ではなく既定 10 秒（非対話実行は 5 秒、環境変数 `TAKT_SHUTDOWN_TIMEOUT_MS`
  で上書き可）でタイムアウトする
- dotfiles のグローバル設定は現状 `concurrency: 3` / `task_poll_interval_ms: 500` を宣言済み
  （`config/.takt/config.yaml`）。したがって `takt run` は既定で最大 3 task 並列で走る

### プロジェクト設定（`.takt/config.yaml`）

プロジェクト固有のオーバーライド。`auto_pr` / `draft_pr` などをここで宣言する。

```yaml
draft_pr: false      # auto-PR 作成時に draft にするか
```

### Persona ごとの provider 切替（`persona_providers`）

persona 単位で provider / model / provider_options を上書きするブロック。グローバル設定
（`~/.takt/config.yaml`）またはプロジェクト設定（`.takt/config.yaml`）に宣言する。

```yaml
persona_providers:
  coder:
    provider: codex
    model: gpt-5
  planner:
    provider: codex
    model: gpt-5
```

- キーは YAML 上はスネークケース（`persona_providers` / `provider_options`）で書くが、
  takt 内部では camelCase に正規化される
- persona 単位で上書きできるフィールドは `provider` / `model` / `provider_options`
- 上の例は実装で最も動く `coder` persona（write_tests / implement / ai_fix / fix 等）と
  プランニングの `planner` を Codex の `gpt-5` に振り、Claude Code Max のトークン枠を
  レビュー・監督に温存しつつ Codex 側のデフォルトモデル変更の影響を受けない運用構成
- reviewer 系 4 persona（requirements / testing / ai-antipattern / architecture）を
  Codex に振るなど他構成も可能。トークン消費とレビュー品質のバランスで使い分ける

provider の解決優先順は以下（上が優先）。

1. CLI flag（`--provider`）
2. `persona_providers.<persona>.provider`
3. workflow YAML の `step.provider`
4. プロジェクト設定（`.takt/config.yaml` の `provider`）
5. グローバル設定（`~/.takt/config.yaml` の `provider`）

`model` も同じ階層で解決されるため、Codex を使う persona では `model: gpt-5` のように
明示しておくと provider 側のデフォルト変更に引きずられない。

step 単位の `provider:` 切替（workflow YAML 側の宣言）は本 skill の範囲外。

### Workflow カテゴリ overlay（`~/.takt/preferences/workflow-categories.yaml`）

`takt add` の workflow 選択 UI のカテゴリ階層を独自カスタマイズするための overlay ファイル。存在すると `~/.takt/preferences/workflow-categories.yaml` の内容が **builtin より先頭に挿入され**、builtin 一式は `builtin/` サブカテゴリにまとめられる。

```yaml
workflow_categories:
  "🐱オリジナル":
    workflows:
      - default
      - lite
```

- キーは YAML 上のスネークケース `workflow_categories`
- 各カテゴリ直下の `workflows` に配置したい workflow 名を列挙する（重複可、builtin と同名でよい）
- builtin の階層自体は `<takt インストール先>/builtins/<language>/workflow-categories.yaml` で定義されており、上記 overlay とマージされる
- overlay が存在しないときは builtin の階層がそのまま使われる

dotfiles は現状 overlay を持たず、builtin の `🚀 クイックスタート/` `⚡ Mini/` ほかの階層をそのまま使う。

### タスク状態（`.takt/tasks.yaml`）

`takt add` で追記、`takt run` で消化される。

```yaml
tasks:
  - name: pr-127-https-github-com-...    # task のスラグ
    status: running                       # pending | running | completed | failed | aborted
    workflow: default                     # 起動した workflow
    run_slug: 20251201-143022-abc         # 実行 ID（.takt/runs/<run_slug>/ に紐づく）
```

長時間 workflow の完了検知は `takt run` 自体の exit を使う（`status` フィールドを外部から poll する必要はない）。
名前は task 説明文先頭から自動生成（記号除去、80 文字程度で truncate）。

### 実行ログ（`.takt/runs/<run_slug>/`）

step ごとの report を保存する。`reports/plan.md` `reports/test-report.md` などの
output_contract が出力される。

### worktree メタ（`.takt/clone-meta/`）

各 task の worktree 作成メタデータ。

## Workflow

運用する workflow は builtin の `default` とカスタムの `lite`（dotfiles 管理、builtin `default-mini` の代替）の 2 種類。詳細な step 構成・ループ制御・dotfiles 内のカスタマイズは
**`references/workflows.md` に記載しているのでそちらを参照する**（step 数が多く、本文に
全てを並べると読みにくくなるため分離）。

| workflow | step 数（親） | max_steps | 用途 |
|----------|--------------|-----------|------|
| `default` | 4 | 30 | テスト先行開発。plan → write_tests → draft → peer-review（draft / peer-review は subworkflow で実装・並列レビューを内包） |
| `lite` | 3 | 8 | 軽量版（custom、`~/.takt/workflows/lite.yaml`）。plan → implement → review。structured_output + `when:` 式で状態判定の LLM 呼び出しを削減 |

`lite` は全 step `provider: codex` を明示し、implement / review に自己監査 8 項目の policy `pre-review-checklist` を注入する。`default` の draft / peer-review subworkflow は implement → ai-antipattern-review → fix のループと、最後に arch / ai-antipattern / supervise の並列レビューを回す。いずれも **スコープ外の自動 issue 起票は持たない**。builtin の `default-mini` は lite 採用に伴い運用から外した（takt 本体には残っているので指名すれば使える）。

カスタム workflow を作るときは `takt workflow init` で雛形を起こすか、builtin を
`takt eject default` でコピーして手を入れる。検証は `takt workflow doctor`。

## Catalog（facet）

step に注入される素材。型ごとの役割は以下の通り。**個別の名前一覧と要約は
`references/catalog.md` を参照する**（instruction だけで 50 件以上あり本文には収まらない）。

| 型 | 役割 | 件数（builtin） | 形式 |
|----|------|----------------|------|
| **persona** | step を実行する「役割・視点」（planner / coder / supervisor など） | 25 | YAML |
| **policy** | 制約・規約（coding / testing / review / ai-antipattern など） | 11 | Markdown |
| **knowledge** | ドメイン知識（architecture / frontend / react / e2e-testing など） | 13 | Markdown |
| **instruction** | step 実行時の詳細指示（plan / implement / review-arch など） | 50+ | Markdown |
| **output-contract** | report ファイルの出力フォーマット仕様 | 29 | Markdown |

各 step の YAML では facet を以下のように参照する。

```yaml
- name: plan
  persona: planner               # persona 名
  policy:                         # 複数 policy を配列で
    - coding
    - review
  knowledge: architecture        # 単一 knowledge
  instruction: plan              # instruction 名
  output_contracts:
    report:
      - name: plan.md
        format: plan             # output-contract 名
```

## Eject の運用

builtin facet を直接編集してはならない（次回 takt アップデートで上書きされる）。
カスタマイズしたい場合は必ず eject してからローカル版を編集する。

dotfiles 環境は **eject なし**（builtin の `default` はそのまま使用）。カスタム資産は eject ではなく新規作成で持つ: workflow `lite` / `e2e-verify`、policy `pre-review-checklist`、schema `review-verdict`（いずれも dotfiles の `config/.takt/` 配下で git 管理、`~/.takt/` への symlink 経由で解決）。builtin を改造したくなったら以下に従って eject する。

eject 先は引数 `--global` の有無で切り替わる。

| `--global` | 配置先 | 用途 |
|------------|--------|------|
| なし（既定） | `.takt/workflows/` / `.takt/facets/<type>/` | プロジェクト固有 |
| あり | `~/.takt/workflows/` / `~/.takt/facets/<type>/` | 全プロジェクト共通 |

## Gotchas（落とし穴）

- **`takt -i <N>` は worktree を作らない**: 対話モード固定で現ブランチで作業する。worktree が必要なら `takt add` → `takt run` 経路を使う
- **`takt list --non-interactive --action delete` は `--branch` 必須**: 省略するとエラー終了する
- **自動コミットメッセージ `takt: <slug>` は書き換えない**: workflow がコミットを生成する。手動 amend するとレビュー履歴とずれる
- **builtin facet を直接編集しない**: `~/.takt/` 配下の builtin は次回更新で上書きされる。カスタマイズしたいときは必ず `takt eject` してプロジェクトまたは global に降ろす
- **`~/.takt/config.yaml` の編集**: dotfiles 環境では symlink 経由で実体は `~/01-dev/dotfiles/config/.takt/config.yaml`。実体を編集すること
- **`tasks.yaml` の name prefix**: task 名は task 説明文先頭から自動生成（記号除去、80 文字 truncate）。並列駆動時は複数 task で同じ prefix になりがちなので、prefix で絞り込みが効く
- **並列化は `concurrency` 設定であって `takt run` の多重起動ではない**: 複数 issue を並列で回したくても `takt run` を複数プロセス起動しない。`concurrency: N` を立てた `takt run` 1 コマンドが pending をプール幅 N で消化する。多重起動すると各プロセスが別々に `claimNextTasks` するため実効並列度が `N × 起動数` に膨らむ
- **`--pipeline` と `-i` の混同**: `--pipeline` は CI 用の非対話モードで worktree なし・直接ブランチ生成。対話モードの `-i` とは別物
- **`takt export-cc` の上書き**: dotfiles で `~/.claude/skills/` を symlink 管理している環境ではエクスポートで上書きされる可能性。実行前に dotfiles 側との競合を確認する

## 関連 skill

- **`takt-issue`**: issue → worktree → workflow 実行 → PR 化 → クリーンアップまでの一連手順。実際に takt を回すときの主役。本 skill は takt-issue から「コマンド詳細はこちら」と参照される補助リファレンス
- **`clean-branch`**: takt が残したローカルブランチを PR merge 後に一括削除するときに併用
- **`cmux`**: takt の対話プロンプト操作を別ペインから行うときに併用（並列駆動時のレイアウト管理）
