# Plan 024: 有効スキルの correctness 修正束（clean-branch / goal-setter / cmux 系 / issue-direct / settings.json）

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 1a587d7..HEAD -- config/.claude/skills/clean-branch/SKILL.md config/.claude/skills/goal-setter/SKILL.md config/.claude/skills/cmux-workspace/SKILL.md config/.claude/skills/cmux/references/panes-surfaces.md config/.claude/skills/issue-direct/SKILL.md config/.claude/skills/troubleshooting/SKILL.md config/.claude/settings.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/018-cloudflare-plugin-migration.md, plans/019-cmux-vendor-cleanup.md
  （settings.json を触るためコンフリクト回避の順序依存。内容依存は Fix E のみ —
  019 が cmux-workspace の References を先に整えている前提）
- **Category**: bug
- **Planned at**: commit `f9948f8`, 2026-08-26（**2026-08-26 reconcile で `e08bf89` に refresh**: 018/019/020/025 のマージと chrome-devtools プラグイン登録削除により行番号がずれたため、Fix D/E/F の座標を実測値に更新し、プラグイン削除の追随として **Fix G を追加**した。Fix A/B/C の座標は f9948f8 時点のまま有効）。
  **2026-08-26 execute 直前にレビュアーが `1a587d7` で全 7 Fix の座標と抜粋を再実測し、
  ドリフト無しを確認**（A `:41-48`/`:66`/`:95`/`:125`、B `:65`、C `:193-199`、D `:37`、
  E `:252-265`、F `autoMode.allow` 12 件 `:107-119`、G `:33-42` すべて一致）。
  同時にプラン側の欠陥 3 件を校正: Fix G の grep 主張（素の `chrome-devtools` は
  `permissions.allow:18` の `mcp__chrome-devtools` に 1 件ヒットする）、Step 5 の
  置換範囲 `:293-306`→`:252-265`、Step 5 の Verify ゲートが BSD grep の `$` アンカー扱いで
  変更前から `0` を返す無意味ゲートだった点（`grep -cF` へ）

## Why this matters

いずれも「読んだエージェントが指示どおり動くと失敗する」実バグで、共通して**失敗系の
経路で無音**になる:

- **A. clean-branch の `main` ハードコード**: default branch が `master` / `develop` の
  リポジトリでは、default branch 自身が NO_PR 候補一覧に載り（PR を持たないため）、
  さらに安全判定の `git log main..HEAD` が `unknown revision` で**何も出力せずに失敗**する —
  「未マージ作業なし = 消してよい」に見える最悪の縮退
- **B. goal-setter の相対パス**: 唯一の機械的ゲート（4,000 字検証）が
  `scripts/validate_goal_length.py` という cwd 依存パスで、このリポジトリでは実在する別の
  `scripts/` に解決されて常に失敗。スキル自身の逃げ道（「python3 が無ければ概算で進む」）が
  失敗を想定内に見せる
- **C. cmux socket の誤った fallback**: `/tmp/cmux.sock` は存在しない（実際の既定は
  `~/.local/state/cmux/cmux.sock` で、CLI は自動発見する）。接続失敗を調査するセクションで
  この fallback を export すると、以降の全 cmux コマンドが確実に失敗する恒久化装置になる
- **D. `--focus` 既定の矛盾**: `cmux/references/panes-surfaces.md:37` は
  「layout コマンドは既定で focus-neutral」、`cmux-workspace/SKILL.md:48` と
  `takt/SKILL.md:342` は「作成系には `--focus false` を渡せ」— どちらを先に読んだかで
  ユーザーの view を奪うかが変わる
- **E. issue-direct の CI 監視が変数の呼び出し間持ち越しに依存**: `CI_WATCH` の解決と起動が
  別のコードブロックで、Claude Code の Bash ツールはシェル状態を持ち越さない。別呼び出しに
  すると `"" "" 30 2400` で監視が始まらず、log は空 = 「未提出」と区別がつかない
- **F. settings.json の autoMode 根拠文の腐敗**: 存在しない `takt-issue` / `takt-review`
  スキルを引用し、現行スキルが明示的に禁止する `gh pr checks --watch`（issue-direct:250 —
  fine-grained PAT で使えないため watch-pr-actions.sh を同梱）と `takt -q run`
  （takt:365 — pane での `-q` を禁止）を許可根拠として記載。おまけに 2 エントリが重複

- **G. troubleshooting が実在しない settings.json キーを指示**: `chrome-devtools-mcp` の
  プラグイン登録とマーケットプレイスは `e08bf89` で削除済みだが、スキルは重複 MCP の対処として
  「`enabledPlugins` に `"chrome-devtools-mcp@chrome-devtools-plugins": false` を置け」と
  指示し続けている。読んだエージェントは実在しないキーを探し、「無効化されているはず」の
  前提が崩れたまま診断を続ける。しかもこれは **MCP が繋がらない最中に読まれるスキル**で、
  誤誘導が最も高くつく経路

## Current state

### A. clean-branch（`config/.claude/skills/clean-branch/SKILL.md`）

`:41-48`（Step 1 のコードブロック）:

```bash
git fetch --prune --tags
# 全 PR を 1 回で取得（API 節約）
gh pr list --state all --limit 800 --json number,state,headRefName,mergedAt > /tmp/all_prs.json
# 対象ブランチ（local + remote, main/HEAD 除外）
{ git branch --format='%(refname:short)'
  git branch -r --format='%(refname:short)' | sed 's#^origin/##'; } \
  | grep -vE '^(origin/?|main|HEAD)$' | grep -v ' -> ' | sort -u > /tmp/branches.txt
```

`:66` — `git log --oneline main..<branch>`
`:95` — `git -C "$w" log --oneline main..HEAD                    # main に無いコミット`
`:125`（Rules）— `- **main ブランチには絶対に触れない**`

default branch 解決の家内イディオムは `config/.claude/hooks/refresh-main.sh:20-22`:

```bash
DEFAULT_BRANCH=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null)
DEFAULT_BRANCH=${DEFAULT_BRANCH#origin/}
[ -n "$DEFAULT_BRANCH" ] || DEFAULT_BRANCH=main
```

### B. goal-setter（`config/.claude/skills/goal-setter/SKILL.md:65`）

```
... Validate length once with `python3 -B scripts/validate_goal_length.py <file>` (bundled; stdin also works). ...
```

実体は `config/.claude/skills/goal-setter/scripts/validate_goal_length.py`（symlink 経由で
`~/.claude/skills/goal-setter/scripts/` と `~/.agents/skills/goal-setter/scripts/` に見える）。
2 パス解決の家内パターンは `issue-direct/SKILL.md` の CI_WATCH 解決（`$HOME/.agents/...` を
先に試し、無ければ `$HOME/.claude/...`）。

### C. cmux socket（`config/.claude/skills/cmux-workspace/SKILL.md:193-199`）

```markdown
## Socket and Access

Use the socket path provided by cmux before falling back to defaults:

```bash
SOCK="${CMUX_SOCKET_PATH:-/tmp/cmux.sock}"
```
```

実測: `/tmp/cmux.sock` は存在せず、`~/.local/state/cmux/cmux.sock` が存在する。
`cmux --help` の Environment 節は「defaults to `~/.local/state/cmux/cmux.sock` and
auto-discovers tagged/debug sockets」と明記。

### D. --focus（`config/.claude/skills/cmux/references/panes-surfaces.md:37`）

```markdown
Surface identity is stable across move/reorder/split-off operations. Layout commands are focus-neutral by default; pass `--focus true` only when you want the moved or created surface selected.
```

対立側: `cmux-workspace/SKILL.md:48` "Pass `--focus false` whenever the verb supports it."

### E. issue-direct（`config/.claude/skills/issue-direct/SKILL.md:252-265`）

```markdown
実行前にクライアント別のスキル配置から監視スクリプトを解決する。

```bash
CI_WATCH="$HOME/.agents/skills/issue-direct/references/watch-pr-actions.sh"
[ -x "$CI_WATCH" ] || CI_WATCH="$HOME/.claude/skills/issue-direct/references/watch-pr-actions.sh"
```

- **Claude Code**: `Bash` の `run_in_background: true` で `"$CI_WATCH" "${PR_NUM}" 30 2400 > /tmp/ci_pr${PR_NUM}.log 2>&1` を投げる(timeout 目安 `2400000ms` = 40 分)。...
- **Codex / その他 CLI**: ...

  ```bash
  nohup "$CI_WATCH" "${PR_NUM}" 30 2400 > /tmp/ci_pr${PR_NUM}.log 2>&1 &
  echo $! > /tmp/ci_pr${PR_NUM}.pid
  ```
```

### F. settings.json（`config/.claude/settings.json` の `autoMode.allow`、106-120 行）

12 エントリ（`:108` の `$defaults` を含む）。問題箇所: **109 行**（`used by the takt-issue/takt-review/issue-direct skills` +
`gh pr checks <PR#> --watch` を根拠に記載）、**110 行**（`used by the same skills`）、
**112 行**（`Background \`takt -q run > log 2>&1\` ... per the takt-issue skill`）、
**116 行**（`per the takt-issue/takt-review skills`）、**117 行**（109 行のほぼ重複）、
**118 行**（111 行の重複）。

### G. troubleshooting（`config/.claude/skills/troubleshooting/SKILL.md:33-42`）

```markdown
Also confirm there is **no duplicate** `chrome-devtools` MCP — in particular, the official marketplace plugin `plugin:chrome-devtools-mcp:chrome-devtools` competes for the same debugging port. If `claude mcp list` shows both, disable the plugin in `~/.claude/settings.json` (= `~/ghq/github.com/daiki-beppu/dotfiles/config/.claude/settings.json` via symlink):

```jsonc
"enabledPlugins": {
  "chrome-devtools-mcp@chrome-devtools-plugins": false
}
```

The official plugin's `plugin.json` hard-codes `args: ["chrome-devtools-mcp@<ver>"]` with no way to inject `--autoConnect`, so it must stay disabled for this setup.
```

実測（`e08bf89` 以降）: `config/.claude/settings.json` に `chrome-devtools-mcp@chrome-devtools-plugins`
も `chrome-devtools-mcp@claude-plugins-official` も `chrome-devtools-plugins` マーケットプレイスも
**存在しない**。無効化ではなく**登録ごと削除**が現状。

```bash
grep -cE 'chrome-devtools-mcp@|chrome-devtools-plugins' config/.claude/settings.json   # → 0
```

**注意**: 素の `grep -c 'chrome-devtools' config/.claude/settings.json` は **`1` を返す**。
唯一のヒットは `permissions.allow` の `"mcp__chrome-devtools"`（`:18` — user scope で
`claude mcp add` した MCP の許可）で、プラグイン登録とは無関係。これを不一致と誤読して
STOP しないこと。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| settings 構文 | `jq . config/.claude/settings.json > /dev/null` | exit 0 |
| hooks 整合 | `bash scripts/check.sh hooks` | exit 0 |
| 全チェック | `bash scripts/check.sh` | exit 0 |
| validator 実在 | `test -f ~/.claude/skills/goal-setter/scripts/validate_goal_length.py && echo ok` | `ok` |
| socket 実在 | `ls ~/.local/state/cmux/cmux.sock` | 存在する |

## Scope

**In scope**:

- `config/.claude/skills/clean-branch/SKILL.md` — Fix A
- `config/.claude/skills/goal-setter/SKILL.md` — Fix B（`:65` の 1 文のみ）
- `config/.claude/skills/cmux-workspace/SKILL.md` — Fix C（Socket セクションのみ）
- `config/.claude/skills/cmux/references/panes-surfaces.md` — Fix D（1 文のみ）
- `config/.claude/skills/issue-direct/SKILL.md` — Fix E（`:252-265` のみ。Plan 025 で 441→362 行になった後の座標）
- `config/.claude/settings.json` — Fix F（`autoMode.allow` 配列のみ）
- `config/.claude/skills/troubleshooting/SKILL.md` — Fix G（重複 MCP の段落のみ）
- `plans/README.md` — 自分の status 行

**Out of scope**:

- takt/SKILL.md（同種の変数持ち越しバグ `:462-468` は Plan 021 が修正する。二重修正しない）
- 各ファイルの frontmatter description（Plan 023 の担当）
- `autoMode.soft_deny` / `autoMode.environment` — 変更しない
- watch-pr-actions.sh 本体

## Git workflow

- Branch: `fix/skill-correctness-bundle`（worktree: `$REPO_ROOT/.claude/worktrees/skill-correctness-bundle/`）
- Fix 単位でコミットを分ける（A〜F で最大 6 コミット、A+B+C+D は 1 コミットにまとめてもよい）。
  message 例: `fix(skills): clean-branch の default branch ハードコードを解消`

## Steps

### Step 1: Fix A — clean-branch の default branch 解決

`:41-48` のブロックを次で置き換える:

```bash
git fetch --prune --tags
# デフォルトブランチを解決（master / develop 等のリポジトリでも安全に動くように）
DEFAULT_BRANCH=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null)
DEFAULT_BRANCH=${DEFAULT_BRANCH#origin/}
[ -n "$DEFAULT_BRANCH" ] || DEFAULT_BRANCH=main
# 全 PR を 1 回で取得（API 節約）
gh pr list --state all --limit 800 --json number,state,headRefName,mergedAt > /tmp/all_prs.json
# 対象ブランチ（local + remote, デフォルトブランチ/HEAD 除外）
{ git branch --format='%(refname:short)'
  git branch -r --format='%(refname:short)' | sed 's#^origin/##'; } \
  | grep -vE "^(origin/?|${DEFAULT_BRANCH}|HEAD)$" | grep -v ' -> ' | sort -u > /tmp/branches.txt
```

`:66` を `git log --oneline "${DEFAULT_BRANCH}..<branch>"` に、
`:95` を `git -C "$w" log --oneline "${DEFAULT_BRANCH}..HEAD"`（コメントも
「デフォルトブランチに無いコミット」）に変更。ただし Step 2〜3 は Step 1 と**別の
シェル呼び出しになり得る**ので、`:60` 以降の最初の使用箇所の直前に
「`DEFAULT_BRANCH` は Step 1 と同じ解決を再実行してから使う（変数は呼び出し間で
持ち越されない）」の注意書きを 1 行足す。
`:125` の Rule を `- **デフォルトブランチ（main / master 等、origin/HEAD が指す先）には絶対に触れない**` に変更。

**Verify**: `grep -cE '(^|[^a-zA-Z])main\.\.' config/.claude/skills/clean-branch/SKILL.md` → `0`、
`grep -c 'DEFAULT_BRANCH' config/.claude/skills/clean-branch/SKILL.md` → 4 以上

### Step 2: Fix B — goal-setter の validator を絶対パスにする

`:65` の該当文を次で置き換える:

```
Validate length once with `python3 -B ~/.claude/skills/goal-setter/scripts/validate_goal_length.py <file>` (from Codex the same file is `~/.agents/skills/goal-setter/scripts/validate_goal_length.py`; stdin also works).
```

続く "If `python3` is unavailable, estimate once and move on." は残す。

**Verify**: `grep -c 'python3 -B scripts/' config/.claude/skills/goal-setter/SKILL.md` → `0`。
さらに実地確認: `printf 'test goal' | python3 -B ~/.claude/skills/goal-setter/scripts/validate_goal_length.py /dev/stdin` が
エラーなく実行できる（exit code は内容判定なので 0/1 どちらでもよい。
`No such file or directory` が出ないことが合格条件）。

### Step 3: Fix C — cmux socket の fallback を撤去する

`cmux-workspace/SKILL.md:193-199` の Socket セクション冒頭を次で置き換える
（`:201` 以降の capabilities / ping の記述は残す）:

```markdown
## Socket and Access

Use `CMUX_SOCKET_PATH` when cmux provides it. When it is unset, do NOT export a
guessed path — the `cmux` CLI auto-discovers its socket (default
`~/.local/state/cmux/cmux.sock`, plus tagged/debug sockets). A hardcoded wrong
path turns a transient connection failure into a permanent one.
```

**Verify**: `grep -c '/tmp/cmux.sock' config/.claude/skills/cmux-workspace/SKILL.md` → `0`

### Step 4: Fix D — panes-surfaces.md の focus 既定の記述を統一側に合わせる

`cmux/references/panes-surfaces.md:37` の
`Layout commands are focus-neutral by default; pass \`--focus true\` only when you want the moved or created surface selected.` を次で置き換える:

```markdown
Pass `--focus false` on move and creation verbs unless the user asked for the surface to be selected — follow the cmux-workspace skill's Non-Disruptive Automation rule. Surface identity is stable across move/reorder/split-off operations.
```

（"Surface identity is stable..." の一文は元の行の先頭にあった事実なので保持する。）

**Verify**: `grep -c 'focus-neutral by default' config/.claude/skills/cmux/references/panes-surfaces.md` → `0`

### Step 5: Fix E — issue-direct の CI 監視を 1 呼び出しに統合する

`:252-265` を次で置き換える:

```markdown
監視スクリプトの解決と起動は**1 回のシェル呼び出しに収める**(シェル変数は Bash ツールの呼び出し間で持ち越されない。`<PR番号>` は実際の番号をリテラルで埋める):

- **Claude Code**: 次を `run_in_background: true` の 1 回の `Bash` 呼び出しで投げる(timeout 目安 `2400000ms` = 40 分)。exit 時に自動再呼び出しされるので poll しない。exit code がそのまま合否(0=green、1=red、8=timeout / run 未検出)

  ```bash
  CI_WATCH="$HOME/.agents/skills/issue-direct/references/watch-pr-actions.sh"
  [ -x "$CI_WATCH" ] || CI_WATCH="$HOME/.claude/skills/issue-direct/references/watch-pr-actions.sh"
  "$CI_WATCH" "<PR番号>" 30 2400 > "/tmp/ci_pr<PR番号>.log" 2>&1
  ```

- **Codex / その他 CLI**: 自動再呼び出しが無いため、段ループ中は投げるだけにして、Step 3 でまとめて待つ:

  ```bash
  CI_WATCH="$HOME/.agents/skills/issue-direct/references/watch-pr-actions.sh"
  [ -x "$CI_WATCH" ] || CI_WATCH="$HOME/.claude/skills/issue-direct/references/watch-pr-actions.sh"
  nohup "$CI_WATCH" "<PR番号>" 30 2400 > "/tmp/ci_pr<PR番号>.log" 2>&1 &
  echo $! > "/tmp/ci_pr<PR番号>.pid"
  ```
```

置き換え範囲の直前の段落（`:250` の watch-pr-actions.sh の説明と PAT 要件）は残す。

**Verify**: `grep -cF 'ci_pr${PR_NUM}' config/.claude/skills/issue-direct/SKILL.md` → `0`
（実行前は `3`）、`grep -c '1 回のシェル呼び出しに収める' config/.claude/skills/issue-direct/SKILL.md` → `1`

> **`-F` は必須**。BSD grep の BRE では `$` がアンカーとして扱われるため
> `grep -c '${PR_NUM}' ...` は**変更前から `0` を返す**（実測）— 付け外しに関係なく通る
> 無意味なゲートになる。また `${PR_NUM}` 自体は `:235` / `:281` / `:311` / `:340` の
> スコープ外 4 箇所に残るのが正しい。消してはならない。

### Step 6: Fix F — autoMode.allow の根拠文を現行スキルに整合させる

`config/.claude/settings.json` の `autoMode.allow` を次のとおり編集する:

1. **109 行**のエントリを次で置き換える:
   `"Background GitHub Actions status polling for this repo's own PRs via the issue-direct skill's references/watch-pr-actions.sh (wraps `gh run list` / `gh run view`), plus `gh run view <run-id> --log-failed` and manual `gh pr checks <PR#>` — read-only checks with no side effects"`
2. **110 行**の `used by the same skills` を `used by the takt / issue-direct skills` に変更
3. **112 行**（`Background \`takt -q run > log 2>&1\` ... per the takt-issue skill`）を**削除**
   （116 行のエントリが takt 実行を包括する）
4. **116 行**を次で置き換える:
   `"Running `takt` workflows for this repo, including the takt skill's cmux-less fallback of backgrounded / nohup-wrapped `takt run > log 2>&1`"`
5. **117 行**（109 行の重複）と **118 行**（111 行の重複）を**削除**
6. JSON 内でバッククォートはそのまま文字として書けるが、`"` はエスケープが要る —
   上記の文字列を JSON 値として成立する形で書くこと

**Verify**: `jq -r '.autoMode.allow[]' config/.claude/settings.json | grep -c 'takt-issue\|takt-review'` → `0`、
`jq '.autoMode.allow | length' config/.claude/settings.json` → `9`（12 − 削除 3）、
`jq -r '.autoMode.allow[]' config/.claude/settings.json | sort | uniq -d` → 出力なし（重複ゼロ）

### Step 7: Fix G — troubleshooting の重複 MCP 対処を現状に合わせる

`config/.claude/skills/troubleshooting/SKILL.md:33-42` の段落を、「無効化せよ」から
「登録は削除済み。再出現したらマーケットプレイスが再追加された合図」へ書き替える。
`enabledPlugins` の jsonc スニペットは**削除**する（実在しないキーを提示しないため）。

置き換え後の主旨（文面は英語のまま、周囲のトーンに合わせる）:

- 重複 `chrome-devtools` MCP が無いことを `claude mcp list` で確認する、は**残す**
  （実行可能な確認手順）
- 公式マーケットプレイスのプラグイン版は同じデバッグポートを奪い合う、も**残す**（実測知）
- 公式プラグインの `plugin.json` が `args` を固定していて `--autoConnect` を注入できない、
  も**残す**（このリポジトリが user scope の `claude mcp add` を使う理由そのもの）
- 変えるのは対処だけ: 「`enabledPlugins` で false にする」→
  「`config/.claude/settings.json` からは登録もマーケットプレイスも削除済み。
  `claude mcp list` にプラグイン版が現れたらマーケットプレイスが再追加された合図なので、
  `enabledPlugins` / `extraKnownMarketplaces` から再度取り除く」

**Verify**: `grep -c 'chrome-devtools-mcp@chrome-devtools-plugins' config/.claude/skills/troubleshooting/SKILL.md` → `0`、
`grep -c 'autoConnect' config/.claude/skills/troubleshooting/SKILL.md` → `19`（実行前と同値。実測知を消していない確認）、
`grep -c 'claude mcp list' config/.claude/skills/troubleshooting/SKILL.md` → `1` 以上

### Step 8: 全チェック

```bash
bash scripts/check.sh
```

**Verify**: `all checks passed`、exit 0

## Test plan

- Fix B は Step 2 の実地実行（validator が実パスで動く）が回帰テストを兼ねる
- Fix F は `jq` の 3 ゲート（stale 参照ゼロ / 件数 / 重複ゼロ）
- 残りは文書変更で、grep ゲートのみ。clean-branch の実地確認をするなら
  `master` を default とするリポジトリを一時作成して Step 1 のブロックを流し、
  `/tmp/branches.txt` に `master` が入らないことを見る（任意）

## Done criteria

- [ ] Step 1〜7 の Verify がすべて期待値どおり
- [ ] `grep -rn 'chrome-devtools-mcp@chrome-devtools-plugins' config/` → ヒット 0（Fix G の残骸なし）
- [ ] `jq . config/.claude/settings.json` exit 0
- [ ] `bash scripts/check.sh` exit 0
- [ ] In scope 外の変更なし（`git status`）
- [ ] `plans/README.md` の status 行を更新済み

## STOP conditions

Stop and report back (do not improvise) if:

- 「Current state」の抜粋と実ファイルが一致しない（特に settings.json の行番号は
  Plan 018/019 の実施でずれている可能性がある — その場合は**内容**でエントリを特定し、
  特定できなければ STOP）
- `~/.local/state/cmux/cmux.sock` が存在しない（Fix C の前提が崩れている —
  `cmux --help` の Environment 節を確認して報告）
- Fix F で削除対象エントリが見つからない、または同文のエントリが 3 つ以上ある

## Maintenance notes

- Fix F は許可の**根拠文**の整合が目的で、許可範囲は「takt -q run エントリの削除」以外
  実質変えていない。レビュアーは jq diff で `allow` の意味変化を確認すること
- `gh pr checks` の許可自体は残した（手動利用は正当）。issue-direct スキルが使わない
  理由（fine-grained PAT 非対応）は skill 側に記載済みで、settings 側は根拠文から
  スキル名の紐付けを外しただけ
- 今後スキルを改名・削除したら、`autoMode.allow` の根拠文を grep して追随させる:
  `jq -r '.autoMode.allow[]' config/.claude/settings.json | grep -o '[a-z-]* skill'`
- clean-branch の `DEFAULT_BRANCH` は「シェル変数は呼び出し間で持ち越されない」問題を
  スキル本文の注意書きで回避している。スクリプト化（references/ に .sh を置く）は
  今回見送った follow-up
