調査が完了しました。Plan を以下にまとめます。

---

# タスク計画

## 元の要求

Issue #23: takt の builtin `default` を汚さず、specv 流の多段レビュー workflow（plan → plan_review → ... → reviewers）に **`report_spillover` step**（スコープ外発見の自動 issue 化）を組み込んだ汎用 workflow `default-extended` を dotfiles に新規追加する。

## 分析結果

### 目的

- グローバル dotfiles に再利用可能な `default-extended` workflow を置き、各リポジトリで多段レビュー + スコープ外発見の自動 issue 化を享受できるようにする
- specv に閉じていた多段レビュー設計を、specv 固有の policy（`specv-conventions` / `specv-testing` / `srp`）から切り離して汎用化する
- workflow 側に `report_spillover` を組み込むことで、`takt-issue` skill 側の口頭ルールに依存せず確実にスコープ外発見が起票される

### 分解した要件

| # | 要件 | 種別 | 備考 |
|---|------|------|------|
| 1 | `config/.takt/workflows/default-extended.yaml` を新規作成（specv `default.yaml` ベース、`max_steps: 60`、`initial_step: plan`） | 明示 | base: `~/01-dev/projects/specv/.takt/workflows/default.yaml`（16 step、loop_monitors 5 本） |
| 2 | 全 step の `policy:` から `specv-conventions` / `specv-testing` / `srp` を除外し、builtin policy のみ残す | 明示 | builtin に存在しないため参照すれば facet 解決エラーになる |
| 3 | `reviewers` step の rule `next: COMPLETE` を `next: report_spillover` に差し替え | 明示 | 「すべて approved」の遷移先のみ。`fix` への遷移は維持 |
| 4 | 新規 step `report_spillover` を追加し、最終的に `next: COMPLETE` で終端する | 明示 | スコープ外発見の自動 issue 化を担当 |
| 5 | `config/.takt/facets/instructions/report-scope-spillover.md` を新規作成（スコープ判定基準・対象例・`gh issue create` 手順・出力形式） | 明示 | report_spillover step の `instruction` 参照先 |
| 6 | `config/.takt/facets/instructions/test-design.md` を specv から汎用化して持ち込む（`specv-testing` policy 参照を削除） | 明示 | test_design / test_design_fix step の `instruction` 参照先 |
| 7 | `config/.takt/facets/instructions/test-design-review.md` を specv から汎用化して持ち込む（`specv-testing` policy 参照を削除） | 明示 | test_design_review step の `instruction` 参照先 |
| 8 | `nix/packages.nix` の `# takt` セクションに `mkdir -p` 補強と新規 4 ファイル分の `link_force` を追加 | 明示 | workflow 1 + instructions 3 = 計 4 個のシンボリックリンク（既存は config.yaml 1 個のみ） |
| 9 | `config/.claude/skills/takt-issue/SKILL.md` のデフォルト workflow を `default` から `default-extended` に切り替え、対応する takt 対話プロンプト手順を更新 | 明示 | 現状 `2-A. 単独 issue の場合` 内の 6 段階プロンプト記述を更新 |
| 10 | スコープ外: specv リポジトリ `.takt/workflows/default.yaml` の削除 | 明示（ただしクロスレポ） | 別リポジトリのため本 PR では実施できない。後述の「スコープ外」に分離 |

### 参照資料の調査結果

**参照資料の実体確認:**

| 参照 | 実体 | 用途 |
|------|------|------|
| specv default workflow | `~/01-dev/projects/specv/.takt/workflows/default.yaml`（実在 16 step、loop_monitors 5 本） | base として複製 + 改変 |
| builtin default | `~/.bun/install/cache/takt@0.38.0@@@1/builtins/en/workflows/default.yaml`（7 step） | 比較対照（参考） |
| specv test-design.md | `~/01-dev/projects/specv/.takt/facets/instructions/test-design.md` | 汎用化のソース |
| specv test-design-review.md | `~/01-dev/projects/specv/.takt/facets/instructions/test-design-review.md` | 汎用化のソース |
| specv specv-testing policy | `~/01-dev/projects/specv/.takt/facets/policies/specv-testing.md` | **dotfiles に持ち込まない**（プロジェクト固有: `tests/test-utils.ts` ヘルパー、AAA 強制等） |

**判断: 参照資料の意図は「採用すべき設計アプローチ」**。specv の workflow 構造（5 つのレビューサイクル + supervise 並列）と test-design 系 instruction の出力構造（Happy/Edge/Error テーブル + Unit/E2E 責務マトリクス）を採用する。
ただし specv 固有のヘルパー（`tests/test-utils.ts`、`withTmpDir`）と policy 強制（AAA 必須）は dotfiles では汎用化の妨げになるため、汎用 instruction では「プロジェクトのテスト規約に従う」表現に置き換える。

**スコープ判断の根拠:** 参照資料は specv 流の「構造」を採用するために示されている。specv 固有の policy 文言まで複製してしまうと、`specv-testing` への参照が dotfiles 側で解決できず壊れる。汎用化は意図に沿った最小限の変形である。

**変更要/不要の判定:**

| 要件 | 変更要否 | 根拠 |
|------|---------|------|
| `config/.takt/workflows/default-extended.yaml` | **新規作成** | 現状 `config/.takt/` には `config.yaml` のみ（`ls -la config/.takt/` で workflow ディレクトリ自体が未存在） |
| `config/.takt/facets/instructions/*.md` | **新規作成** | 現状 `config/.takt/facets/` ディレクトリ自体が未存在 |
| `nix/packages.nix` の takt セクション | **変更要** | `nix/packages.nix:120-123` は config.yaml 1 個分のシンボリックリンクしかなく、`facets/` `workflows/` 用の `mkdir -p` も無い |
| `config/.claude/skills/takt-issue/SKILL.md` | **変更要** | 現状 L13・L31・L62-69 に「`default` workflow（plan → ... の 9 step）」「`カテゴリ: default`」「ワークフロー: クイックスタート/」と書かれており、新しい workflow 名・新しいカテゴリ・step 数（16 → 17）に追従する必要がある |

### スコープ

**dotfiles 内の影響範囲:**

| 対象 | 種別 |
|------|------|
| `config/.takt/workflows/default-extended.yaml` | 新規 |
| `config/.takt/facets/instructions/report-scope-spillover.md` | 新規 |
| `config/.takt/facets/instructions/test-design.md` | 新規 |
| `config/.takt/facets/instructions/test-design-review.md` | 新規 |
| `nix/packages.nix` | 変更（`# takt` セクション L120-123 のみ） |
| `config/.claude/skills/takt-issue/SKILL.md` | 変更（デフォルト workflow 名と対話プロンプト手順） |

**dotfiles 外の影響（後述「スコープ外」参照）:**

- `~/01-dev/projects/specv/.takt/workflows/default.yaml` 削除（specv リポジトリの責務）
- `~/01-dev/projects/specv/.claude/CLAUDE.md` の `.takt/workflows/default.yaml` への言及更新（specv リポジトリの責務）

### 検討したアプローチ

| アプローチ | 採否 | 理由 |
|-----------|------|------|
| dotfiles 側の `config/.takt/workflow-categories.yaml` を追加して `default-extended` を「クイックスタート」配下に配置 | 不採用 | issue の「新規ファイル」表に含まれていない。スコープ拡大を避ける。デフォルト動作で `その他` カテゴリに自動配置される（`workflowCategoryParser.js` の挙動を確認済み） |
| `report_spillover` を builtin の `summary` 出力契約で出力 | 不採用 | issue の指定通り、出力形式は `report-scope-spillover.md` instruction 内で記述する（「出力形式」がスコープに含まれている）。`output_contracts:` を省略する |
| `report_spillover` 失敗時に ABORT する | 不採用 | reviewers が approve した後の補助 step。失敗してもメイン作業は完了済みなので COMPLETE で終端し、原因はレポートに残す方が安全 |
| specv 削除を本 PR の implement 段階で `Bash rm` する | 不採用 | dotfiles worktree から別リポジトリのファイルを消すと specv リポジトリの git 状態が変わる。クロスレポの副作用は避け、後続作業として明示的に分離 |
| test-design 系 instruction 内に `tests/test-utils.ts` 例を残す | 不採用 | プロジェクト固有のヘルパー名前空間。dotfiles の汎用 instruction に含めると他リポジトリで誤誘導になる |

### 実装アプローチ

#### A. `config/.takt/workflows/default-extended.yaml`

specv `default.yaml` をベースに以下の差分を当てる。

1. **冒頭メタデータ**
   - `name: default-extended`
   - `description: テスト先行開発ワークフロー（計画 → 計画レビュー → テスト設計 → 設計レビュー → テスト実装 → テスト実装レビュー → 実装 → AIアンチパターンレビュー → 並列レビュー → スコープ外発見の起票 → 完了）`
   - `max_steps: 60`（issue 指定）
   - `workflow_config.provider_options` / `initial_step: plan` / `loop_monitors`（5 本）はそのまま継承

2. **各 step の `policy:` から除外する語**
   - `specv-conventions`、`specv-testing`、`srp` の 3 つを **どの step からも削除**（残るのは builtin の `coding`/`testing`/`review`/`ai-antipattern`）
   - 結果として `policy:` フィールドが空になる step は、フィールドごと削除する（`plan` / `plan_fix` など。builtin default も同 step は policy 無し）

3. **`reviewers` step の rule 差し替え**
   - 旧: `condition: all("approved", "すべて問題なし") next: COMPLETE`
   - 新: `condition: all("approved", "すべて問題なし") next: report_spillover`
   - `condition: any("needs_fix", ...) next: fix` はそのまま

4. **新 step `report_spillover` を `fix` の前または `reviewers` の直後に追加**

   ```yaml
   - name: report_spillover
     edit: false
     persona: supervisor
     provider_options:
       claude:
         allowed_tools:
           - Read
           - Glob
           - Grep
           - Bash       # gh issue create を実行
           - WebFetch
     instruction: report-scope-spillover
     rules:
       - condition: スコープ外発見なし、または起票完了
         next: COMPLETE
       - condition: 起票判断が不能（gh エラー含む）
         next: COMPLETE
   ```

   - `output_contracts:` は付けない（instruction 内で出力形式を定義するため）
   - `pass_previous_response: false` を付けて、巨大化した直前レスポンスに引きずられないようにする

#### B. `config/.takt/facets/instructions/report-scope-spillover.md`

INSTRUCTION_STYLE_GUIDE（`~/.bun/install/cache/takt@0.38.0@@@1/builtins/ja/INSTRUCTION_STYLE_GUIDE.md`）に従い 30 行以内に収める。

構成案:

1. 目的の宣言（1 行）: 「これまでの run で蓄積されたレポートを読み、現 issue のスコープ外で発見された改善点を別 issue として起票してください。」
2. 注意事項: 「**スコープ判定の絶対基準**: 「この修正を入れたら本 issue の PR タイトルが変わるか?」変わるならスコープ外」「現 worktree 内では新規ファイルを作成・変更しない」
3. やること（番号付き）:
   - レポート読み込み（`{report:plan.md}`、`{report:coder-scope.md}`、`{report:architect-review.md}`、`{report:supervisor-validation.md}`、`{report:ai-review.md}` 等）
   - スコープ外候補の抽出（対象例: 無関係なテストの flakiness、触ったファイルの古いコメント、依存ライブラリの軽微な脆弱性、設計上の重複、既存のリファクタ機会）
   - 各候補について「PR タイトルが変わるか?」で振るい
   - 残った候補を `gh issue create --title ... --body ...` で起票（重複起票回避のため事前に `gh issue list --search` で確認）
4. 必須出力（`##` 見出し）:
   - `## 検出したスコープ外項目`（候補一覧、テーブル）
   - `## 起票した issue`（番号 + URL + タイトルのリスト）
   - `## 起票しなかった項目`（理由付き。重複・スコープ内判定など）

#### C. `config/.takt/facets/instructions/test-design.md` / `test-design-review.md`（汎用化）

specv 版を base に以下を変更:

| 削除/置換対象 | 変更後 |
|--------------|-------|
| 「specv のテスト規約（...）は `specv-testing` policy で注入されます」段落 | 「テスト規約（Unit/E2E 判定基準・ケース区分・命名・ヘルパー）はワークフロー側で `policy: testing` 等が注入されている前提で、本ファイルは出力構造の指示のみを定義します。」 |
| `tests/test-utils.ts` の具体名 | 「プロジェクトのテストヘルパー（存在する場合）」のような汎用表現 |
| 「`specv-testing` policy に従う」「`specv-conventions` の TDD サイクル」等の policy 名直接参照 | 「ワークフローの `testing` policy に従う」「TDD サイクル（Red→Green→Refactor）を Red 段階で書ける粒度か」のような policy 名に依存しない表現 |
| `withTmpDir` 等のヘルパー名サンプル | 例として残さず、文章のみで「既存ヘルパーで書ける前提なら、想定入力欄に明記」とする |
| ファイルパス例 `tests/`, `e2e/` | 「既存テスト群」のような汎用表現に置換 |

出力構造（Happy/Edge/Error 表 + 責務分担マトリクス + 不確定要素セクション）はそのまま維持する。

#### D. `nix/packages.nix` の `# takt` セクション差分

現状 L120-123:
```nix
# takt
mkdir -p "$HOME/.takt"
link_force "${dotfilesDir}/.takt/config.yaml" "$HOME/.takt/config.yaml"
```

更新後（追加分）:
```nix
# takt
mkdir -p "$HOME/.takt"
mkdir -p "$HOME/.takt/workflows"
mkdir -p "$HOME/.takt/facets/instructions"
link_force "${dotfilesDir}/.takt/config.yaml" "$HOME/.takt/config.yaml"
link_force "${dotfilesDir}/.takt/workflows/default-extended.yaml" "$HOME/.takt/workflows/default-extended.yaml"
link_force "${dotfilesDir}/.takt/facets/instructions/report-scope-spillover.md" "$HOME/.takt/facets/instructions/report-scope-spillover.md"
link_force "${dotfilesDir}/.takt/facets/instructions/test-design.md" "$HOME/.takt/facets/instructions/test-design.md"
link_force "${dotfilesDir}/.takt/facets/instructions/test-design-review.md" "$HOME/.takt/facets/instructions/test-design-review.md"
```

理由:
- `link_force` は `mkdir -p` を内部で行わないため、サブディレクトリ毎の事前作成が必要（同 nix ファイル L113「Claude Code」セクションと同パターン）
- 4 つのシンボリックリンクは takt の facet 解決パス規約（`~/.takt/workflows/`、`~/.takt/facets/instructions/`）に従う

#### E. `config/.claude/skills/takt-issue/SKILL.md` 差分

更新箇所:

1. **L13 周辺の Overview 文言**: 「takt の `default` workflow（plan → review → test_design → ... → reviewers の 9 step）」→「takt の `default-extended` workflow（plan → ... → reviewers → report_spillover の 17 step）」（実 step 数を仕様から数えて記載）

2. **L62-69 の対話プロンプト 6 段階手順** を以下に更新:
   ```
   1. takt add '#<N>'
   2. カテゴリ: その他/ → Enter（default-extended は「その他」配下にある）
   3. ワークフロー: default-extended → Enter（specv 流多段レビュー + 自動 spillover 起票）
   4. Base branch: 現ブランチでよいか [Y/n] → ...
   5. Worktree path (Enter for auto)
   6. Branch name (Enter for auto)
   7. Auto-create PR? [Y/n]
   ```

   - `~/.bun/install/cache/takt@0.38.0@@@1/dist/infra/config/loaders/workflowCategoryParser.js` の `parseCategoryConfig` を確認した結果、`workflow_categories` に明示的に登録されていない workflow は `その他` カテゴリ（builtin ja の `others_category_name`）に自動配置される。

3. **L211-232 の「7. スコープ外の発見は別 issue 化」セクション**: workflow 側に `report_spillover` step が組み込まれた旨を冒頭に追記（「default-extended では本 step が自動で実行される」）したうえで、現状の 1〜4 番手順は「`report_spillover` が拾えなかった分の人手対応」として残す。判断基準（「PR タイトルが変わるか?」）と具体例の表は維持。

### 到達経路・起動条件

| 項目 | 内容 |
|------|------|
| 利用者が到達する入口 | `takt add '#<N>'` 実行時の対話プロンプトで「カテゴリ: その他/ → ワークフロー: default-extended」と選択する経路。さらに `takt-issue` SKILL.md で **デフォルト** として案内される |
| 更新が必要な呼び出し元・配線 | `nix/packages.nix`（4 シンボリックリンク追加）、`config/.claude/skills/takt-issue/SKILL.md`（プロンプト手順の更新）、`darwin-rebuild switch --flake ~/01-dev/dotfiles` の実行（手動・README/CLAUDE.md 既述の運用通り） |
| 起動条件 | (a) `darwin-rebuild` 適用済みで `~/.takt/workflows/default-extended.yaml` などが解決可能であること、(b) 対象リポジトリで `gh` 認証済みで `gh issue create` が叩けること（spillover step 用）、(c) 対象リポジトリで `takt add` が利用可能（`.takt/config.yaml` 等の最小構成があること） |
| 未対応項目 | specv 側 `.takt/workflows/default.yaml` の削除と CLAUDE.md 文言更新（後述「スコープ外」参照） |

## 実装ガイドライン（Coder 向け）

### 参照すべき既存実装パターン

| 目的 | 参照先 |
|------|-------|
| `default-extended.yaml` 全体構造 | `~/01-dev/projects/specv/.takt/workflows/default.yaml` を一度コピーして差分修正する形が最短。差分は本計画の「実装アプローチ A」を参照 |
| step スキーマ（`output_contracts` の有無、`session: refresh` 等） | `~/.bun/install/cache/takt@0.38.0@@@1/builtins/ja/workflows/default.yaml`、および `~/.bun/install/cache/takt@0.38.0@@@1/dist/core/models/schema-base.js:157-171`（OutputContractItem スキーマで `format` は必須なので、`output_contracts` を書く場合は `format:` を必ず指定する） |
| `nix/packages.nix` の symlink 追加パターン | 同ファイル L113-118（Claude Code セクション）の `mkdir -p` + 連続 `link_force` パターンと同じ書式 |
| 新規 instruction の文体・構造 | `~/.bun/install/cache/takt@0.38.0@@@1/builtins/ja/INSTRUCTION_STYLE_GUIDE.md` および同 `builtins/ja/facets/instructions/plan.md`（命令形・`{report:filename}` 利用・`##` 見出しの必須出力） |
| spillover の判断基準・具体例 | `config/.claude/skills/takt-issue/SKILL.md:213-232`（既存の「スコープ外の発見は別 issue 化」セクションの判定表をそのまま流用） |
| 汎用化前の test-design / test-design-review | `~/01-dev/projects/specv/.takt/facets/instructions/test-design.md` / `test-design-review.md`（出力テーブル形式を維持し、specv 固有語のみ置換） |

### 変更の影響範囲（配線が必要な全箇所）

| 配線項目 | 配線先 | 注意 |
|---------|--------|------|
| 新規 instruction 4 ファイル | `nix/packages.nix` の `link_force` 追加（4 行）+ サブディレクトリ用 `mkdir -p`（2 行） | `~/.takt/workflows/`、`~/.takt/facets/instructions/` の 2 ディレクトリの `mkdir -p` が必要。既存の config.yaml と違って親ディレクトリが既存ではない |
| takt-issue デフォルト変更 | `config/.claude/skills/takt-issue/SKILL.md` の Overview 段、対話プロンプト 6 段階、step 数表記、スコープ外セクションの冒頭 | カテゴリ表記は実装上「その他」になる（`workflowCategoryParser` の挙動から確定）。「クイックスタート」と書かない |
| `default-extended.yaml` 内の step 名整合 | `loop_monitors` の cycle 内 step 名（`plan_review`/`plan_fix`/`test_design_review`/`test_design_fix`/`write_tests_review`/`write_tests_fix`/`ai_review`/`ai_fix`/`reviewers`/`fix`）が `steps` の各 `name:` と一致しているか | specv の名前をそのまま採用すれば自動で揃う |
| `reviewers` rule の遷移先 | `next: report_spillover` が新 step 名と一致しているか | typo に注意 |

### このタスクで特に注意すべきアンチパターン

1. **specv 固有 policy の名前を残す**: `policy: [..., specv-conventions]` を消し忘れると、dotfiles の facet 解決時に「facet 未定義」エラーで workflow が起動しなくなる。grep で `specv-` を検索し残骸ゼロを確認する。
2. **builtin に存在する instruction 名と衝突させる**: `report-scope-spillover` は builtin に無いので OK。`test-design` / `test-design-review` も builtin に無いことを確認済み（`~/.bun/install/cache/takt@0.38.0@@@1/builtins/ja/facets/instructions/` を ls 済み）。これらは dotfiles 側 `~/.takt/facets/instructions/` への配置で初めて参照可能になる。
3. **specv リポジトリへの誤った副次変更**: 本 worktree から `~/01-dev/projects/specv/...` を編集してはならない。スコープ外のクロスレポ作業として後続フェーズに分離する（Coder の implement step では `Edit`/`Write` 対象を dotfiles 内に限定）。
4. **`output_contracts.report.format` 省略**: スキーマ上 `format` は必須（`schema-base.js:157`）。`report_spillover` step で `output_contracts` を書きたくなったら、書かずに省略するか、`summary` 等の builtin format を再利用する。
5. **`mkdir -p` 不足によるシンボリックリンク失敗**: `link_force` は親ディレクトリを作らない。`workflows/`・`facets/instructions/` の双方を事前 `mkdir -p` する。
6. **対話プロンプトのカテゴリ表記**: takt-issue SKILL.md の更新時、「カテゴリ: クイックスタート/」のままにすると default-extended が実際にはそこに居ないため、ユーザー操作で迷子になる。`その他` 表記に揃える。
7. **takt-issue SKILL.md の step 数表記**: 現状 L13 の「9 step」は specv の旧表記の流用（実体は 16 step）。default-extended では 17 step（report_spillover 追加）になるが、SKILL.md の文言は「概要」レベルなので「多段レビュー + 自動スコープ外起票」のような定性的表記に留め、step 数の固有値はメンテ負債を避けるため避けるとよい。
8. **AAA / GWT の混在強制**: 汎用化した test-design.md で AAA を強制すると builtin `testing` policy（GWT を使用）と矛盾する。汎用版は **「ワークフローの testing policy に従う」とだけ書き、AAA も GWT も明記しない**。

### 利用者向け機能の到達経路に関する変更箇所

- `config/.claude/skills/takt-issue/SKILL.md`: 対話プロンプト手順（L62-69）と Overview（L13）と「スコープ外発見」セクション冒頭（L211 付近）の 3 か所
- `nix/packages.nix` の `# takt` セクション L120-123: 4 つのシンボリックリンク + 2 つの `mkdir -p` 追加
- `darwin-rebuild switch --flake ~/01-dev/dotfiles`（実行はユーザー）: シンボリックリンクの実体反映

## スコープ外

| 項目 | 除外理由 |
|------|---------|
| `~/01-dev/projects/specv/.takt/workflows/default.yaml` の削除 | dotfiles リポジトリの worktree から別リポジトリ（specv）の追跡ファイルを削除すると、specv 側の git 状態に副作用が出るため本 PR では実施不可。**本 PR がマージされた後**、ユーザーが specv リポジトリ側で別 PR として削除すること。issue に削除指示があるため、本計画レポートでも明示的に「manual follow-up」として記録 |
| `~/01-dev/projects/specv/.claude/CLAUDE.md` 内の `.takt/workflows/default.yaml` への言及（L105-127）の更新 | 上と同じ理由。specv 側の追跡ファイルなので別 PR |
| `config/.takt/workflow-categories.yaml` を新規作成して `default-extended` を `クイックスタート` 等に配置すること | issue の「新規ファイル」表に含まれていないため。デフォルトの「その他」配置で動作確認可能。配置を変えたい場合は別 issue で扱う |
| 既存の builtin `default` workflow の改変 | issue は「builtin `default` を汚さず」と明示。default-extended として完全別ファイルで提供する |
| 他の言語版（en）への対応 | dotfiles の `config/.takt/config.yaml` で `language: ja` を指定済み。en 環境向けの workflow / instruction は不要 |
| spillover step が出す report ファイルの output_contract 定義 | issue は「instruction 側に出力形式を含む」と指定。output_contract facet（`facets/output-contracts/`）を新設しない |

## 確認事項

- **issue 検証セクションの「『レビュー/』配下に default-extended が出現することを確認」は「『その他/』配下」のタイポという理解でよいか?**
  - 根拠: file change 表に `workflow-categories.yaml` が含まれず、`workflowCategoryParser.js` を読んだ結果、未登録 workflow は自動的に `その他` カテゴリ（`others_category_name`）に分類される。「レビュー」カテゴリには `review-*` 系・`audit-*` 系のみが登録されており、`default-extended`（多段 TDD + 自動 spillover）の性質とも一致しない。
  - もし本当に「レビュー」カテゴリ配下に出したい場合は、新規ファイル `config/.takt/workflow-categories.yaml`（オーバーレイ）の追加が必要になりスコープが 1 ファイル増える。