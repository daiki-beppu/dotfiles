# Plan 026: cmux / cmux-workspace / chrome-devtools から「環境の再掲」を刈る

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f9948f8..HEAD -- config/.claude/skills/cmux config/.claude/skills/cmux-workspace config/.claude/skills/chrome-devtools`
> Plan 019（参照掃除）と 024（socket / --focus 修正）の**後**に実行する。それらの差分は
> 想定内 — 「Current state」の見出しが現物にあれば続行してよい。

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW（刈るのは自己文書化された CLI / MCP の再掲のみ。house rule と実測知は残す）
- **Depends on**: plans/019-cmux-vendor-cleanup.md, plans/024-skill-correctness-fixes.md
- **Category**: dx
- **Planned at**: commit `f9948f8`, 2026-08-26（eli5 / writing-for-agents 基準の新規プラン）

## Why this matters

writing-for-agents の規準:「**環境も真実の供給源** — `--help` 出力・設定ファイル・
ディレクトリ構造。それを再掲する文書はキャッシュであり、参照が高価なときだけ場所を稼ぐ。
1 コマンドで引ける事実は環境に任せる(そこなら腐らない)」。

cmux CLI は自己文書化されている（`cmux --help` / `cmux docs <topic>`、Plan 019 で本文にも
その規約を明記済み）。にもかかわらず cmux-workspace（225 行）の半分近くはコマンド引数の
enumeration で、しかも同スキルの `references/commands.md` が既に enumeration の置き場として
存在する — **自分の参照ファイルとの重複**。chrome-devtools も MCP ツール自身の description が
語ることを数節で再掲している。放置するとこれらのキャッシュは cmux の自動更新のたび黙って腐る
（cmux-settings の生成物が腐った実例は Plan 019 の背景のとおり）。

残すものの規準: **CLI も設定ファイルも白状しない知識**だけ — 「focus を奪うな」という
house rule、`drag-surface-to-split` の papercut（issue #1901）、cmux.json と Ghostty config の
分担、tagged reload の規約、autoConnect の前提条件と互換マトリクス。

## Current state

3 ファイルとも f9948f8 時点 + Plan 019/024 適用後の姿を前提とする。

### cmux（`config/.claude/skills/cmux/SKILL.md`、84 行）

| セクション | 判定 |
|---|---|
| 冒頭 + `## Core Concepts`（`:6-15`） | 残す（定義） |
| `## Fast Start`（`:17-38`、コマンド列挙 ~20 行） | **削除** — `cmux --help` のキャッシュ。`cmux identify --json` で自コンテキストを掴む 1 行だけ残す |
| `## Settings and Docs`（`:40-65`） | 残す — cmux.json と Ghostty config の**分担**、`.bak` 規約、`reload-config` が両方を再読することは環境が白状しない知識。ただし `:59-65` の「Open the UI」コマンド 3 行は削除（help のキャッシュ） |
| `## Handle Model`（`:67-71`） | 残す（規約） |
| `## Deep-Dive References`（`:73-85`、019 適用後の姿） | 残す |

### cmux-workspace（`config/.claude/skills/cmux-workspace/SKILL.md`、225 行）

| セクション | 判定 |
|---|---|
| `## Default Rule` + caller-env 確認（`:10-24`） | 残す（house rule + 実行可能な確認手順） |
| `## Non-Disruptive Automation`（`:26-48`） | 残す（このスキルの核。issue リンク含む） |
| `## Right-Side Helper Pane`（`:50-75`） | 残す（takt が名指しで参照するポリシー） |
| `## Hierarchy`（`:77-83`） | 残す（6 行の定義。cmux と重複するが自己完結性を優先） |
| `## Inspect Current Context`（`:85-100`、コマンド 6 種列挙） | **圧縮** — `cmux identify --json` と `--id-format both` の 2 点だけ残し、列挙は `references/commands.md` に委ねる 1 行に |
| `## Workspace-Scoped Actions`（`:102-123`） | **圧縮** — 価値は注記（additive = safe / focus 系 = USER-AFFECTING）にあり、コマンド自体は help のキャッシュ。冒頭の「Prefer explicit workspace flags」の理由 + safe/user-affecting の分類ルール + 例 2 行に |
| `## Caller Terminal`（`:125-138`） | **圧縮** — `cmux send --surface "${CMUX_SURFACE_ID:-}"` の例 1 つと「他 workspace に送らない」ルールに |
| `## Moving Surfaces`（`:140-164`） | **圧縮** — 残すのは `--focus false` の一文、**papercut（`drag-surface-to-split` の issue #1901 と additive 回避策）**、「focus で復旧しない・報告して止まる」。基本コマンド列挙は削除 |
| `## Sidebar State`（`:166-177`） | **削除** — 純粋な列挙。`references/commands.md` へ委ねる 1 行に |
| `## Socket and Access`（024 適用後） | 残す |
| `## Contributor Reloads`（`:179-191`） | 残す（tagged reload は環境が白状しない house rule） |
| `## References` / `## Rules`（019/024 適用後） | 残す |

### chrome-devtools（`config/.claude/skills/chrome-devtools/SKILL.md`、88 行）

| セクション | 判定 |
|---|---|
| 冒頭 note + `## Core Concepts`（`:7-22`） | 残す（autoConnect 前提・troubleshooting handoff・uid 再取得は実測知） |
| `### Before interacting with a page`（`:26-31`） | **削除** — navigate→wait→snapshot→interact はツール記述から従う既定挙動（no-op） |
| `### Efficient data retrieval`（`:33-37`） | 残す（filePath / pagination / includeSnapshot:false は知らないと使わないフラグ） |
| `### Tool selection`（`:39-43`） | 残す（snapshot vs screenshot の使い分け規約） |
| `### Parallel execution`（`:45-47`） | **削除** — no-op（既定挙動の追認） |
| `### autoConnect-specific safety`（`:49-52`） | 残す（safety） |
| `### Testing an extension`（`:54-75`） | 残す（バージョン互換マトリクスは実測知） |
| `## Troubleshooting`（`:77-84`） + 帰属表示（`:86-88`） | 残す（**帰属表示は Apache-2.0 の条件 — 必ず残す**） |

### troubleshooting（変更しない）

診断ウィザード全体が実測知（plugin 二重登録の競合、`DevToolsActivePort` 診断、
ポート 9222 確認）。**このプランの対象外**と判定済み — 触らない。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 行数 | `wc -l` 各ファイル | cmux ≤ 60、cmux-workspace ≤ 130、chrome-devtools ≤ 70 |
| 全チェック | `bash scripts/check.sh` | exit 0 |

## Scope

**In scope**:

- `config/.claude/skills/cmux/SKILL.md`
- `config/.claude/skills/cmux-workspace/SKILL.md`
- `config/.claude/skills/chrome-devtools/SKILL.md`
- `plans/README.md` — 自分の status 行

**Out of scope**:

- frontmatter description（023 の担当）
- `troubleshooting/SKILL.md`（上記判定のとおり触らない）
- `cmux/references/*.md`・`cmux-workspace/references/commands.md`（enumeration の正として残す。
  内容の更新はしない）
- nix / free-disk-space / clean-branch の本文（nix の「よくある操作の早見表」も本文と重複する
  キャッシュだが 10 行で無害 — deferred。Maintenance notes 参照）

## Git workflow

- Branch: `docs/cmux-chrome-cache-pruning`（worktree: `$REPO_ROOT/.claude/worktrees/cmux-chrome-cache-pruning/`）
- コミットはファイルごとに 1 つ。message 例: `docs(skills): cmux-workspace から CLI ヘルプの再掲を刈る`

## Steps

### Step 1: cmux を刈る

「Current state」の cmux 表のとおり。Fast Start 跡地は:

```markdown
## Fast Start

```bash
cmux identify --json   # 自分の window / workspace / pane / surface を掴む
```

コマンドの一覧と引数は `cmux --help` と [references/commands.md 相当の各 reference](#deep-dive-references) が正。
```

**Verify**: `wc -l config/.claude/skills/cmux/SKILL.md` ≤ 60、
`grep -c 'new-split\|reorder-surface' config/.claude/skills/cmux/SKILL.md` → `0`

### Step 2: cmux-workspace を刈る

「Current state」の cmux-workspace 表のとおり。圧縮セクションの目安文面（例: Moving Surfaces）:

```markdown
## Moving Surfaces

Pass `--focus false` on `move-surface`; build layouts additively rather than
create-then-split. Known papercut: `drag-surface-to-split` resolves the workspace via
UI focus and can fail with `ERROR: Surface not found` when the caller workspace is not
visually focused (https://github.com/manaflow-ai/cmux/issues/1901, related #3189) —
prefer `new-pane` / `new-surface`. Do not call `focus-pane` to recover from a failed
move; report and stop. Command arguments: see [references/commands.md](references/commands.md).
```

**Verify**: `wc -l config/.claude/skills/cmux-workspace/SKILL.md` ≤ 130、
`grep -c 'issues/1901' config/.claude/skills/cmux-workspace/SKILL.md` → `1`（papercut が生きている）、
`grep -c 'set-progress\|clear-status' config/.claude/skills/cmux-workspace/SKILL.md` → `0`（列挙が消えた）、
`grep -c 'reload.sh --tag' config/.claude/skills/cmux-workspace/SKILL.md` → `1`（Contributor Reloads が残っている）

### Step 3: chrome-devtools を刈る

「Current state」の chrome-devtools 表のとおり 2 節を削除する。

**Verify**: `wc -l config/.claude/skills/chrome-devtools/SKILL.md` ≤ 70、
`grep -c 'Parallel execution' config/.claude/skills/chrome-devtools/SKILL.md` → `0`、
`grep -c 'Apache-2.0' config/.claude/skills/chrome-devtools/SKILL.md` → `1`（帰属表示が残っている）、
`grep -c 'categoryExtensions' config/.claude/skills/chrome-devtools/SKILL.md` → 2 以上（互換マトリクスが残っている）

### Step 4: 全チェック

```bash
bash scripts/check.sh
```

**Verify**: `all checks passed`、exit 0

## Test plan

文書のみ。各 Step の「消えた/残った」grep が回帰確認を兼ねる。実運用の確認は次に cmux で
pane 操作をする自動化（takt の `--run` 等）が従来どおり動くかの観察。

## Done criteria

- [ ] `wc -l`: cmux ≤ 60、cmux-workspace ≤ 130、chrome-devtools ≤ 70
- [ ] Step 1〜3 の grep がすべて期待値どおり
- [ ] `bash scripts/check.sh` exit 0
- [ ] troubleshooting / references 配下 / frontmatter に diff が無い（`git status` / `git diff`）
- [ ] `plans/README.md` の status 行を更新済み

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 019 / 024 が未実施（README の status で確認）
- 「Current state」の見出しが現物に見つからない、またはセクション構造が大きく違う
- 削る対象に、表に無い実測知（issue リンク・バージョン条件・safety 文）が混ざっている —
  その行だけ残して差分を報告
- 行数目標に 2 回の調整で収まらない

## Maintenance notes

- **この 3 ファイルに今後コマンド例を足すときの規準**: `--help` で引ける引数説明は書かない。
  書いてよいのは house rule（focus を奪わない等）・papercut・分担の知識だけ
- nix の「よくある操作の早見表」（`nix/SKILL.md:170-182`）も本文と重複するキャッシュだが、
  対象が自リポジトリのファイル構成で腐りにくく 10 行なので今回は見送り。nix スキルを
  次に編集するとき、本文と食い違ったら早見表側を消す
- cmux が大きくバージョンアップして `references/commands.md` が腐ったら、それも再 vendor
  せず削除して `cmux docs` へのポインタに置き換えるのが次の一手
