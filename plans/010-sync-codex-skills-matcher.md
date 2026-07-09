# Plan 010: sync-codex-skills が symlink 経由の編集でも発火するようにする

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat e0a2d44..HEAD -- config/.claude/hooks/sync-codex-skills.sh`
> If the file changed since this plan was written, compare the "Current state"
> excerpt against the live code before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `e0a2d44`, 2026-07-09

## Why this matters

`sync-codex-skills.sh`（PostToolUse hook）は、dotfiles のスキルを `~/.codex/skills/` に symlink 同期して Codex CLI から使えるようにする。発火条件が `*/config/.claude/skills/*` という repo パス限定なので、`~/.claude/skills/...` という**デプロイ先 symlink 経由のパス**で Write/Edit が来た場合は同じ実ファイルを編集しているのに同期がスキップされる。失敗は不可視（hook は常に exit 0）で、`~/.codex/skills` が黙ってドリフトする — まさにこの hook が防ぐはずの事象。修正は matcher を 1 パターン広げるだけで、sync 本体は編集パスと無関係に全体同期するため副作用はない（冪等な同期が増えるだけ）。

## Current state

- `config/.claude/hooks/sync-codex-skills.sh` — 51 行。発火判定は 14〜17 行目:

```bash
case "$FILE_PATH" in
  */config/.claude/skills/*) ;;
  *) exit 0 ;;
esac
```

- 19〜20 行目で同期元/先を固定: `DOTFILES_SKILLS="$HOME/01-dev/dotfiles/config/.claude/skills"`, `CODEX_SKILLS="$HOME/.codex/skills"`。
- 22〜23 行目: 両ディレクトリが無ければ exit 0（fail-open）。
- デプロイ構成: `~/.claude/skills` → `~/01-dev/dotfiles/config/.claude/skills` の symlink（`nix/packages.nix:138`）。ユーザー規約（CLAUDE.md）は「スキル編集は dotfiles repo 側で行う」だが、`~/.claude/skills/...` パスでの編集も同じ実体に届いてしまうため、hook はどちらも拾うべき。
- `settings.json` 上は PostToolUse / matcher `Write|Edit` で登録済み（Plan 006 で検証済み — 登録自体は触らない）。

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| shellcheck | `nix run nixpkgs#shellcheck -- --severity=error config/.claude/hooks/sync-codex-skills.sh` | exit 0 |
| hook 単体実行 | 下記 Step 2 の Verify | 期待どおりの symlink 作成 |

## Scope

**In scope**:
- `config/.claude/hooks/sync-codex-skills.sh`（case パターンのみ）

**Out of scope**:
- 同期本体のロジック（追加/削除ループ）— 動作確認済み
- 「worktree で新スキルを作成 → main へマージ後に編集イベントが無いと同期されない」というタイミング問題 — matcher 拡大では解決しない構造的事項。Maintenance notes 参照
- `settings.json` の hook 登録

## Git workflow

- Branch: `fix/sync-codex-skills-matcher`（worktree 上で作業 — repo 規約）
- Commit message 例: `fix(hooks): sync-codex-skills を ~/.claude/skills 経由の編集でも発火させる`
- Push / PR 作成はユーザー指示があるまでしない

## Steps

### Step 1: case パターンを広げる

14〜17 行目の case を次に変える:

```bash
case "$FILE_PATH" in
  */.claude/skills/*) ;;
  *) exit 0 ;;
esac
```

`*/config/.claude/skills/*`（repo・worktree パス）も `*/.claude/skills/*` にマッチするので、パターンは 1 本に集約できる。`~/.codex/skills/` は `.claude` を含まないため誤発火しない。

**Verify**: `rg -n '\.claude/skills' config/.claude/hooks/sync-codex-skills.sh` → case 行が `*/.claude/skills/*` になっている

### Step 2: 偽 HOME で両経路の発火を検証する

```bash
tmp=$(mktemp -d)
mkdir -p "$tmp/01-dev/dotfiles/config/.claude/skills/testskill" "$tmp/.codex/skills"

# 経路 A: symlink 経由パス（従来はスキップされていた）
echo "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$tmp/.claude/skills/testskill/SKILL.md\"}}" \
  | HOME="$tmp" bash config/.claude/hooks/sync-codex-skills.sh
readlink "$tmp/.codex/skills/testskill"   # → $tmp/01-dev/dotfiles/config/.claude/skills/testskill

# 経路 B: repo パス（従来どおり）
rm "$tmp/.codex/skills/testskill"
echo "{\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"$tmp/01-dev/dotfiles/config/.claude/skills/testskill/SKILL.md\"}}" \
  | HOME="$tmp" bash config/.claude/hooks/sync-codex-skills.sh
readlink "$tmp/.codex/skills/testskill"   # → 同上

# 経路 C: 無関係パスは発火しない
echo "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$tmp/somewhere/else.md\"}}" \
  | HOME="$tmp" bash config/.claude/hooks/sync-codex-skills.sh; echo $?   # → 0、リンク変化なし
```

**Verify**: 経路 A/B で symlink が作成され、経路 C では何も起きない

### Step 3: shellcheck を通す

**Verify**: `nix run nixpkgs#shellcheck -- --severity=error config/.claude/hooks/sync-codex-skills.sh` → exit 0

## Test plan

Step 2 の 3 経路テストが本体（A がこのプランの回帰テスト）。恒久テスト化は Plan 012 の基盤整備後の検討事項。

## Done criteria

Machine-checkable. ALL must hold:

- [ ] Step 2 の経路 A / B / C が全て期待どおり
- [ ] `rg -c '\*/\.claude/skills/\*' config/.claude/hooks/sync-codex-skills.sh` → 1
- [ ] shellcheck --severity=error が exit 0
- [ ] `git status` で変更が in-scope の 1 ファイルのみ
- [ ] `plans/README.md` の 010 行を更新

## STOP conditions

Stop and report back (do not improvise) if:

- case ブロックが「Current state」の抜粋と一致しない（drift）。
- 経路 C（無関係パス）で同期が走ってしまう場合 — パターンが広すぎる。1 回修正しても直らなければ停止。

## Maintenance notes

- 未解決の構造的問題（スコープ外として残置）: worktree で**新規**スキルを作った場合、hook は発火するが同期元は main 作業ツリー（`$HOME/01-dev/dotfiles`）を読むため、マージ前は新スキルが見えない。マージ後は編集イベントが無いので、次に何かのスキルを編集するまで `~/.codex/skills` に反映されない。恒久対策の候補は「darwin-rebuild の activation でも同期を走らせる」（`nix/packages.nix` に activation を足す）— 必要になったら別プランに。
- レビュー時の注目点: case パターンの glob が意図した集合だけを含むか（`~/.codex/skills` 自身のパスを含まないこと）。
