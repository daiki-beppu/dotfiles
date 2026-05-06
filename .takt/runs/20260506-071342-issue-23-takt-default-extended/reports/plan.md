# タスク計画

## 元の要求

Issue #23: takt の builtin `default` を汚さず、specv 流の多段レビュー（plan → plan_review → test_design → test_design_review → write_tests → write_tests_review → implement → ai_review → reviewers）に **`report_spillover` step**（スコープ外発見の自動 issue 化）を組み込んだ汎用 workflow を新規追加する。

新規ファイル:
- `config/.takt/workflows/default-extended.yaml`（specv `default.yaml` ベース、specv-conventions / specv-testing / srp policy を除外、`reviewers` の `next: COMPLETE` を `next: report_spillover` に変更、`max_steps=60`）
- `config/.takt/facets/instructions/report-scope-spillover.md`
- `config/.takt/facets/instructions/test-design.md`（specv から汎用化）
- `config/.takt/facets/instructions/test-design-review.md`（specv から汎用化）

既存ファイル変更:
- `nix/packages.nix` の `# takt` セクションに `mkdir -p` と 4 ファイル分の `link_force` を追加
- `config/.claude/skills/takt-issue/SKILL.md` のデフォルト workflow を `default-extended` に切替・対話プロンプト手順を更新
- specv リポジトリ `.takt/workflows/default.yaml` 削除（dotfiles の default-extended を使うため）

## 分析結果

### 目的

- グローバル dotfiles に再利用可能な `default-extended` workflow を置き、各リポジトリで「specv 流の多段レビュー + スコープ外発見の自動 issue 化」を享受できるようにする
- specv に閉じていた多段レビュー設計を、specv 固有 policy（`specv-conventions` / `specv-testing` / `srp`）から切り離して汎用化する
- workflow 側に `report_spillover` を組み込むことで、`takt-issue` skill の口頭ルールに依存せず確実にスコープ外発見が起票される
- `takt-issue` skill のデフォルト workflow を `default-extended` に切り替え、新 workflow が標準導線として利用される

### 分解した要件

| # | 要件 | 種別 | 備考 |
|---|------|------|------|
| 1 | `config/.takt/workflows/default-extended.yaml` を新規作成（specv `default.yaml` ベース、`max_steps: 60`、`initial_step: plan`） | 明示 | base: `~/01-dev/projects/specv/.takt/workflows/default.yaml`（16 step、loop_monitors 5 本） |
| 2 | 全 step の `policy:` から `specv-conventions` / `specv-testing` / `srp` を除外し、builtin policy のみ残す | 明示 | dotfiles 側に該当 facet が無いため参照すれば解決エラー |
| 3 | `reviewers` step の rule `next: COMPLETE` を `next: report_spillover` に差し替え | 明示 | 「すべて approved」遷移先のみ。`fix` への遷移は維持 |
| 4 | 新規 step `report_spillover` を追加し、最終的に `next: COMPLETE` で終端する | 明示 | スコープ外発見の自動 issue 化を担当 |
| 5 | `config/.takt/facets/instructions/report-scope-spillover.md` を新規作成（スコープ判定基準・対象例・`gh issue create` 手順・出力形式） | 明示 | `report_spillover` step の `instruction` 参照先 |
| 6 | `config/.takt/facets/instructions/test-design.md` を specv から汎用化して持ち込む | 明示 | `specv-testing` policy 参照を削除し、ヘルパー名等の specv 固有要素を一般語に置換 |
| 7 | `config/.takt/facets/instructions/test-design-review.md` を specv から汎用化して持ち込む | 明示 | 同上 |
| 8 | `nix/packages.nix` の `# takt` セクションに新規 4 ファイル分の `link_force` と必要な `mkdir -p` を追加 | 明示 | 現状は config.yaml 1 個のみのリンク。サブディレクトリ `workflows/` `facets/instructions/` を新規作成する必要あり |
| 9 | `config/.claude/skills/takt-issue/SKILL.md` のデフォルト workflow を `default-extended` に切り替え、対話プロンプト手順とスコープ外セクションを更新 | 明示 | Overview・対話プロンプト 6 段階・スコープ外発見セクションの 3 箇所 |
| 10 | specv リポジトリ `.takt/workflows/default.yaml` 削除 | 明示（クロスレポ） | dotfiles worktree 外のため本 PR では実施不可。後続作業として明示分離 |

### 参照資料の調査結果

**参照資料の実体確認:**

| 参照 | 実体 | 用途 |
|------|------|------|
| specv default workflow | `~/01-dev/projects/specv/.takt/workflows/default.yaml`（16 step、loop_monitors 5 本） | base として複製 + 改変 |
| builtin default | `~/.bun/install/cache/takt@0.38.0@@@1/builtins/ja/workflows/default.yaml`（7 step） | 比較対照（参考） |
| specv test-design.md | `~/01-dev/projects/specv/.takt/facets/instructions/test-design.md` | 汎用化のソース |
| specv test-design-review.md | `~/01-dev/projects/specv/.takt/facets/instructions/test-design-review.md` | 汎用化のソース |
| specv specv-testing policy | `~/01-dev/projects/specv/.takt/facets/policies/specv-testing.md` | dotfiles に持ち込まない（プロジェクト固有: `tests/test-utils.ts`、AAA 強制等） |
| takt schema | `~/.bun/install/cache/takt@0.38.0@@@1/dist/core/models/schema-base.js:157-171` | `OutputContractItemSchema` の `format` は必須 |
| takt category loader | `~/.bun/install/cache/takt@0.38.0@@@1/dist/infra/config/loaders/workflowCategoryParser.js` | 未登録 workflow は `その他` カテゴリ（`others_category_name`）に自動分類 |
| INSTRUCTION_STYLE_GUIDE | `~/.bun/install/cache/takt@0.38.0@@@1/builtins/ja/INSTRUCTION_STYLE_GUIDE.md` | 新規 instruction の文体・構造の規範 |

**判断: 参照資料の意図は「採用すべき設計アプローチ」**。specv の workflow 構造（5 つのレビューサイクル + supervise 並列）と test-design 系 instruction の出力構造（Happy/Edge/Error テーブル + Unit/E2E 責務マトリクス）を採用する。
specv 固有のヘルパー（`tests/test-utils.ts`、`withTmpDir`）と policy 強制（AAA 必須）は dotfiles では汎用化の妨げになるため、汎用 instruction では「プロジェクトのテスト規約に従う」表現に置き換える。specv 固有 policy 名（`specv-testing` 等）の直接参照も削除する。

**スコープ判断の根拠:** 参照資料は specv 流の「構造」を採用するために示されている。specv 固有 policy 文言まで複製すると `specv-testing` への参照が dotfiles 側で解決できず壊れる。汎用化は意図に沿った最小限の変形である。

**変更要/不要の判定:**

| 要件 | 判定 | 根拠 |
|------|------|------|
| `config/.takt/workflows/default-extended.yaml` | 新規作成 | 現状 `config/.takt/` には `config.yaml` のみ（`workflows/` ディレクトリ自体未存在） |
| `config/.takt/facets/instructions/*.md` | 新規作成 | 現状 `config/.takt/facets/` ディレクトリ自体が未存在 |
| `nix/packages.nix` の takt セクション | 変更要 | L120-123 は config.yaml 1 個分のリンクのみ。`facets/` `workflows/` 用の `mkdir -p` も無し |
| `config/.claude/skills/takt-issue/SKILL.md` | 変更要 | Overview（L13）、対話プロンプト 6 段階（L62-69）、スコープ外発見セクション（L211-232）の 3 箇所が `default` workflow 前提で書かれている |

### スコープ

**dotfiles 内の影響範囲:**

| 対象 | 種別 |
|------|------|
| `config/.takt/workflows/default-extended.yaml` | 新規 |
| `config/.takt/facets/instructions/report-scope-spillover.md` | 新規 |
| `config/.takt/facets/instructions/test-design.md` | 新規 |
| `config/.takt/facets/instructions/test-design-review.md` | 新規 |
| `nix/packages.nix` | 変更（`# takt` セクション L120-123） |
| `config/.claude/skills/takt-issue/SKILL.md` | 変更（Overview / 対話プロンプト / スコープ外セクション） |

**dotfiles 外の影響（後述「スコープ外」参照）:**

- `~/01-dev/projects/specv/.takt/workflows/default.yaml` 削除（specv リポジトリの責務）
- `~/01-dev/projects/specv/.claude/CLAUDE.md` の `.takt/workflows/default.yaml` への言及更新（L105-127、specv リポジトリの責務）

### 検討したアプローチ

| アプローチ | 採否 | 理由 |
|-----------|------|------|
| dotfiles 側に `config/.takt/workflow-categories.yaml` を追加して `default-extended` を「クイックスタート」配下に配置 | 不採用 | issue の新規ファイル表に含まれない。`workflowCategoryParser.js` を確認した結果、未登録 workflow は自動的に「その他」配置されるため動作上の問題はない |
| `report_spillover` を builtin の `summary` 出力契約で出力 | 不採用 | issue は「instruction 側に出力形式を含む」と指定。`output_contracts:` を省略し、出力形式は `report-scope-spillover.md` 内で定義する |
| `report_spillover` 失敗時に ABORT する | 不採用 | reviewers が approve した後の補助 step。失敗してもメイン作業は完了済みなので COMPLETE で終端し、原因はレポートに残す |
| specv 削除を本 PR の implement 段階で `Bash rm` する | 不採用 | dotfiles worktree から別リポジトリのファイルを消すと specv の git 状態が変わる。クロスレポ副作用は避け、後続作業として明示分離 |
| test-design 系 instruction 内に `tests/test-utils.ts` 等の例を残す | 不採用 | プロジェクト固有のヘルパー名前空間。dotfiles の汎用 instruction に残すと他リポジトリで誤誘導 |
| 汎用化版 test-design.md で AAA を強制 | 不採用 | builtin `testing` policy は GWT を採用。AAA 強制は矛盾するため、汎用版は「ワークフローの testing policy に従う」表現に留める |

### 実装アプローチ

#### A. `config/.takt/workflows/default-extended.yaml`

specv `default.yaml` をベースに以下の差分を当てる。

1. **冒頭メタデータ**
   - `name: default-extended`
   - `description: テスト先行開発ワークフロー（計画 → 計画レビュー → テスト設計 → 設計レビュー → テスト実装 → テスト実装レビュー → 実装 → AIアンチパターンレビュー → 並列レビュー → スコープ外発見の起票 → 完了）`
   - `max_steps: 60`（issue 指定）
   - `workflow_config.provider_options` / `initial_step: plan` / `loop_monitors`（5 本）はそのまま継承

2. **各 step の `policy:` から除外する語**
   - `specv-conventions` / `specv-testing` / `srp` をどの step からも削除
   - 結果として `policy:` フィールドが空になる step は、フィールドごと削除（`plan` / `plan_fix` 等。builtin default も同 step は policy 無し）
   - 残るのは builtin の `coding` / `testing` / `review` / `ai-antipattern` のみ

3. **`reviewers` step の rule 差し替え**
   - 旧: `condition: all("approved", "すべて問題なし") next: COMPLETE`
   - 新: `condition: all("approved", "すべて問題なし") next: report_spillover`
   - `condition: any("needs_fix", ...) next: fix` はそのまま

4. **新 step `report_spillover` を `reviewers` の直後（`fix` の前）に追加**

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
     pass_previous_response: false
     rules:
       - condition: スコープ外発見なし、または起票完了
         next: COMPLETE
       - condition: 起票判断が不能（gh エラー含む）
         next: COMPLETE
   ```

   - `output_contracts:` は付けない（instruction 内で出力形式を定義）
   - `pass_previous_response: false` で巨大化した直前レスポンスに引きずられないようにする

#### B. `config/.takt/facets/instructions/report-scope-spillover.md`

INSTRUCTION_STYLE_GUIDE に従い 30 行以内に収める。構成:

1. **目的の宣言（1 行・命令形）**: 「これまでの run で蓄積されたレポートを読み、現 issue のスコープ外で発見された改善点を別 issue として起票してください。」
2. **注意事項**: 「**スコープ判定の絶対基準**: 『この修正を入れたら本 issue の PR タイトルが変わるか?』変わるならスコープ外」「現 worktree 内では新規ファイルを作成・変更しない」
3. **やること（番号付き）**:
   - レポート読み込み（`{report:plan.md}`、`{report:coder-scope.md}`、`{report:architect-review.md}`、`{report:supervisor-validation.md}`、`{report:ai-review.md}` 等）
   - スコープ外候補の抽出（対象例: 無関係なテストの flakiness、触ったファイルの古いコメント、依存ライブラリの軽微な脆弱性、設計上の重複、既存のリファクタ機会）
   - 各候補について「PR タイトルが変わるか?」で振るい
   - 残った候補を `gh issue list --search` で重複確認後、`gh issue create --title ... --body ...` で起票
4. **必須出力（`##` 見出し）**:
   - `## 検出したスコープ外項目`（候補一覧、テーブル）
   - `## 起票した issue`（番号 + URL + タイトルのリスト）
   - `## 起票しなかった項目`（理由付き。重複・スコープ内判定など）

ファイルパスのハードコードは禁止。`{report:filename}` を使う。

#### C. `config/.takt/facets/instructions/test-design.md` / `test-design-review.md`（汎用化）

specv 版を base に以下を変更する。

| 削除/置換対象 | 変更後 |
|--------------|-------|
| 「specv のテスト規約（…）は `specv-testing` policy で注入されます」段落 | 「テスト規約（Unit/E2E 判定基準・ケース区分・命名・ヘルパー）はワークフロー側で `policy: testing` 等が注入されている前提で、本ファイルは出力構造の指示のみを定義します。」 |
| `tests/test-utils.ts` の具体名 | 「プロジェクトのテストヘルパー（存在する場合）」のような汎用表現 |
| 「`specv-testing` policy に従う」「`specv-conventions` の TDD サイクル」等の policy 名直接参照 | 「ワークフローの `testing` policy に従う」「TDD サイクル（Red→Green→Refactor）を Red 段階で書ける粒度か」のような policy 名非依存の表現 |
| `withTmpDir` 等のヘルパー名サンプル | 例として残さず、文章のみで「既存ヘルパーで書ける前提なら、想定入力欄に明記」とする |
| ファイルパス例 `tests/`, `e2e/` | 「既存テスト群」のような汎用表現に置換 |
| AAA / GWT のいずれかを強制する記述 | どちらも明記せず「ワークフローの testing policy に従う」に統一 |

出力構造（Happy/Edge/Error 表 + 責務分担マトリクス + 不確定要素セクション）はそのまま維持する。

#### D. `nix/packages.nix` の `# takt` セクション差分

現状 L120-123:
```nix
# takt
mkdir -p "$HOME/.takt"
link_force "${dotfilesDir}/.takt/config.yaml" "$HOME/.takt/config.yaml"
```

更新後:
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

理由: `link_force` は親ディレクトリを作らないため、サブディレクトリ毎の事前 `mkdir -p` が必要（同 nix ファイル L113「Claude Code」セクションと同パターン）。

#### E. `config/.claude/skills/takt-issue/SKILL.md` 差分

更新箇所は 3 つ。

1. **L13 周辺の Overview**: 「takt の `default` workflow（plan → review → test_design → ... → reviewers の 9 step）」を「takt の `default-extended` workflow（多段レビュー + 自動スコープ外起票）」に変更。step 数の固有値はメンテ負債を避けるため定性的表記に留める。

2. **L62-69 の対話プロンプト 6 段階手順**:
   ```
   1. takt add '#<N>'
   2. カテゴリ: その他/ → Enter（default-extended は「その他」配下）
   3. ワークフロー: default-extended → Enter（specv 流多段レビュー + 自動 spillover 起票）
   4. Base branch: 現ブランチでよいか [Y/n] → ...
   5. Worktree path (Enter for auto)
   6. Branch name (Enter for auto)
   7. Auto-create PR? [Y/n]
   ```
   `workflowCategoryParser.js` を確認した結果、未登録 workflow は自動的に「その他」カテゴリ（builtin ja の `others_category_name`）に分類される。「クイックスタート」とは書かない。

3. **L211-232 の「7. スコープ外の発見は別 issue 化」セクション**: 冒頭に「default-extended では `report_spillover` step が自動で実行されるため、本セクションは `report_spillover` が拾えなかった分の人手対応として位置付ける」を追記。判断基準（「PR タイトルが変わるか?」）と具体例の表は維持。

### 到達経路・起動条件

| 項目 | 内容 |
|------|------|
| 利用者が到達する入口 | `takt add '#<N>'` 実行時の対話プロンプトで「カテゴリ: その他/ → ワークフロー: default-extended」と選択する経路。`takt-issue` SKILL.md でデフォルトとして案内される |
| 更新が必要な呼び出し元・配線 | `nix/packages.nix`（4 シンボリックリンク + 2 mkdir 追加）、`config/.claude/skills/takt-issue/SKILL.md`（Overview / プロンプト手順 / スコープ外セクション）、`darwin-rebuild switch --flake ~/01-dev/dotfiles` の手動実行 |
| 起動条件 | (a) `darwin-rebuild` 適用済みで `~/.takt/workflows/default-extended.yaml` 等が解決可能、(b) 対象リポジトリで `gh` 認証済みで `gh issue create` が叩ける（spillover step）、(c) 対象リポジトリで `takt add` が利用可能（`.takt/config.yaml` 等の最小構成） |
| 未対応項目 | specv 側 `.takt/workflows/default.yaml` の削除と CLAUDE.md 文言更新（クロスレポのため別 PR） |

## 実装ガイドライン

### 参照すべき既存実装パターン

| 目的 | 参照先 |
|------|-------|
| `default-extended.yaml` 全体構造 | `~/01-dev/projects/specv/.takt/workflows/default.yaml` を一度コピーして差分修正する形が最短。差分は本計画の「実装アプローチ A」を参照 |
| step スキーマ（`output_contracts.format` 必須） | `~/.bun/install/cache/takt@0.38.0@@@1/dist/core/models/schema-base.js:157-171`（`OutputContractItem` の `format` は必須） |
| `nix/packages.nix` の symlink 追加パターン | 同ファイル L113-118（Claude Code セクション）の `mkdir -p` + 連続 `link_force` パターン |
| 新規 instruction の文体・構造 | `~/.bun/install/cache/takt@0.38.0@@@1/builtins/ja/INSTRUCTION_STYLE_GUIDE.md` および `builtins/ja/facets/instructions/plan.md`（命令形・`{report:filename}` 利用・`##` 見出しの必須出力） |
| spillover の判断基準・具体例 | `config/.claude/skills/takt-issue/SKILL.md:213-232`（既存「スコープ外の発見は別 issue 化」セクションの判定表をそのまま流用） |
| 汎用化前の test-design / test-design-review | `~/01-dev/projects/specv/.takt/facets/instructions/test-design.md` / `test-design-review.md`（出力テーブル形式を維持し、specv 固有語のみ置換） |

### 変更の影響範囲（配線が必要な全箇所）

| 配線項目 | 配線先 | 注意 |
|---------|--------|------|
| 新規 instruction 4 ファイル | `nix/packages.nix` の `link_force` 追加（4 行）+ サブディレクトリ用 `mkdir -p`（2 行） | 親ディレクトリ `~/.takt/workflows/` `~/.takt/facets/instructions/` は既存ではない |
| takt-issue デフォルト変更 | `config/.claude/skills/takt-issue/SKILL.md` の Overview 段、対話プロンプト 6 段階、スコープ外セクション冒頭 | カテゴリ表記は実装上「その他」になる（`workflowCategoryParser` で確定）。「クイックスタート」と書かない |
| `default-extended.yaml` 内の step 名整合 | `loop_monitors` の cycle 内 step 名（`plan_review` / `plan_fix` / `test_design_review` / `test_design_fix` / `write_tests_review` / `write_tests_fix` / `ai_review` / `ai_fix` / `reviewers` / `fix`）が `steps` の各 `name:` と一致 | specv の名前をそのまま採用すれば自動で揃う |
| `reviewers` rule の遷移先 | `next: report_spillover` が新 step 名と一致 | typo 注意 |

### このタスクで特に注意すべきアンチパターン

1. **specv 固有 policy の名前を残す**: `policy: [..., specv-conventions]` を消し忘れると、dotfiles の facet 解決時に「facet 未定義」エラーで workflow 起動失敗。grep で `specv-` を検索し残骸ゼロを確認する。
2. **builtin instruction との衝突**: `report-scope-spillover` / `test-design` / `test-design-review` はいずれも builtin に存在しない（`builtins/ja/facets/instructions/` を確認済み）。dotfiles 側 `~/.takt/facets/instructions/` への配置で初めて参照可能になる。
3. **specv リポジトリへの誤った副次変更**: 本 worktree から `~/01-dev/projects/specv/...` を編集してはならない。Coder の implement step では `Edit` / `Write` 対象を dotfiles 内に限定。
4. **`output_contracts.report.format` 省略**: スキーマ上 `format` は必須（`schema-base.js:157`）。`report_spillover` step で `output_contracts` を書きたくなったら、書かずに省略するか、`summary` 等の builtin format を再利用する。
5. **`mkdir -p` 不足によるシンボリックリンク失敗**: `link_force` は親ディレクトリを作らない。`workflows/` ・ `facets/instructions/` の双方を事前 `mkdir -p` する。
6. **対話プロンプトのカテゴリ表記ズレ**: takt-issue SKILL.md の更新時に「カテゴリ: クイックスタート/」のままにすると default-extended が実際にはそこに居ないため、ユーザー操作で迷子になる。「その他」表記に揃える。
7. **takt-issue SKILL.md の step 数表記**: 「9 step」「16 step」のような固有値はメンテ負債になりやすい。「多段レビュー + 自動スコープ外起票」のような定性的表記に留める。
8. **AAA / GWT 強制の混在**: 汎用 test-design.md で AAA を強制すると builtin `testing` policy（GWT 採用）と矛盾する。汎用版は「ワークフローの testing policy に従う」とだけ書き、AAA も GWT も明記しない。
9. **`pass_previous_response: false` の付け忘れ**: `report_spillover` は reviewers の長大な並列出力を引きずる必要がない。`session: refresh` を使うほどの重さではないが、`pass_previous_response: false` でレポート参照に絞り込む。

### 利用者向け機能の到達経路に関する変更箇所

- `config/.claude/skills/takt-issue/SKILL.md`: 対話プロンプト手順（L62-69）と Overview（L13）と「スコープ外発見」セクション冒頭（L211 付近）の 3 箇所
- `nix/packages.nix` の `# takt` セクション L120-123: 4 つのシンボリックリンク + 2 つの `mkdir -p` 追加
- `darwin-rebuild switch --flake ~/01-dev/dotfiles`（実行はユーザー）: シンボリックリンクの実体反映

## スコープ外

| 項目 | 除外理由 |
|------|---------|
| `~/01-dev/projects/specv/.takt/workflows/default.yaml` の削除 | dotfiles リポジトリの worktree から別リポジトリ（specv）の追跡ファイルを削除すると、specv 側の git 状態に副作用が出るため本 PR では実施不可。本 PR がマージされた後、ユーザーが specv リポジトリ側で別 PR として削除する。issue に削除指示があるため manual follow-up として明示記録 |
| `~/01-dev/projects/specv/.claude/CLAUDE.md` 内の `.takt/workflows/default.yaml` への言及更新（L105-127） | 上と同じクロスレポ理由 |
| `config/.takt/workflow-categories.yaml` を新規作成して `default-extended` を `クイックスタート` 等に配置 | issue の「新規ファイル」表に含まれないため。デフォルトの「その他」配置で動作確認可能。配置を変えたい場合は別 issue で扱う |
| 既存の builtin `default` workflow の改変 | issue は「builtin `default` を汚さず」と明示。default-extended として完全別ファイルで提供する |
| 他の言語版（en）への対応 | dotfiles の `config/.takt/config.yaml` で `language: ja` を指定済み。en 環境向けの workflow / instruction は不要 |
| `report_spillover` step 用の output_contract facet 新設 | issue は「instruction 側に出力形式を含む」と指定。`facets/output-contracts/` を新設しない |
| 既存 builtin `default-high` 等への影響評価・派生 | issue 対象外。default-extended は完全独立の別 workflow |

## 確認事項

- **issue 検証セクションの「『レビュー/』配下に default-extended が出現することを確認」は「『その他/』配下」のタイポという理解でよいか?**
  - 根拠: file change 表に `workflow-categories.yaml` が含まれず、`workflowCategoryParser.js` を読んだ結果、未登録 workflow は自動的に `その他` カテゴリ（builtin ja の `others_category_name`）に分類される。「レビュー」カテゴリには `review-*` 系・`audit-*` 系のみ登録されており、`default-extended`（多段 TDD + 自動 spillover）の性質とは一致しない。
  - 本当に「レビュー」配下に出したい場合は、新規ファイル `config/.takt/workflow-categories.yaml`（オーバーレイ）の追加が必要となりスコープが 1 ファイル増える。