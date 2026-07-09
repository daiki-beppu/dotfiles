# Plan 009: reject hooks が引用文字列内の禁止語に誤発動しないようにする

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat e0a2d44..HEAD -- config/.claude/hooks/reject-grep.sh config/.claude/hooks/reject-raw-pm.sh`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `e0a2d44`, 2026-07-09

## Why this matters

`reject-grep.sh` と `reject-raw-pm.sh` は PreToolUse hook として**全セッションの全 Bash 呼び出し**で実行される。現在の正規表現はコマンド文字列全体に対して素朴にマッチするため、引用文字列の中の単語にも発動する: `git commit -m "replace grep with rg"` や `gh pr create --body "... npm scripts を ni に移行 ..."` が exit 2 でハードブロックされ、エージェントは実行するつもりのない単語のために文面を書き換えさせられる。禁止語（grep/npm/yarn/pnpm/npx/bun）はコミットメッセージや PR 本文に頻出する語彙なので、これは日常的な摩擦になっている。

## Current state

- `config/.claude/hooks/reject-grep.sh` — 19 行。核心は 14 行目:

```bash
# Match standalone grep command (not inside rg, not part of another word)
if echo "$CMD" | rg -q '(^|[;&|() ])grep(\s|$)'; then
  echo "grep は禁止。rg (ripgrep) を使ってください" >&2
  exit 2
fi
```

- `config/.claude/hooks/reject-raw-pm.sh` — 同じ構造で npm / yarn / pnpm / npx / `bun(x?)` の 5 ブロック（14〜40 行目）。パターンは全て `(^|[;&|() ])<word>(\s|$)` 形式。
- 両スクリプトとも冒頭で `jq` により `.tool_name` / `.tool_input.command` を取り出し、Bash 以外は exit 0。`jq`/`rg` が無い場合は fail-open（ブロックしない）— この性質は維持すること。
- hook の契約: exit 2 + stderr = ブロック、exit 0 = 許可。
- テスト基盤は無い。検証は stdin に JSON をパイプして exit code を見る方式（下記）。

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| shellcheck | `nix run nixpkgs#shellcheck -- --severity=error config/.claude/hooks/reject-grep.sh config/.claude/hooks/reject-raw-pm.sh` | exit 0 |
| hook 単体実行 | `echo '<JSON>' \| bash config/.claude/hooks/reject-grep.sh; echo $?` | 期待する exit code（下記マトリクス） |

## Scope

**In scope**:
- `config/.claude/hooks/reject-grep.sh`
- `config/.claude/hooks/reject-raw-pm.sh`

**Out of scope**:
- `config/.claude/settings.json` — hook 登録は正しく機能している（Plan 006 で検証済み）
- `config/.claude/hooks/copy-env.sh` / `sync-codex-skills.sh` — 別プラン（010）
- 「コマンド位置の厳密なシェル構文解析」— 完全なトークナイズはこの守備範囲を超える。引用スパンの除去で実用上十分

## Git workflow

- Branch: `fix/reject-hooks-quoted-strings`（worktree 上で作業 — repo 規約）
- Commit message 例: `fix(hooks): reject hooks が引用文字列内の禁止語に誤発動しないよう修正`
- Push / PR 作成はユーザー指示があるまでしない

## Steps

### Step 1: reject-grep.sh に引用スパン除去を入れる

`CMD` を取得した直後（11 行目の後）に、シングル/ダブルクォートで囲まれた区間を除去した文字列を作り、マッチ対象をそれに切り替える:

```bash
# 引用文字列の中身は実行されないコマンドなのでマッチ対象から除外する
# （エスケープされた引用符などの完全な構文解析はしない — soft guardrail で十分）
STRIPPED=$(printf '%s' "$CMD" | sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g")

if echo "$STRIPPED" | rg -q '(^|[;&|() ])grep(\s|$)'; then
```

既存の正規表現・エラーメッセージ・exit code は変えない。

**Verify**: 下記マトリクスの reject-grep 行が全て期待どおり

### Step 2: reject-raw-pm.sh に同じ変更を入れる

同様に `STRIPPED` を作り、5 つの `rg -q` 全てのマッチ対象を `"$CMD"` から `"$STRIPPED"` に変える。

**Verify**: 下記マトリクスの reject-raw-pm 行が全て期待どおり

### Step 3: 検証マトリクスを全件実行する

ヘルパー（コピペ用）:

```bash
t() { echo "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"$1\"}}" | bash "$2" >/dev/null 2>&1; echo "$1 => $?"; }
```

| # | command | hook | 期待 exit |
|---|---------|------|-----------|
| 1 | `grep foo bar.txt` | reject-grep | 2 |
| 2 | `echo a \| grep b` | reject-grep | 2 |
| 3 | `git commit -m 'replace grep with rg'` | reject-grep | 0 |
| 4 | `rg pattern file` | reject-grep | 0 |
| 5 | `npm install` | reject-raw-pm | 2 |
| 6 | `npx create-next-app` | reject-raw-pm | 2 |
| 7 | `git commit -m 'npm run を nr に移行'` | reject-raw-pm | 0 |
| 8 | `gh pr create --body 'bun install の説明'` | reject-raw-pm | 0 |
| 9 | `bunx tsc` | reject-raw-pm | 2 |
| 10 | （tool_name が Read の JSON） | 両方 | 0 |

JSON 内でダブルクォートを含むコマンド（例 3 相当をダブルクォートで）も 1 ケース手動で足して確認すること: `{"tool_name":"Bash","tool_input":{"command":"git commit -m \"use grep\""}}` → exit 0。

**Verify**: 全ケースが期待 exit code に一致

### Step 4: shellcheck を通す

**Verify**: `nix run nixpkgs#shellcheck -- --severity=error config/.claude/hooks/reject-grep.sh config/.claude/hooks/reject-raw-pm.sh` → exit 0

## Test plan

Step 3 のマトリクスがテスト本体。恒久的なテストファイルは作らない（hook のテスト基盤が無いため。Plan 012 の check スクリプト整備後に、このマトリクスを `scripts/` 配下のテストに昇格させる選択肢を Maintenance notes に残す）。

## Done criteria

Machine-checkable. ALL must hold:

- [ ] 検証マトリクス 10 ケース + ダブルクォート 1 ケースが全て期待どおり
- [ ] `rg -c 'STRIPPED' config/.claude/hooks/reject-grep.sh` → 2 以上（定義 + 使用）
- [ ] `rg -c 'STRIPPED' config/.claude/hooks/reject-raw-pm.sh` → 6 以上（定義 + 5 ブロックでの使用）
- [ ] shellcheck --severity=error が exit 0
- [ ] `git status` で変更が in-scope の 2 ファイルのみ
- [ ] `plans/README.md` の 009 行を更新

## STOP conditions

Stop and report back (do not improvise) if:

- 「Current state」の抜粋が実ファイルと一致しない（drift）。
- マトリクスのブロック系ケース（1,2,5,6,9）のどれかが 0 を返す — 引用除去が過剰に削っている。sed パターンを 2 回修正しても直らなければ停止。
- 完全なシェル構文解析（heredoc、エスケープ引用符、`$(...)` 内など）が必要だと感じた場合 — それはスコープ外。「既知の限界」として報告に書いて終了してよい。

## Maintenance notes

- 既知の限界（意図的に許容）: エスケープされた引用符（`\"`）を含むネスト、heredoc 内の禁止語、`npm&&true` のような無空白連結は正しく扱えない。これは soft guardrail であり、完璧な enforcement ではない。
- 新しい禁止コマンドを足すときは `STRIPPED` に対してマッチさせること（`$CMD` 直接ではなく）。
- Plan 012 で CI/検証基盤が入ったら、Step 3 のマトリクスを永続テスト化する価値がある。
