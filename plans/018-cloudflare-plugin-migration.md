# Plan 018: Cloudflare 系 9 スキルを公式プラグインへ移行しローカルスナップショットを削除する

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f9948f8..HEAD -- config/.claude/skills/cloudflare config/.claude/skills/agents-sdk config/.claude/skills/wrangler config/.claude/skills/workers-best-practices config/.claude/skills/durable-objects config/.claude/skills/sandbox-sdk config/.claude/skills/cloudflare-email-service config/.claude/skills/turnstile-spin config/.claude/skills/web-perf config/.claude/settings.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `f9948f8`, 2026-08-26

## Why this matters

Cloudflare 系 9 スキル（cloudflare / agents-sdk / wrangler / workers-best-practices /
durable-objects / sandbox-sdk / cloudflare-email-service / turnstile-spin / web-perf）は
2026-06-13 の 1 コミット（`bc76c5f`）で輸入されて以来一度も更新されていない vendor
スナップショットで、**リポジトリの追跡ファイル 501 個中 391 個（78%）** を占める。
全 9 個は `config/.claude/settings.json` の `skillOverrides` で off だが、ディレクトリが
残る限り `scripts/sync-agent-skills.sh` が Codex（`~/.agents/skills/`）へ symlink し続ける。

同じ内容は公式マーケットプレイスのプラグイン **`cloudflare@claude-plugins-official`**
（source: `https://github.com/cloudflare/skills.git`）として配布されており、自動更新される。
ローカルスナップショットは既にドリフト済み（upstream では `sandbox-sdk` が
`sandbox-next` / `sandbox-stable` に分割・改名され、`cloudflare-one` 等の新スキルも増えた）。

**ユーザーの決定（2026-08-26）**: 「Cloudflare はサービスとしてよく使うのでスキルを on にしたい。
ただしスキル自体を多用しているわけではない」。この要求は「古いローカルコピーを on に戻す」
のではなく「公式プラグインを有効化して常に最新を使い、ローカルの死荷重を消す」ことで満たす。

## Current state

- `config/.claude/skills/cloudflare/` — 321 ファイル / 約 2MB。SKILL.md 245 行
- `config/.claude/skills/{agents-sdk,wrangler,workers-best-practices,durable-objects,sandbox-sdk,cloudflare-email-service,turnstile-spin,web-perf}/` — 合わせて 70 ファイル
- `config/.claude/settings.json` の `skillOverrides`（33 行目付近）に 9 個のエントリ:

```json
  "skillOverrides": {
    "agents-sdk": "off",
    ...
    "cloudflare": "off",
    "cloudflare-email-service": "off",
    ...
    "durable-objects": "off",
    ...
    "sandbox-sdk": "off",
    "turnstile-spin": "off",
    "web-perf": "off",
    "workers-best-practices": "off",
    ...
  }
```

- `config/.claude/settings.json` の `enabledPlugins`（88 行目付近）に cloudflare の
  エントリは**無い**（= プラグイン未インストール）:

```json
  "enabledPlugins": {
    "context7@claude-plugins-official": true,
    ...
  }
```

- プラグインカタログキャッシュ `/Users/mba/.claude/plugins/plugin-catalog-cache.json` に
  `"cloudflare@claude-plugins-official"` エントリが存在する（skills コンポーネントとして
  同名スキル群を含む）
- `config/codex-cloud/skills.txt` は `issue-direct` / `gh-stack` / `goal-setter` / `issue`
  のみ — Cloudflare 系は含まれず、Codex Cloud には影響しない
- `scripts/check.sh` の shellcheck チェックは `git ls-files` から shebang で対象を自動検出する
  （除外リスト空）。turnstile-spin の bash スクリプト 6 本が削除されると検出対象が減るだけで、
  チェック自体は壊れない
- 削除の後始末は自己修復する: `scripts/sync-agent-skills.sh` の掃除ループ（93〜107 行）は
  「`config/.claude/skills/` 配下を指す symlink のうち、望ましいリストに無いもの」だけを
  `~/.agents/skills/` から削除する
- リポジトリ規約: 開発作業は必ず worktree 上で行う（repo CLAUDE.md）。コミットは
  conventional commits の日本語 subject（例: `chore(claude): 未使用スキル16個・プラグイン2個を無効化し dotfiles 管理節を移設`）

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 全チェック | `bash scripts/check.sh` | exit 0, "all checks passed" |
| 対象チェックのみ | `bash scripts/check.sh shellcheck links agent-skills` | exit 0 |
| settings 構文 | `jq . config/.claude/settings.json > /dev/null` | exit 0 |
| Codex 側同期 | `bash scripts/sync-agent-skills.sh` | `[sync-agent-skills] removed stale: ...` が 9 件出て exit 0 |

## Scope

**In scope**（変更してよいファイル）:

- `config/.claude/skills/{cloudflare,agents-sdk,wrangler,workers-best-practices,durable-objects,sandbox-sdk,cloudflare-email-service,turnstile-spin,web-perf}/` — 削除
- `config/.claude/settings.json` — `skillOverrides` 9 キー削除、`enabledPlugins` 1 キー追加
- `plans/README.md` — 自分の status 行と deferred #9 の追記

**Out of scope**（触らない）:

- `config/.claude/skills/` の他のスキル（cmux-* の削除は Plan 019 の担当）
- `skills-lock.json` — deferred #9 の同期ポリシー問題は本プランで「cloudflare 系は
  プラグイン管理に移行」とだけ決着し、lock ファイル自体の扱いは据え置く
- `scripts/sync-agent-skills.sh` — 変更不要（掃除ループが自動対応）。改修は Plan 020
- `~/.claude/plugins/` 配下 — Claude Code 管理領域。手で書き換えない

## Git workflow

- Branch: `chore/remove-cloudflare-vendor-skills`（worktree: `$REPO_ROOT/.claude/worktrees/remove-cloudflare-vendor-skills/`）
- コミットは 1 個にまとめてよい。message 例: `chore(claude): cloudflare 系 9 スキルを公式プラグインへ移行しローカル削除`
- push / PR 作成は operator の指示があるときだけ

## Steps

### Step 1: プラグインがカタログに存在することを確認する

```bash
python3 -c "
import json
d = json.load(open('/Users/mba/.claude/plugins/plugin-catalog-cache.json'))
print('cloudflare@claude-plugins-official' in json.dumps(d))"
```

**Verify**: 出力が `True`。`False` なら STOP（プラグイン供給元が消えた状態で
ローカルを消してはいけない）。

### Step 2: 削除対象への参照が残っていないことを確認する

```bash
grep -rnE 'skills/(cloudflare|agents-sdk|wrangler|workers-best-practices|durable-objects|sandbox-sdk|cloudflare-email-service|turnstile-spin|web-perf)([/ "]|$)' \
  config/ scripts/ CLAUDE.md README.md 2>/dev/null | grep -v 'config/.claude/skills/\(cloudflare\|agents-sdk\|wrangler\|workers-best-practices\|durable-objects\|sandbox-sdk\|cloudflare-email-service\|turnstile-spin\|web-perf\)/'
```

**Verify**: ヒット 0 件（削除対象ディレクトリ自身の内部からの参照は除外済み）。
1 件でも残っていたら STOP して参照元を報告する。

### Step 3: enabledPlugins に cloudflare プラグインを追加する

`config/.claude/settings.json` の `enabledPlugins` オブジェクトに 1 行追加する
（既存エントリの並びに合わせる）:

```json
    "cloudflare@claude-plugins-official": true,
```

**Verify**: `jq -r '.enabledPlugins["cloudflare@claude-plugins-official"]' config/.claude/settings.json` → `true`

### Step 4: 9 ディレクトリを git rm で削除する

```bash
git rm -r -q \
  config/.claude/skills/cloudflare \
  config/.claude/skills/agents-sdk \
  config/.claude/skills/wrangler \
  config/.claude/skills/workers-best-practices \
  config/.claude/skills/durable-objects \
  config/.claude/skills/sandbox-sdk \
  config/.claude/skills/cloudflare-email-service \
  config/.claude/skills/turnstile-spin \
  config/.claude/skills/web-perf
```

**Verify**: `ls config/.claude/skills/ | grep -cE '^(cloudflare|agents-sdk|wrangler|workers-best-practices|durable-objects|sandbox-sdk|cloudflare-email-service|turnstile-spin|web-perf)$'` → `0`

### Step 5: skillOverrides から 9 キーを削除する

`config/.claude/settings.json` の `skillOverrides` から Step 4 で消した 9 スキルの
キーを削除する（他のキー — `aqua-improve` / `cmux-*` / `empirical-prompt-tuning` /
`evidence-record` / `release-tweet` — は**残す**。それらは Plan 019 / 020 の担当）。

**Verify**: `jq -r '.skillOverrides | keys[]' config/.claude/settings.json | grep -cE '^(cloudflare|agents-sdk|wrangler|workers-best-practices|durable-objects|sandbox-sdk|cloudflare-email-service|turnstile-spin|web-perf)'` → `0`、かつ `jq -r '.skillOverrides | length' config/.claude/settings.json` → `9`

### Step 6: Codex 側の symlink を掃除し、全チェックを通す

```bash
bash scripts/sync-agent-skills.sh
bash scripts/check.sh
```

**Verify**: sync の stderr に `removed stale:` が 9 件（削除した 9 スキル名）。
`check.sh` が `all checks passed` で exit 0。
`ls ~/.agents/skills/ | grep -cE '^(cloudflare|agents-sdk|wrangler)'` → `0`

## Test plan

このリポジトリに単体テストは無い。検証は `bash scripts/check.sh`（nix-eval / shellcheck /
links / hooks / agent-skills）と各 Step の Verify コマンドが兼ねる。特に agent-skills
チェックが sync スクリプトの掃除ロジックを一時ディレクトリで実走する。

## Done criteria

- [ ] `bash scripts/check.sh` exit 0
- [ ] `jq . config/.claude/settings.json` exit 0
- [ ] `git ls-files config/.claude/skills/ | grep -cE '/(cloudflare|agents-sdk|wrangler|workers-best-practices|durable-objects|sandbox-sdk|cloudflare-email-service|turnstile-spin|web-perf)/'` → `0`
- [ ] `jq -r '.enabledPlugins["cloudflare@claude-plugins-official"]' config/.claude/settings.json` → `true`
- [ ] `ls ~/.agents/skills/` に削除 9 スキルの symlink が無い
- [ ] In scope 外のファイルに変更が無い（`git status`）
- [ ] `plans/README.md` の status 行を更新済み

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1 でカタログにプラグインが見つからない（この場合はローカル削除を行わず、
  代替案 = ローカル 9 スキルの `skillOverrides` を `"on"` に反転する案をユーザーに提示する）
- Step 2 で削除対象への参照が見つかった
- `skillOverrides` の現在のキー数が 18 でない（このプランの前提とドリフトしている —
  Plan 019 / 020 が先に実行された可能性がある。実行順を確認して報告）
- `sync-agent-skills.sh` が `refusing to replace non-symlink skill` で止まった
  （`~/.agents/skills/` に手動配置された実体がある — 消さずに報告）

## Maintenance notes

- プラグインの実際のロードは次回セッション起動時に行われる。executor のセッションでは
  settings.json の値までしか検証できない。**次のセッションで cloudflare スキルが
  skill 一覧に現れることを確認する**のがレビュアーの最終チェック
- Codex 側（`~/.agents/skills/`）からは Cloudflare スキルが消える。Codex でも
  必要になったら、`config/codex-cloud/skills.txt` 方式ではなくプラグイン相当の
  仕組みを Codex 側で検討する（このリポジトリに再 vendor しない）
- plans/README.md の deferred #9（skills-lock.json 同期ポリシー）のうち
  「cloudflare 系 8 スキルは lock 未登録」の追記部分は本プランで実質決着
  （プラグイン管理に移行）。README の該当行にその旨を追記する
- プラグインは `always_on` で約 2,140 トークン（opus 計測値）を毎セッション消費する。
  重いと感じたら `enabledPlugins` を false にするだけで戻せる（ローカル復元は不要）
