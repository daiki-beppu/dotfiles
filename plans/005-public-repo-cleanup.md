# Plan 005: 公開リポジトリから事故コミット（takt 実行痕跡・一時ファイル・迷子の .config）を除去する

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 3dbd88e..HEAD -- .takt/ .config/ zsh-abbr/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/003-takt-skill-contract-fixes.md（003 が `.takt/runs/.../architect-review.md` を物証として参照するため、削除はその後）
- **Category**: tech-debt
- **Planned at**: commit `3dbd88e`, 2026-07-09

## Why this matters

このリポジトリは PUBLIC（`gh repo view daiki-beppu/dotfiles` → `"visibility":"PUBLIC"`、2026-07-09 確認済み）。現在 3 種類の事故コミットが追跡されている: ① `.takt/runs/` の AI 実行痕跡 36 ファイル（`.takt/.gitignore` の `*` で ignore 対象と `git check-ignore` で確認済み＝過去に force add されたもの。issue #23 実装時の AI の内部レビュー・思考ログが公開されている）② zsh-abbr の一時ファイル `zsh-abbr/--32938E34-AA43-47AA-B499-691DE0A180D3`（中身は `import_aliases` 1 行のみ）③ リポジトリ直下の `.config/`（gh / ghostty / git の設定コピー。`nix/packages.nix` の link_force はこれらを一切参照せず、README のファイル構成図にも無い迷子ファイル。実体は各マシンの `~/.config/` にある）。機密は含まれない（`.config/gh/hosts.yml` にトークン無しを確認済み）が、公開リポジトリのノイズであり、「`config/` 配下が管理対象」という規約を自ら破っている。

## Current state

- 追跡ファイル総数: 526（`git ls-files | wc -l`）。うち `.takt/runs/` 配下が 36。
- `.takt/.gitignore:1-2` — `*` で全 ignore + ホワイトリスト方式（`!config.yaml`, `!workflows/`, `!facets/` 等）。`runs/` はホワイトリストに無い:

```
# Ignore everything by default
*
```

- `git check-ignore -v .takt/runs/<新規ファイル>` → `.takt/.gitignore:2:*` にマッチ（2026-07-09 実測）。つまり追跡中の 36 ファイルは ignore ルールに逆らって add されたもの。
- `zsh-abbr/--32938E34-AA43-47AA-B499-691DE0A180D3` — リポジトリ直下。中身は `import_aliases` の 1 行。zsh-abbr が生成した一時ファイルの誤コミット。`zsh-abbr/` ディレクトリにはこの 1 ファイルしかない。
- リポジトリ直下の `.config/`（追跡中の 4 ファイル）:
  - `.config/gh/config.yml` — gh の設定（git_protocol 等）
  - `.config/gh/hosts.yml` — キーは `git_protocol` / `user` / `users` のみ。**トークンは含まれない**（確認済み）
  - `.config/ghostty/config` — Ghostty の設定。Ghostty は flake の casks に無く、リポジトリの何もこのファイルを参照しない
  - `.config/git/ignore` — git の global ignore 候補だが、git 設定は `nix/packages.nix` の `programs.git.ignores` が正式な管理場所（重複管理）
- 正式に管理されている dotfiles はすべて `config/` 配下（`nix/packages.nix:116-142` の link_force 一覧が正）。

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| 追跡解除（履歴は残す） | `git rm -r --cached .takt/runs/` | 36 ファイルが index から消える |
| ファイルごと削除 | `git rm -r .config/ zsh-abbr/` | working tree からも消える |
| 追跡状態の確認 | `git ls-files .takt/runs/ .config/ zsh-abbr/` | 出力なし |
| flake 健全性 | `nix eval .#darwinConfigurations --apply builtins.attrNames` | ホスト名リスト、exit 0 |

## Scope

**In scope**:
- `.takt/runs/` 配下 36 ファイルの**追跡解除**（`--cached`。ローカルの実行痕跡はマシン上に残してよい — takt の運用データのため）
- `zsh-abbr/--32938E34-AA43-47AA-B499-691DE0A180D3` の削除（ディレクトリごと）
- リポジトリ直下 `.config/` の削除（4 ファイル。実体は各マシンの `~/.config/` にあり、これはただのコピー）
- `.gitignore`（ルート）への追記は**不要**（`.takt/.gitignore` の `*` が既に効く。`zsh-abbr/` と `.config/` は再発生源が不明なので、まず消して様子を見る）

**Out of scope**（触らない）:
- `.takt/config.yaml` / `.takt/.gitignore` — 正しい管理対象
- `config/` 配下のすべて — 正式な管理領域
- git 履歴の書き換え（`filter-branch` / `filter-repo`）— 機密が無いことを確認済みなので不要。履歴に残るのは許容
- gh / ghostty 設定を `config/` 配下で正式管理化する作業 — 別判断（Maintenance notes 参照）

## Git workflow

- **必ず worktree 上で作業**（`$REPO_ROOT/.worktrees/<slug>/`）
- Branch: `chore/public-repo-cleanup`
- Commit message 例: `chore: 誤コミットされた takt 実行痕跡・一時ファイル・迷子の .config を除去`
- push / PR 作成はオペレーターの指示があるときのみ

## Steps

### Step 1: 削除対象に想定外の中身がないか最終確認する

- `cat .config/gh/hosts.yml` を目視し、キーが `git_protocol` / `user` / `users` 系のみであること（`oauth_token` が現れたら STOP — 削除だけでは足りずローテーションが必要になる）
- `diff -r .config/gh ~/.config/gh` を実行し、リポジトリ側が古いコピーであることを確認（実体側に無い設定がリポジトリ側にだけある場合は STOP）

**Verify**: 上記 2 確認の結果を作業ログに記録した

### Step 2: takt 実行痕跡を追跡解除する

```bash
git rm -r --cached .takt/runs/
```

`--cached` であること（working tree のログは消さない）。

**Verify**: `git ls-files .takt/runs/` → 出力なし。`ls .takt/runs/` → ディレクトリは残っている

### Step 3: 一時ファイルと迷子の .config を削除する

```bash
git rm -r zsh-abbr/ .config/
```

**Verify**: `git ls-files zsh-abbr/ .config/` → 出力なし。`git status` に削除がステージされている

### Step 4: 再発防止の確認

- `git check-ignore .takt/runs/dummy-probe` 用に `touch .takt/runs/dummy-probe && git check-ignore -v .takt/runs/dummy-probe && rm .takt/runs/dummy-probe` → `.takt/.gitignore:2:*` にマッチ（将来 `git add .` しても runs/ が入らないこと）

**Verify**: check-ignore がマッチを出力し exit 0

## Test plan

- `git ls-files | wc -l` が 526 − 36 − 1 − 4 = **485** になる
- `nix eval .#darwinConfigurations --apply builtins.attrNames` → exit 0（削除が Nix 評価に影響しないこと。`.config/` は flake から参照されていないので影響ゼロのはず）
- Plan 001 実施済みなら shellcheck ジョブのコマンドも再実行して green

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `git ls-files .takt/runs/ .config/ zsh-abbr/` が出力なし
- [ ] `git ls-files | wc -l` → 485（drift check で開始時 526 を確認した場合）
- [ ] `ls .takt/runs/` でローカルの実行痕跡が残っている（`--cached` 削除の確認）
- [ ] flake 評価が exit 0
- [ ] `plans/README.md` のステータス行を更新した

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1 で `.config/gh/hosts.yml` に `oauth_token` などの credential キーが現れた（この plan 作成時には無かった。あれば**削除ではなくローテーションが最優先** — 値は報告に書かないこと）
- Step 1 の diff で、リポジトリ側 `.config/` に実体（`~/.config/`）より新しい・実体に無い設定が見つかった（誰かが意図的にここで編集していた可能性 — 消すと作業が失われる）
- `.takt/runs/` 配下に 36 以外のファイル数が見える（新しい run が積まれた等。追跡解除の対象を確認し直す）
- Plan 003 が未完了（`rg 'architecture-review\.md' config/.claude/skills/` がまだヒットする）— 003 の物証を先に消さない

## Maintenance notes

- **gh / ghostty を正式管理したくなったら**: `config/.config/gh/` 等に実体を置き、`nix/packages.nix` の link_force に追加するのが規約（`config/.config/zsh-abbr/user-abbreviations` が先例）。ただし gh の `hosts.yml` は gh が実行時にトークンを書き込むファイルなので**リンク管理してはいけない**（公開リポジトリに機密が流れる）。管理するなら `config.yml` のみ。
- `zsh-abbr/--<UUID>` 形式の一時ファイルが再び現れたら、zsh-abbr がカレントディレクトリに一時ファイルを吐くバグ/挙動が原因。ルート `.gitignore` に `zsh-abbr/` を足すより発生源を特定する方がよい。
- レビュー注視点: `git rm -r --cached` と `git rm -r` の使い分けが逆になっていないか（runs はローカル保持、他は完全削除）。
