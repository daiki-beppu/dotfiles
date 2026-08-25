# Plan 019: 無効化済み cmux-* 5 スキルを削除し、有効スキル側の参照を掃除する

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f9948f8..HEAD -- config/.claude/skills/cmux config/.claude/skills/cmux-workspace config/.claude/skills/cmux-browser config/.claude/skills/cmux-customization config/.claude/skills/cmux-diagnostics config/.claude/skills/cmux-markdown config/.claude/skills/cmux-settings config/.claude/settings.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/018-cloudflare-plugin-migration.md（settings.json の同一ブロックを
  編集するためコンフリクト回避の順序依存。内容依存は無い）
- **Category**: tech-debt
- **Planned at**: commit `f9948f8`, 2026-08-26

## Why this matters

cmux-browser / cmux-customization / cmux-diagnostics / cmux-markdown / cmux-settings の
5 スキルは 2026-07-18 の 1 コミット（`7e540f0`）で cmux プロジェクトから輸入されたまま
一度も更新されておらず、`skillOverrides` で off。一方 cmux アプリは自動更新され続けており、
vendored な生成物（`cmux-settings/references/all-keys.md` = スキーマから生成されたキー一覧）は
黙って古くなる。インストール済みの cmux CLI（0.64.22、`/Applications/cmux.app/Contents/Resources/bin/cmux`）は
`cmux docs <topic>` / `cmux settings` / `cmux config doctor` / `cmux markdown` を自前で持ち、
これらのスキルが包んでいた情報は CLI から常に最新で引ける。

問題は削除だけでは済まないこと: **有効な** cmux / cmux-workspace スキルが off の
3 スキルへ skill handoff の体で参照しており（下記）、削除するとリンク切れ、放置すると
「無効化したスキルへ誘導する」状態が続く。削除と参照掃除を同一コミットで行う。

## Current state

- `config/.claude/skills/cmux/SKILL.md:73-85` — "Deep-Dive References" テーブル。
  行 81 は cmux-workspace（**有効・残す**）、行 82-84 が削除対象への参照:

```markdown
| [../cmux-workspace/SKILL.md](../cmux-workspace/SKILL.md) | Current caller workspace rules and non-disruptive automation |
| [../cmux-settings/SKILL.md](../cmux-settings/SKILL.md) | Safe cmux.json settings edits and validation |
| [../cmux-browser/SKILL.md](../cmux-browser/SKILL.md) | Browser automation on surface-backed webviews |
| [../cmux-markdown/SKILL.md](../cmux-markdown/SKILL.md) | Markdown viewer panel with live file watching |
```

- `config/.claude/skills/cmux-workspace/SKILL.md:208-211` — References セクション:

```markdown
- [references/commands.md](references/commands.md) enumerates workspace, pane, surface, notification, and utility commands.
- [../cmux-browser/SKILL.md](../cmux-browser/SKILL.md) covers browser surfaces with the same current-workspace rule.
```

- `config/.claude/skills/cmux/SKILL.md:40-57` — "Settings and Docs" セクションが既に
  `cmux docs settings` / `cmux settings path` / `cmux reload-config` を直接案内している
  （= cmux-settings スキルの内容はここで実質カバー済み）
- `config/.claude/settings.json` の `skillOverrides` に `"cmux-browser"` /
  `"cmux-customization"` / `"cmux-diagnostics"` / `"cmux-markdown"` / `"cmux-settings"` の
  5 エントリ（すべて `"off"`）
- cmux-customization / cmux-diagnostics への参照は削除対象ディレクトリの内部にしか無い
  （cmux-diagnostics/scripts が cmux-settings/scripts を 3 つの fallback root で探すが、
  両方まとめて消えるので問題にならない）
- 削除後の Codex 側 symlink は `bash scripts/sync-agent-skills.sh` の掃除ループが自動回収する

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 対象チェック | `bash scripts/check.sh shellcheck links agent-skills` | exit 0 |
| 全チェック | `bash scripts/check.sh` | exit 0, "all checks passed" |
| settings 構文 | `jq . config/.claude/settings.json > /dev/null` | exit 0 |
| Codex 側同期 | `bash scripts/sync-agent-skills.sh` | `removed stale:` 5 件、exit 0 |

## Scope

**In scope**:

- `config/.claude/skills/{cmux-browser,cmux-customization,cmux-diagnostics,cmux-markdown,cmux-settings}/` — 削除
- `config/.claude/skills/cmux/SKILL.md` — 参照テーブルの 3 行のみ
- `config/.claude/skills/cmux-workspace/SKILL.md` — References の 1 行のみ
- `config/.claude/settings.json` — `skillOverrides` 5 キー削除
- `plans/README.md` — 自分の status 行

**Out of scope**:

- `cmux` / `cmux-workspace` の上記以外の本文（socket パスや `--focus` の修正は Plan 024 の担当。
  ここで直したくなっても触らない）
- `config/.claude/skills/cmux/references/` 配下（有効スキルの参照素材。残す）
- takt スキル（`takt/SKILL.md:330,390` の cmux-workspace 参照は有効スキル同士なので正しい）

## Git workflow

- Branch: `chore/remove-cmux-vendor-skills`（worktree: `$REPO_ROOT/.claude/worktrees/remove-cmux-vendor-skills/`）
- コミット 1 個。message 例: `chore(claude): 無効化済み cmux 系 5 スキルを削除し参照を掃除`

## Steps

### Step 1: 削除対象への参照が想定の 2 ファイルだけであることを確認する

```bash
grep -rln 'cmux-browser\|cmux-customization\|cmux-diagnostics\|cmux-markdown\|cmux-settings' \
  config/ scripts/ CLAUDE.md README.md \
  | grep -v '^config/.claude/skills/cmux-\(browser\|customization\|diagnostics\|markdown\|settings\)/'
```

**Verify**: 出力が `config/.claude/skills/cmux/SKILL.md`、
`config/.claude/skills/cmux-workspace/SKILL.md`、`config/.claude/settings.json` の
3 ファイルのみ。他のファイルが出たら STOP。

### Step 2: 5 ディレクトリを削除する

```bash
git rm -r -q \
  config/.claude/skills/cmux-browser \
  config/.claude/skills/cmux-customization \
  config/.claude/skills/cmux-diagnostics \
  config/.claude/skills/cmux-markdown \
  config/.claude/skills/cmux-settings
```

**Verify**: `ls -d config/.claude/skills/cmux*` の出力が
`config/.claude/skills/cmux` と `config/.claude/skills/cmux-workspace` の 2 つだけ。

### Step 3: cmux/SKILL.md の参照テーブルを掃除する

`config/.claude/skills/cmux/SKILL.md` の Deep-Dive References テーブルから
`../cmux-settings/SKILL.md`・`../cmux-browser/SKILL.md`・`../cmux-markdown/SKILL.md` の
3 行を削除する（`../cmux-workspace/SKILL.md` の行と `references/*.md` の 4 行は残す）。
テーブル直後に次の 1 行を追加する:

```markdown
For settings, browser automation, markdown viewer, and diagnostics details, run `cmux docs <topic>` — the CLI serves the current documentation for the installed version.
```

**Verify**: `grep -c 'cmux-\(browser\|settings\|markdown\)' config/.claude/skills/cmux/SKILL.md` → `0`

### Step 4: cmux-workspace/SKILL.md の参照を掃除する

`config/.claude/skills/cmux-workspace/SKILL.md:211` の
`[../cmux-browser/SKILL.md](../cmux-browser/SKILL.md) covers browser surfaces ...` の行を
次で置き換える:

```markdown
- Browser surfaces follow the same current-workspace rule; run `cmux docs browser` for the current browser-automation reference.
```

**Verify**: `grep -c 'cmux-browser' config/.claude/skills/cmux-workspace/SKILL.md` → `0`

### Step 5: skillOverrides から 5 キーを削除する

`config/.claude/settings.json` の `skillOverrides` から `cmux-browser` /
`cmux-customization` / `cmux-diagnostics` / `cmux-markdown` / `cmux-settings` を削除する。
残るキーは `aqua-improve` / `empirical-prompt-tuning` / `evidence-record` / `release-tweet`
の 4 つのはず（Plan 018 実施済み前提）。

**Verify**: `jq -r '.skillOverrides | keys | join(",")' config/.claude/settings.json` →
`aqua-improve,empirical-prompt-tuning,evidence-record,release-tweet`

### Step 6: 同期とチェック

```bash
bash scripts/sync-agent-skills.sh
bash scripts/check.sh
```

**Verify**: sync が `removed stale:` を 5 件出して exit 0。check.sh が
`all checks passed`。`ls ~/.agents/skills/ | grep -c 'cmux-'` → `0`
（`cmux` と `cmux-workspace` は `cmux-` にマッチしないので残っていてよい）。

## Test plan

単体テストは無し。Step 1 の参照グリープが「削除により壊れる参照は掃除対象の 2 箇所だけ」を
事前保証し、Step 3-4 の Verify grep が事後保証する。`check.sh agent-skills` が sync の
掃除ロジックを一時ディレクトリで実走する。

## Done criteria

- [ ] `bash scripts/check.sh` exit 0
- [ ] `git ls-files | grep -c 'skills/cmux-'` → `0`
- [ ] `grep -rn 'cmux-\(browser\|customization\|diagnostics\|markdown\|settings\)' config/ scripts/` → ヒット 0 件
- [ ] `jq . config/.claude/settings.json` exit 0、skillOverrides 残 4 キー
- [ ] In scope 外の変更なし（`git status`）
- [ ] `plans/README.md` の status 行を更新済み

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1 で想定外のファイルに参照が見つかった
- `skillOverrides` の残キーが想定（Plan 018 後の 9 キー: cmux 系 5 + 自作 4）と
  一致しない — 実行順のドリフト。README の status を確認して報告
- `cmux docs` サブコマンドが現在の cmux CLI に存在しない
  （`/Applications/cmux.app/Contents/Resources/bin/cmux docs --help` がエラー）—
  Step 3-4 の置き換え文言が成立しないため、文言を変えずに報告する

## Maintenance notes

- 今後 cmux の機能詳細が必要になったら、スキルを再 vendor せず `cmux docs <topic>` を
  参照する（Step 3 で本文にその規約を残した）
- レビュアーは cmux / cmux-workspace の diff が「参照行の削除・置換のみ」であることを
  確認する。本文ロジックに差分があれば scope 違反
- cmux socket fallback（`cmux-workspace/SKILL.md:198`）と `--focus` 既定の矛盾は
  Plan 024 が別途修正する。本プランの diff に混ぜない
