# Plan 013: README の構成図・管理表・初回セットアップ手順を実体に合わせる

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat e0a2d44..HEAD -- README.md`
> さらに Plan 007 / 012 の実施状況を `plans/README.md` で確認し、実施済みなら
> その変更（.wezterm.lua リンク追加、scripts/check.sh）を README に反映する内容へ
> 読み替える。未実施なら該当記述は入れない。

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 007（.wezterm.lua が配備対象になってから書くのが正確）、012（check.sh を「よくある操作」に載せるため。未実施でも本プランは実行可 — その場合該当行を省く）
- **Category**: docs
- **Planned at**: commit `e0a2d44`, 2026-07-09

## Why this matters

README の「ファイル構成」ツリーと「管理構成」表は、実際に Nix が symlink 管理している対象の約半分（`.zshenv`、`.wezterm.lua`、`.local/bin/` 2 本、`.config/zsh-abbr/`、`.takt/` 一式）を描いていない。特に `~/.takt/config.yaml` や `~/.local/bin/takt-usage-report` が repo への symlink だと README から読み取れないため、「`~/.takt` を直接編集すれば独立ファイル」と誤解して変更を失う実害につながる。また、初回セットアップの step 4（`nix run nix-darwin -- switch --flake .`）に `sudo` が無く、直後の step 5 は `sudo darwin-rebuild switch` と root を要求していて不整合 — 現行 nix-darwin の switch は root 実行を要求するため、step 4 は失敗する可能性が高い（MED confidence、実機未検証）。

## Current state

- `README.md:24` — `nix run nix-darwin -- switch --flake .`（sudo なし）
- `README.md:28` — `sudo darwin-rebuild switch --flake ~/01-dev/dotfiles`（sudo あり、不整合）
- `README.md:33-40` — 管理構成表。`home.activation` 行が「シンボリンク管理 (.zshrc, .zprofile, .claude/*)」
- `README.md:46-63` — ファイル構成ツリー。`config/` 配下は `.zshrc` / `.zprofile` / `.claude/`（内訳 5 エントリ）のみ。`docs/` は `manual-setup.md` のみ。`plans/` 無し
- 実体（`git ls-files config/ docs/ | ...` で確認できる）: `config/.zshenv`, `config/.zshrc`, `config/.zprofile`, `config/.wezterm.lua`, `config/.local/bin/{open-browser,takt-usage-report}`, `config/.config/zsh-abbr/user-abbreviations`, `config/.takt/{config.yaml,workflows/,facets/,schemas/}`, `config/.claude/{CLAUDE.md,settings.json,statusline-command.sh,hooks/,skills/,skills-lock.json}`, `docs/{manual-setup.md,takt-usage-baseline.md}`, `plans/`
- リンクの実装は `nix/packages.nix` の `home.activation.linkDotfiles`（Plan 007 適用後は `.wezterm.lua` を含む 17 リンク）。README を書く前に**必ず実物の link_force 一覧を読んで**転記すること — この plan の列挙より実物が正

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| 実体列挙 | `git ls-files config/ docs/ \| sed 's\|/[^/]*$\|/\|' \| sort -u` | ディレクトリ構成の実測 |
| リンク一覧 | `rg -n 'link_force' nix/packages.nix` | 転記元 |

## Scope

**In scope**:
- `README.md` のみ

**Out of scope**:
- `docs/manual-setup.md`（Plan 008 が vite-plus を追記済みのはず。それ以外は正確と監査済み）
- `nix/packages.nix` / `flake.nix` — README を実体に合わせる方向のみ。実体は変えない

## Git workflow

- Branch: `docs/readme-refresh`（worktree 上で作業 — repo 規約）
- Commit message 例: `docs(readme): 構成図と管理表を実体に合わせ、初回セットアップに sudo を補う`
- Push / PR 作成はユーザー指示があるまでしない

## Steps

### Step 1: step 4 に sudo を補う

`README.md:24` を `sudo nix run nix-darwin -- switch --flake .` に変更し、直後に「（現行 nix-darwin は switch に root を要求する。旧手順で sudo なしだった名残に注意）」程度の 1 行注記は**不要**（コマンドが正しければよい）。

**Verify**: `rg -n 'nix run nix-darwin' README.md` → sudo 付きの 1 件

### Step 2: 管理構成表を実体に合わせる

`README.md:38` の home.activation 行の対象を「dotfiles 一式のシンボリンク (.zsh*, .wezterm.lua, .local/bin, .config/zsh-abbr, .claude/*, .takt/*)」のように、実物の link_force 一覧と過不足なく対応する記述に更新。

**Verify**: 表の記述と `rg 'link_force' nix/packages.nix` の一覧が過不足なく対応している（手動照合）

### Step 3: ファイル構成ツリーを実体に合わせる

`README.md:46-63` のツリーを実測（上記コマンド）に基づいて書き直す。粒度の方針: `config/.claude/skills/` の中身は展開しない（39 個ある）。`.takt/` は `config.yaml` / `workflows/` / `facets/` / `schemas/` の 4 エントリまで展開。`plans/`(improve 監査の実装プラン群) と `docs/takt-usage-baseline.md`、`scripts/`（Plan 012 実施済みの場合）も追加。各エントリに現行スタイル（`# コメント`）で 1 行説明を付ける。

**Verify**: ツリーに登場する全パスが実在する（`git ls-files` と突合）。逆に、linkDotfiles が配備する対象でツリーに無いものが無い

### Step 4: よくある操作に検証コマンドを足す（012 実施済みの場合のみ）

`README.md:65-75` の表に「変更を検証（CI と同一）| `bash scripts/check.sh`」の行を追加。

**Verify**: `rg -n 'check.sh' README.md` → 1 件（012 未実施ならこの Step 自体をスキップし、報告に明記）

## Test plan

docs のみ。検証は各 Step の rg / 手動照合。最後に README 全文を通読し、今回触っていない箇所（PATH 優先順位、macOS 設定、手動設定）に stale 化した記述が無いか 1 パスだけ確認する（見つけたら**直さず**報告に列挙 — スコープ管理のため）。

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `rg -c 'sudo nix run nix-darwin' README.md` → 1
- [ ] ツリーと `git ls-files` の突合で、存在しないパスがツリーに無い
- [ ] linkDotfiles の全リンク対象がツリー or 管理表から読み取れる
- [ ] `git status` で変更が README.md のみ
- [ ] `plans/README.md` の 013 行を更新

## STOP conditions

Stop and report back (do not improvise) if:

- README の該当節が「Current state」と大きく異なる（drift — 誰かが先に直した可能性。差分を報告）。
- 実測の結果、linkDotfiles と `config/` 実体の間に**新たな**配備漏れを見つけた場合 — README で隠蔽せず、漏れとして報告（修正は 007/012 系の担当）。

## Maintenance notes

- `config/` にファイルを足したら README ツリーも更新する運用。Plan 012 の link-manifest drift チェックが「実体 vs linkDotfiles」を守るが、「実体 vs README」は守らない — README は粒度が粗い分、更新頻度は低くて済むはず。
- step 4 の sudo は実機未検証（MED confidence）。次回の新規マシンセットアップ時に実地確認し、違ったら README とこの plan の記録を直すこと。
