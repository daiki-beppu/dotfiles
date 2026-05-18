---
name: takt
description: >
  takt CLI（タスク登録・workflow 駆動・worktree 自動生成・catalog 機構）のコマンドリファレンス。
  本文に記載のあるコマンド・設定ファイル・workflow 概要に限定し、未収録のサブコマンド挙動は保証しない。
  「takt の使い方」「takt のコマンド教えて」「default-extended と default-mini の違い」
  「takt catalog って何」「workflow を eject したい」「tasks.yaml の見方」など、
  takt 本体の仕様・コマンド・設定に関わる場面で発動すること。
  issue → PR の一連のワークフロー実行は takt-issue スキルを使う（本 skill はその補助参照）。
---

# takt — コマンドリファレンス

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
| **workflow** | step の連なりとループ制御 | `~/.takt/workflows/*.yaml`（builtin） / `.takt/workflows/*.yaml`（プロジェクト） |
| **step** | 1 回の AI 実行単位。persona・policy・instruction・output_contract を組み合わせる | workflow YAML 内 `steps:` |
| **facet** | step に注入される素材（persona / policy / knowledge / instruction / output-contract） | builtin カタログ + `.takt/facets/<type>/<name>.md` で上書き |
| **タスク状態** | 実行中の task 一覧と status、run ログ | `.takt/tasks.yaml`, `.takt/runs/`, `.takt/clone-meta/` |

workflow 詳細（builtin の `default-extended` / `default-mini` の step 構成・ループ制御）は
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
2. workflow 選択（後述の `default-extended` / `default-mini` など）
3. base branch 確認 `[Y/n]`
4. worktree path（Enter で auto）
5. branch name（Enter で auto → `takt/<N>/<slug>`）
6. auto-create PR `[Y/n]`

登録された task は `.takt/tasks.yaml` に追記され、`takt run` で実行される。

### takt run

```bash
takt run                    # pending な task を順次実行
takt run --ignore-exceed    # max_steps 超過しても継続
```

各 task について `.takt/clone-meta/` に worktree を作成し、workflow を起動する。
進行中の status は `.takt/tasks.yaml` の `status` フィールド（`running` → `completed` /
`failed` / `aborted`）に反映される。長時間 workflow の完了検知は status を poll する。

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
takt eject default-extended                   # workflow をコピー → .takt/workflows/
takt eject persona planner                    # persona facet をコピー → .takt/facets/personas/
takt eject instruction test-design            # instruction facet をコピー → .takt/facets/instructions/
takt eject persona planner --global           # ~/.takt/ にコピー（全プロジェクト共通化）
```

eject 後、workflow 内で同名 facet を参照すると **プロジェクト版が builtin より優先**される。
編集対象は元の builtin ではなく eject 後のローカル版である点に注意。

### takt prompt

step 実行前に組み立てられる prompt をプレビューする（実行はしない）。

```bash
takt prompt default-extended    # default-extended の各 step の prompt をプレビュー
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

### プロジェクト設定（`.takt/config.yaml`）

プロジェクト固有のオーバーライド。`auto_pr` / `draft_pr` などをここで宣言する。

```yaml
draft_pr: false      # auto-PR 作成時に draft にするか
```

### タスク状態（`.takt/tasks.yaml`）

`takt add` で追記、`takt run` で消化される。

```yaml
tasks:
  - name: pr-127-https-github-com-...    # task のスラグ
    status: running                       # pending | running | completed | failed | aborted
    workflow: default-extended            # 起動した workflow
    run_slug: 20251201-143022-abc         # 実行 ID（.takt/runs/<run_slug>/ に紐づく）
```

長時間 workflow の完了検知は `status` フィールドを poll する。
名前は task 説明文先頭から自動生成（記号除去、80 文字程度で truncate）。

### 実行ログ（`.takt/runs/<run_slug>/`）

step ごとの report を保存する。`reports/plan.md` `reports/test-design.md` などの
output_contract が出力される。

### worktree メタ（`.takt/clone-meta/`）

各 task の worktree 作成メタデータ。

## Workflow

builtin の workflow は 2 種類。詳細な step 構成・ループ制御・dotfiles 内のカスタマイズは
**`references/workflows.md` に記載しているのでそちらを参照する**（step 数が多く、本文に
全てを並べると読みにくくなるため分離）。

| workflow | step 数 | max_steps | 用途 |
|----------|---------|-----------|------|
| `default-extended` | 15 | 60 | テスト先行開発。計画 → 計画レビュー → テスト設計 → テスト実装 → 実装 → AI レビュー → 並列レビュー → spillover 起票 |
| `default-mini` | 6 | 30 | テスト省略の軽量版。計画 → 実装 → AI レビュー → 並列レビュー |

両者の違いは **テスト設計／テスト実装フェーズの有無** と **`report_spillover` step の有無**。
mini は spillover の自動起票を持たないため、スコープ外発見の人手チェックが必要になる。

カスタム workflow を作るときは `takt workflow init` で雛形を起こすか、builtin を
`takt eject default-extended` でコピーして手を入れる。検証は `takt workflow doctor`。

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

dotfiles 環境では以下が eject 済み:

- `config/.takt/workflows/default-extended.yaml`（workflow 全体のカスタマイズ）
- `config/.takt/facets/instructions/test-design.md` / `test-design-review.md` /
  `report-scope-spillover.md`（instruction のカスタマイズ）

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
- **`--pipeline` と `-i` の混同**: `--pipeline` は CI 用の非対話モードで worktree なし・直接ブランチ生成。対話モードの `-i` とは別物
- **`takt export-cc` の上書き**: dotfiles で `~/.claude/skills/` を symlink 管理している環境ではエクスポートで上書きされる可能性。実行前に dotfiles 側との競合を確認する

## 関連 skill

- **`takt-issue`**: issue → worktree → workflow 実行 → PR 化 → クリーンアップまでの一連手順。実際に takt を回すときの主役。本 skill は takt-issue から「コマンド詳細はこちら」と参照される補助リファレンス
- **`branch-clean`**: takt が残したローカルブランチを PR merge 後に一括削除するときに併用
- **`cmux`**: takt の対話プロンプト操作を別ペインから行うときに併用（並列駆動時のレイアウト管理）
