# Plan 006: 死んでいる sync-codex-skills hook を登録し、reject 系 hook の出力契約を docs 準拠にする

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 3dbd88e..HEAD -- config/.claude/settings.json config/.claude/hooks/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/002-multi-host-flake.md（settings.json を両 plan が触るためコンフリクト回避。002 を先に）
- **Category**: bug
- **Planned at**: commit `3dbd88e`, 2026-07-09

## Why this matters

`config/.claude/hooks/sync-codex-skills.sh` は「スキル編集時に `~/.codex/skills/` へ symlink を同期し、Codex CLI からも同じスキルを使えるようにする」PostToolUse hook として書かれている（ファイル冒頭コメント）。しかし `settings.json` の `hooks` には `SessionStart` と `PreToolUse` しか登録されておらず、**このスクリプトは一度も実行されない**（Claude Code の公式 docs で確認済み: hooks ディレクトリに置くだけでは実行されず、settings の `hooks.<Event>` 登録が必須）。Codex へのスキル同期は静かに止まっており、スキルを追加・削除しても Codex 側に反映されない。あわせて、reject-grep.sh / reject-raw-pm.sh は「exit 2 + stderr に JSON」を出すが、docs の契約では **exit 2 のとき JSON は無視されプレーンテキスト扱い**（構造化出力は exit 0 + stdout JSON）。現状ブロック自体は機能しているが、エージェントに渡る理由文が生 JSON 文字列になっている。

## Current state

- `config/.claude/settings.json:44-74` — hooks 登録は SessionStart（copy-env.sh）と PreToolUse（reject-grep.sh, reject-raw-pm.sh）のみ。`PostToolUse` キーは存在しない。
- `config/.claude/hooks/sync-codex-skills.sh:1-23` — 冒頭:

```bash
#!/bin/bash
# PostToolUse hook: keep ~/.codex/skills/ in sync with dotfiles skill directories
# so Codex CLI picks up newly added/removed Claude Code skills automatically.

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty')

if [ "$TOOL" != "Write" ] && [ "$TOOL" != "Edit" ]; then
  exit 0
fi
```

スクリプト自身が Write/Edit 以外と `*/config/.claude/skills/*` 以外のパスを除外し、`~/.codex/skills` が無ければ即 exit するガードを持つ（`:22-23`）。冪等で安全。

- `config/.claude/hooks/reject-grep.sh:14-17` — 現在の出力:

```bash
if echo "$CMD" | rg -q '(^|[;&|() ])grep(\s|$)'; then
  echo '{"decision":"block","reason":"grep は禁止。rg (ripgrep) を使ってください"}' >&2
  exit 2
fi
```

- `config/.claude/hooks/reject-raw-pm.sh` — 同じパターンが 5 ブロック（npm / yarn / pnpm / npx / bun）。
- 公式 docs の契約（2026-07-09 に claude-code-guide agent 経由で確認）: PreToolUse のブロックは「exit 2 + stderr の**プレーンテキスト**が Claude へのフィードバック」または「exit 0 + stdout に `hookSpecificOutput.permissionDecision` JSON」。**exit 2 のとき JSON は無視される**（"Claude Code ignores JSON when you exit 2"）。
- 注意: `~/.claude/settings.json` はこのリポジトリの `config/.claude/settings.json` への symlink（稼働中の設定を直接編集することになる）。JSON を壊すと次のセッションから設定全体が読めなくなるため、編集後の `jq` 検証が必須。

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| JSON 妥当性 | `jq . config/.claude/settings.json > /dev/null` | exit 0 |
| shellcheck | `nix run nixpkgs#shellcheck -- --severity=error config/.claude/hooks/*.sh` | 出力なし、exit 0 |
| hook 単体テスト（ブロック） | `echo '{"tool_name":"Bash","tool_input":{"command":"grep foo bar"}}' \| bash config/.claude/hooks/reject-grep.sh; echo "exit=$?"` | stderr に理由テキスト、`exit=2` |
| hook 単体テスト（通過） | `echo '{"tool_name":"Bash","tool_input":{"command":"rg foo bar"}}' \| bash config/.claude/hooks/reject-grep.sh; echo "exit=$?"` | 出力なし、`exit=0` |

## Scope

**In scope**（変更してよいファイル）:
- `config/.claude/settings.json`（`hooks` キーへの `PostToolUse` 追加のみ）
- `config/.claude/hooks/reject-grep.sh`
- `config/.claude/hooks/reject-raw-pm.sh`

**Out of scope**（触らない）:
- `config/.claude/hooks/sync-codex-skills.sh` 本体 — ロジックは正しい。登録が無いだけ
- `config/.claude/hooks/copy-env.sh` — 正常動作中
- `settings.json` の `hooks` 以外のキー（permissions / model / enabledPlugins 等）
- reject 系 hook の正規表現マッチング自体（`git grep` も止める等の誤検知はあるが、意図的な厳しさとして現状維持）

## Git workflow

- **必ず worktree 上で作業**（`$REPO_ROOT/.worktrees/<slug>/`）
- Branch: `fix/hooks-registration`
- Commit message 例: `fix(hooks): sync-codex-skills を PostToolUse に登録し reject 系の出力契約を docs 準拠に修正`
- push / PR 作成はオペレーターの指示があるときのみ

## Steps

### Step 1: settings.json に PostToolUse を登録する

`config/.claude/settings.json` の `hooks` オブジェクト内、`PreToolUse` 配列の後に追加:

```json
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/sync-codex-skills.sh",
            "timeout": 10
          }
        ]
      }
    ]
```

matcher `"Write|Edit"` はツール名の正規表現。スクリプト側にも同じガードがあるので二重だが、matcher で絞る方が無駄なプロセス起動を減らす。コマンドパスは既存 2 hook と同じ `~/.claude/hooks/` 形式（symlink 経由で解決される）に合わせる。

**Verify**: `jq '.hooks.PostToolUse[0].matcher' config/.claude/settings.json` → `"Write|Edit"`。`jq . config/.claude/settings.json > /dev/null` → exit 0

### Step 2: reject-grep.sh の出力を docs 準拠のプレーンテキストにする

`config/.claude/hooks/reject-grep.sh:15` の JSON echo を置き換え:

```bash
  echo "grep は禁止。rg (ripgrep) を使ってください" >&2
  exit 2
```

**Verify**: Commands 表の単体テスト 2 本（ブロック→ stderr がプレーンテキストで exit=2、通過→ exit=0）

### Step 3: reject-raw-pm.sh の 5 ブロックを同様に修正する

npm / yarn / pnpm / npx / bun の各ブロックの `echo '{"decision":...}' >&2` を、reason 部分だけのプレーンテキスト echo に置き換える（メッセージ文言は既存 JSON の `reason` 値をそのまま流用）。

**Verify**:
- `echo '{"tool_name":"Bash","tool_input":{"command":"npm install"}}' | bash config/.claude/hooks/reject-raw-pm.sh; echo "exit=$?"` → stderr に「npm は禁止。ni を使ってください（npm install → ni, npm run → nr）」、`exit=2`
- `echo '{"tool_name":"Bash","tool_input":{"command":"ni"}}' | bash config/.claude/hooks/reject-raw-pm.sh; echo "exit=$?"` → 出力なし、`exit=0`
- `rg -n 'decision' config/.claude/hooks/` → マッチなし（exit 1）

### Step 4: sync hook の実地スモークテスト

`~/.codex/skills` ディレクトリが存在するマシンでのみ実施（無ければ「スクリプトのガードで no-op になる」ことを確認して省略可）:

```bash
echo '{"tool_name":"Write","tool_input":{"file_path":"'$HOME'/01-dev/dotfiles/config/.claude/skills/nix/SKILL.md"}}' | bash config/.claude/hooks/sync-codex-skills.sh; echo "exit=$?"
```

**Verify**: `exit=0`。`~/.codex/skills/` に dotfiles スキルへの symlink が存在する（`ls -la ~/.codex/skills/ | head`）

## Test plan

- Commands 表と各 Step の単体テストがすべて（ブロック 2 系統 × block/pass、sync の no-op / 実行）
- `nix run nixpkgs#shellcheck -- --severity=error config/.claude/hooks/*.sh` → exit 0（Plan 001 の CI ゲートと同条件）
- 実セッションでの発火確認はオペレーター向けに手順を完了報告へ記載: 「新しい Claude Code セッションでスキルファイルを 1 つ Edit し、`[sync-codex-skills] linked:` 行が出る（または no-op）こと」

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `jq -e '.hooks.PostToolUse' config/.claude/settings.json` が exit 0
- [ ] `rg 'decision' config/.claude/hooks/` がマッチなし（exit 1）
- [ ] 単体テスト: reject-grep（block/pass）、reject-raw-pm（block/pass）が期待どおり
- [ ] shellcheck `--severity=error` が exit 0
- [ ] `git status` で in-scope 3 ファイル以外に変更がない
- [ ] `plans/README.md` のステータス行を更新した

## STOP conditions

Stop and report back (do not improvise) if:

- `settings.json` の `hooks` 構造が Current state と異なる（drift。特に誰かが先に PostToolUse を追加していた場合は二重登録になる）
- 単体テストで reject hook の exit code が期待と異なる（rg の正規表現挙動が環境で違う可能性 — 原因を particular に報告）
- `jq` 検証が一度でも失敗した状態でセッションを跨ぎそうになった場合（**settings.json は稼働中設定への symlink**。壊れた JSON を放置すると次セッションが設定なしで起動する。即座に直すか `git checkout -- config/.claude/settings.json` で戻す）

## Maintenance notes

- **このリポジトリの hooks 追加の定石**: スクリプトを `config/.claude/hooks/` に置く + `settings.json` の `hooks.<Event>` に登録、の**2 点セット**。今回の欠陥は後者漏れ。レビュー時は新規 hook スクリプトに対応する settings 登録があるかを必ず見る（Plan 001 の CI にこの照合チェックを足すのも有効: hooks/*.sh のファイル名が settings.json に現れることの rg assertion）。
- sync-codex-skills.sh は `$HOME/01-dev/dotfiles` をハードコードしている。両マシンともこの配置なので現状問題ないが、リポジトリの置き場所を変えたら壊れる（Plan 002 のパラメータ化と同種の残り火）。
- reject 系の理由文言を変えるときは、CLAUDE.md の「ツール制約」節と同期させること。
