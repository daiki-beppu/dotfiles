# Plan 020: sync-agent-skills が skillOverrides を尊重するようにし、自作 2 スキルを削除する

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f9948f8..HEAD -- scripts/sync-agent-skills.sh scripts/check.sh config/.claude/skills/aqua-improve config/.claude/skills/release-tweet config/.claude/settings.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED（Codex に見えるスキル一覧が一括で変わる — それが目的だが、除外ロジックの
  バグは「Codex から必要なスキルが消える」形で現れる）
- **Depends on**: plans/018-cloudflare-plugin-migration.md, plans/019-cmux-vendor-cleanup.md
  （settings.json の skillOverrides を同時に編集するため。内容上も、残る off スキルが
  4 → 2 個になってから除外ロジックを入れる方が検証が単純）
- **Category**: tech-debt
- **Planned at**: commit `f9948f8`, 2026-08-26

## Why this matters

`config/.claude/settings.json` の `skillOverrides: "off"` は **Claude Code にしか効かない**。
`scripts/sync-agent-skills.sh` は manifest 無し実行時に「SKILL.md を持つ全ディレクトリ」を
`~/.agents/skills/`（Codex user scope）へ symlink するため、Claude Code で off にした
スキルも Codex では毎セッションロードされ続ける。「off で保持」という選定結果が
片側にしか効かないのは、要不要選定の実効性を половину失わせる。

あわせて、**ユーザーの決定（2026-08-26）** による自作スキルの処遇を実行する:
- **削除**: `aqua-improve`（Aqua Voice 辞書改善。2026-07-05 の出荷当日に 1 回走ったきり、
  謳っていた週次スケジュール実行は未配線）、`release-tweet`（リリース告知ドラフト）
- **保持（off のまま）**: `empirical-prompt-tuning`、`evidence-record` —
  本プランの除外ロジックが入ることで、この 2 つは Codex 側でも本当に off になる

## Current state

- `scripts/sync-agent-skills.sh:74-81` — manifest 無し時の対象列挙（除外なし）:

```bash
else
  for source in "$SOURCE_DIR"/*; do
    [ -d "$source" ] || continue
    [ -L "$source" ] && continue
    [ -f "$source/SKILL.md" ] || continue
    add_skill "$(basename "$source")"
  done
fi
```

- `scripts/sync-agent-skills.sh:6-10` — 設定可能なパスは `SOURCE_DIR` / `DEST_DIR` /
  `LEGACY_DIR` の 3 つ。settings.json への参照は現在**無い**
- `scripts/sync-agent-skills.sh:93-107` — 掃除ループ: `SOURCE_DIR` 配下を指す symlink の
  うち desired リストに無いものを削除する（= 除外ロジックを足せば、既存の off スキルの
  リンクは次回実行時に自動回収される）
- `scripts/check.sh` の `check_agent_skills()`（約 165-218 行）— 一時ディレクトリで
  **manifest モードのみ**を実走テストしている。manifest 無しモードのテストは無い
- `config/.claude/settings.json` の `skillOverrides` — Plan 018/019 実施後は
  `aqua-improve` / `empirical-prompt-tuning` / `evidence-record` / `release-tweet` の 4 キー
- `config/.claude/skills/aqua-improve/` — 1 ファイル（SKILL.md 113 行）
- `config/.claude/skills/release-tweet/` — 1 ファイル（SKILL.md 161 行）
- aqua-improve の実行時状態は `~/.claude/aqua-improve/`（state.json, reports/）にある —
  **リポジトリ外のユーザーデータであり削除対象ではない**
- `jq` はこのマシンに存在する（`check_hooks` が既に依存している）
- hook `config/.claude/hooks/sync-codex-skills.sh`（PostToolUse: Write|Edit）が
  スキル編集のたびに sync を呼ぶ — 除外ロジックはそこ経由でも同じに効く

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| shellcheck | `bash scripts/check.sh shellcheck` | exit 0 |
| sync テスト | `bash scripts/check.sh agent-skills` | exit 0 |
| 全チェック | `bash scripts/check.sh` | exit 0 |
| 実同期 | `bash scripts/sync-agent-skills.sh` | exit 0 |

## Scope

**In scope**:

- `scripts/sync-agent-skills.sh` — 除外ロジック追加
- `scripts/check.sh` — `check_agent_skills` に manifest 無し + overrides のテストを追加
- `config/.claude/skills/{aqua-improve,release-tweet}/` — 削除
- `config/.claude/settings.json` — `skillOverrides` から `aqua-improve` / `release-tweet` の
  2 キーを削除（`empirical-prompt-tuning` / `evidence-record` は**残す**）
- `plans/README.md` — 自分の status 行

**Out of scope**:

- manifest モード（`--manifest`）の挙動 — Codex Cloud の明示リストは overrides に
  従わせない（明示は暗黙に勝つ）。変更しない
- `config/codex-cloud/skills.txt` — 4 スキルとも off ではないので無関係
- `~/.claude/aqua-improve/` — ユーザーデータ。触らない
- `config/.claude/hooks/sync-codex-skills.sh` — 呼び出し側は無変更でよい

## Git workflow

- Branch: `feat/sync-skill-overrides`（worktree: `$REPO_ROOT/.claude/worktrees/sync-skill-overrides/`）
- コミット例: `feat(scripts): sync-agent-skills が skillOverrides=off を除外するように` と
  `chore(claude): aqua-improve / release-tweet を削除` の 2 コミットに分けてよい

## Steps

### Step 1: sync-agent-skills.sh に除外ロジックを追加する

`scripts/sync-agent-skills.sh` に以下を実装する:

1. 設定ファイルパスを環境変数で上書き可能にする（テスト用）。`MANIFEST=""` の宣言の
   近く（10 行目付近)に追加:

```bash
SETTINGS_FILE="${DOTFILES_SETTINGS_FILE:-$REPO_ROOT/config/.claude/settings.json}"
```

2. manifest 無し分岐（74-81 行）で、`skillOverrides` の値が `"off"` のスキルを飛ばす。
   ループの前に off リストを 1 回だけ構築する:

```bash
else
  disabled=""
  if [ -f "$SETTINGS_FILE" ] && command -v jq >/dev/null 2>&1; then
    disabled="$(jq -r '.skillOverrides // {} | to_entries[] | select(.value == "off") | .key' "$SETTINGS_FILE")"
  fi
  for source in "$SOURCE_DIR"/*; do
    [ -d "$source" ] || continue
    [ -L "$source" ] && continue
    [ -f "$source/SKILL.md" ] || continue
    name="$(basename "$source")"
    if printf '%s\n' "$disabled" | grep -Fxq "$name"; then
      echo "[sync-agent-skills] skipped (off in skillOverrides): $name" >&2
      continue
    fi
    add_skill "$name"
  done
fi
```

usage テキスト（14-18 行）にも 1 行足す:
`Without --manifest, links every non-symlink skill managed by dotfiles, except skills set to "off" in skillOverrides.`

**Verify**: `bash scripts/check.sh shellcheck` → exit 0

### Step 2: check.sh の agent-skills チェックに manifest 無しモードのテストを追加する

`scripts/check.sh` の `check_agent_skills()` の末尾（`rg -n '[.]codex/skills'` チェックの
前）に、一時ディレクトリでの no-manifest + overrides 実走を追加する:

```bash
  # --- no-manifest mode: skillOverrides "off" skills must be excluded ---
  mkdir -p "$tmp_dir/src/keep-me" "$tmp_dir/src/off-me" "$tmp_dir/dest2"
  printf -- '---\nname: keep-me\ndescription: t\n---\n' > "$tmp_dir/src/keep-me/SKILL.md"
  printf -- '---\nname: off-me\ndescription: t\n---\n' > "$tmp_dir/src/off-me/SKILL.md"
  printf '{"skillOverrides":{"off-me":"off"}}\n' > "$tmp_dir/settings.json"
  ln -s "$tmp_dir/src/off-me" "$tmp_dir/dest2/off-me"   # 既存リンクが掃除されることも見る

  DOTFILES_SKILLS_DIR="$tmp_dir/src" \
  AGENT_SKILLS_DIR="$tmp_dir/dest2" \
  LEGACY_AGENT_SKILLS_DIR="$tmp_dir/no-legacy" \
  DOTFILES_SETTINGS_FILE="$tmp_dir/settings.json" \
    bash scripts/sync-agent-skills.sh

  [ -L "$tmp_dir/dest2/keep-me" ] || {
    echo "MISSING: no-manifest sync did not link an enabled skill" >&2
    return 1
  }
  [ ! -e "$tmp_dir/dest2/off-me" ] || {
    echo "STALE: skillOverrides=off skill is still linked" >&2
    return 1
  }
```

**Verify**: `bash scripts/check.sh agent-skills` → exit 0（新旧両方の assert が通る）

### Step 3: aqua-improve / release-tweet を削除する

```bash
git rm -r -q config/.claude/skills/aqua-improve config/.claude/skills/release-tweet
```

`config/.claude/settings.json` の `skillOverrides` から `aqua-improve` と `release-tweet` の
2 キーを削除する。

**Verify**: `jq -r '.skillOverrides | keys | join(",")' config/.claude/settings.json` →
`empirical-prompt-tuning,evidence-record`

### Step 4: 実同期して結果を確認する

> **worktree 内で `bash scripts/sync-agent-skills.sh` を素で実行してはならない。**
> `SOURCE_DIR` はスクリプト自身の位置から解決されるため、worktree で走らせると
> `~/.agents/skills/` の symlink が全部 worktree を指すよう張り替えられ、
> worktree 削除と同時にリンク切れになる（2026-08-26 に Plan 019 で回避した事故）。
> worktree では **`DEST_DIR` を一時ディレクトリに逃がして**挙動だけ確認する:
>
> ```bash
> tmp=$(mktemp -d)
> AGENT_SKILLS_DIR="$tmp" LEGACY_AGENT_SKILLS_DIR="$tmp/no-legacy" \
>   bash scripts/sync-agent-skills.sh
> ```
>
> 実 `~/.agents/skills` への同期は、**main にマージした後メインチェックアウトで**
> 1 回走らせる（executor の担当外・レビュアーまたはユーザーが実施）。


**Verify**（上記の一時 `AGENT_SKILLS_DIR` 実行の stderr を見る）: `skipped (off in skillOverrides): empirical-prompt-tuning` と
`skipped (off in skillOverrides): evidence-record`、および
`removed stale:` に `aqua-improve` / `release-tweet` / `empirical-prompt-tuning` /
`evidence-record` が出る（既存リンクの回収）。
`ls ~/.agents/skills/ | grep -cE '^(aqua-improve|release-tweet|empirical-prompt-tuning|evidence-record)$'` → `0`

### Step 5: 全チェック

```bash
bash scripts/check.sh
```

**Verify**: `all checks passed`、exit 0

## Test plan

- 新テスト: Step 2 の no-manifest + overrides 実走（enabled はリンクされる /
  off はリンクされない / off の既存リンクは掃除される、の 3 assert）。
  既存の manifest モードテスト（`check_agent_skills` 前半）を構造の手本にする
- 実行: `bash scripts/check.sh agent-skills` → exit 0

## Done criteria

- [ ] `bash scripts/check.sh` exit 0（shellcheck が新コードを含めて pass）
- [ ] `git ls-files | grep -cE 'skills/(aqua-improve|release-tweet)/'` → `0`
- [ ] `jq -r '.skillOverrides | keys | join(",")' config/.claude/settings.json` → `empirical-prompt-tuning,evidence-record`
- [ ] `ls ~/.agents/skills/` に off スキル・削除スキルの symlink が無い
- [ ] `bash scripts/sync-agent-skills.sh` を 2 回連続実行しても 2 回目が冪等（skipped 2 件、removed 0 件、exit 0）
- [ ] `plans/README.md` の status 行を更新済み

## STOP conditions

Stop and report back (do not improvise) if:

- `skillOverrides` の現在のキーが `aqua-improve` / `empirical-prompt-tuning` /
  `evidence-record` / `release-tweet` の 4 つでない（Plan 018/019 が未実施か、
  別の変更が入っている）
- `jq` が見つからない（除外ロジックの前提。`check_hooks` も壊れているはずなので
  環境異常として報告）
- Step 4 で `refusing to replace non-symlink skill` が出た（`~/.agents/skills/` に
  手動配置の実体がある — 消さずに報告）
- shellcheck が新コードを error 判定し、2 回の修正で解消しない

## Maintenance notes
- **2026-08-26 の実地で見つかった穴（このプランで直す価値あり）**: `sync-agent-skills.sh` の
  掃除ループは `case "$resolved" in "$SOURCE_DIR"/*)` の**文字列前方一致**で
  「dotfiles 管理のリンクか」を判定する。`~/01-dev/dotfiles` は ghq のリポジトリへの
  symlink エイリアスで、そちら経由で sync が走ると（bash の `cd a/..` は論理パスを保つため
  `pwd` が `/Users/mba/01-dev/dotfiles` を返す）リンクが別表記で作られ、以後
  ghq パスから走らせても掃除対象と認識されない。018 / 019 のマージ後に実際に
  リンク切れ 14 本が取り残され、手動削除が必要だった。
  修正案: `resolved` と `SOURCE_DIR` の双方を `cd -P` 相当で正規化してから比較する
  （`realpath` は macOS の coreutils 非依存で使えないことがあるので
  `cd -P "$(dirname "$x")" && pwd -P` を使う）。ただし**リンク切れは
  `cd` できない**ので、比較は「リンク先の親ディレクトリを正規化」で行うこと。
  安全ガード（他 installer のリンクに触らない）は維持したまま、同一実体の別表記だけを
  拾えるようにするのが要件。
- これ以降、`skillOverrides: "off"` は Claude Code と Codex の**両方**に効く。
  スキルを Codex だけで使いたいケースが将来出たら、その時に per-agent の仕組みを
  設計する（現状はニーズ無し）
- `empirical-prompt-tuning`（実測ベースのプロンプト改善ループ）と `evidence-record`
  （playwright-cli による操作証跡動画）は**意図的に保持**した off スキル。
  再有効化は settings.json の 1 行変更で済む。次回の監査はこれらを
  「未使用だから削除」と再提案しないこと（ユーザー決定済み、2026-08-26）
- aqua-improve の実行時データ `~/.claude/aqua-improve/` は残っている。完全に
  片付けたければユーザーが手動で消す（reports/ に過去の分析レポートが 1 件ある）
- レビュアーの注視点: Step 1 の `grep -Fxq` は名前の完全一致比較 — 部分一致で
  誤除外しないことをテストが担保しているか
