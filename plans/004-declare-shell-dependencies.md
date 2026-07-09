# Plan 004: .zshrc の未宣言依存（oh-my-zsh / zsh-abbr）を宣言し、stale な proto 手順を除去する

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 3dbd88e..HEAD -- config/.zshrc nix/packages.nix README.md docs/manual-setup.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/002-multi-host-flake.md（`nix/packages.nix` を両 plan が触るため、コンフリクト回避で 002 を先に）
- **Category**: bug
- **Planned at**: commit `3dbd88e`, 2026-07-09

## Why this matters

このリポジトリの存在意義は「新しい Mac を宣言的にセットアップできること」（README 冒頭）。しかし `.zshrc` は 2 つの未宣言依存を無条件 source しており、README 手順どおりにセットアップした新品マシンでは**インタラクティブシェルの起動が毎回エラーを吐く**: ① oh-my-zsh（どこからもインストールされず、manual-setup.md にも記載なし）② zsh-abbr（`/opt/homebrew/share/...` を source するが flake の `brews` に無い。現在のマシンでは過去の手動 `brew install` の残骸で動いているだけ — 2026-07-09 確認済み）。さらに README と manual-setup.md は **proto で Node.js を入れる手順**を案内するが、proto はどこからもインストールされず（flake の brews は `ni` と `turso` のみ）、しかも Nix が `nodejs_22` を提供済みなので手順自体が stale。

## Current state

- `config/.zshrc:4-13` — oh-my-zsh を無条件 source:

```zsh
# Oh My Zsh installation
export ZSH="$HOME/.oh-my-zsh"

# Theme
ZSH_THEME="eastwood"

# Plugins
plugins=(git)

source $ZSH/oh-my-zsh.sh
```

- `config/.zshrc:15-16` — zsh-abbr を Homebrew 固定パスで無条件 source:

```zsh
# zsh-abbr
source /opt/homebrew/share/zsh-abbr/zsh-abbr.zsh
```

- `flake.nix:121-124` — brews に zsh-abbr は無い:

```nix
              brews = [
                "ni"
                "tursodatabase/tap/turso"
              ];
```

- `nix/packages.nix:9-25` — `home.packages` の CLI ツール群（アルファベット順。ここに `zsh-abbr` を追加する）。nixpkgs には `zsh-abbr` パッケージが存在する。
- `README.md:38` — 「| **Homebrew (brews)** | nixpkgs にないツール (ni, proto, turso) |」← proto は実際には brews に無い
- `docs/manual-setup.md:20-28` — 「## 3. proto で Node.js をインストール」節（`proto install node lts` 等）← proto はどこからもインストールされない。Node.js は `nix/packages.nix:10` の `nodejs_22` が提供済み
- リポジトリ方針（README「管理構成」表）: nixpkgs にあるものは Nix で、無いものだけ Homebrew で管理する。zsh-abbr は nixpkgs にあるので **Nix 管理を選ぶ**。
- home-manager は `useUserPackages = true`（`flake.nix:163`）なので、home.packages の share ファイルは `/etc/profiles/per-user/$USER/share/` 配下に現れる。

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| zsh-abbr が nixpkgs にあり share パスを持つ確認 | `nix build nixpkgs#zsh-abbr --no-link --print-out-paths` → `ls "$(nix build nixpkgs#zsh-abbr --no-link --print-out-paths)/share/zsh-abbr/"` | `zsh-abbr.zsh` が一覧に含まれる |
| flake 評価 | `nix eval '.#darwinConfigurations."mba".system.drvPath'`（002 未実施なら `"MacBook-Pro-3"`） | exit 0 |
| zshrc 構文検査 | `zsh -n config/.zshrc` | 出力なし、exit 0 |

## Scope

**In scope**（変更してよいファイル）:
- `config/.zshrc`
- `nix/packages.nix`（`home.packages` への 1 パッケージ追加のみ）
- `README.md`（brews の記述 1 箇所）
- `docs/manual-setup.md`

**Out of scope**（触らない）:
- oh-my-zsh の廃止や home-manager `programs.zsh` への移行 — このリポジトリは「実ファイル + activation symlink」方式（`nix/packages.nix:101-104` のコメント参照）を意図的に選んでおり、`programs.zsh` は home-manager が .zshrc を生成する方式なので設計衝突する。今回はガード＋手順書化に留める
- `flake.nix` の brews / casks（zsh-abbr は Nix 管理を選ぶため変更不要）
- `.zshrc` のその他の行（PATH 重複等の小さな匂いはあるが別件）

## Git workflow

- **必ず worktree 上で作業**（`$REPO_ROOT/.worktrees/<slug>/`）
- Branch: `fix/declare-shell-deps`
- Commit message 例: `fix(zsh): zsh-abbr を Nix 管理に追加し oh-my-zsh 依存をガード、stale な proto 手順を削除`
- push / PR 作成はオペレーターの指示があるときのみ

## Steps

### Step 1: zsh-abbr を Nix 管理に追加する

`nix/packages.nix` の `home.packages` リスト（アルファベット順を維持、`uv` の後）に `zsh-abbr` を追加。

**Verify**: `nix eval '.#darwinConfigurations."mba".system.drvPath'` → exit 0（Plan 002 未実施の環境では `"MacBook-Pro-3"` で代替）

### Step 2: .zshrc の zsh-abbr source をパス探索＋ガード付きにする

`config/.zshrc:15-16` を次に置き換える（Nix パス優先、旧 Homebrew パスをフォールバックに残す — 次回 rebuild 前のマシンでも壊れないため）:

```zsh
# zsh-abbr（Nix 管理。旧 brew 環境のパスはフォールバック）
for _abbr in "/etc/profiles/per-user/$USER/share/zsh-abbr/zsh-abbr.zsh" \
             "/opt/homebrew/share/zsh-abbr/zsh-abbr.zsh"; do
  if [ -f "$_abbr" ]; then
    source "$_abbr"
    break
  fi
done
unset _abbr
```

直後の `ABBR_REGULAR_ABBREVIATION_GLOB_PREFIXES` ブロック（`.zshrc:18-25`）は変更しない。

**Verify**: `zsh -n config/.zshrc` → exit 0

### Step 3: oh-my-zsh の source をガード付きにする

`config/.zshrc:13` の `source $ZSH/oh-my-zsh.sh` を次に置き換える:

```zsh
if [ -f "$ZSH/oh-my-zsh.sh" ]; then
  source "$ZSH/oh-my-zsh.sh"
else
  echo "warning: oh-my-zsh 未インストール（docs/manual-setup.md 参照）" >&2
fi
```

無警告 skip にしない理由: テーマ・git plugin が静かに消えるより、1 行の警告で手順書へ誘導する方がセットアップ漏れに気づける。

**Verify**: `zsh -n config/.zshrc` → exit 0

### Step 4: manual-setup.md に oh-my-zsh 手順を追加し、proto 節を削除する

- `docs/manual-setup.md:20-28` の「## 3. proto で Node.js をインストール」節を丸ごと削除（Node.js は Nix の `nodejs_22` が提供。proto はどこからもインストールされない）
- 同じ位置に新しい節を追加:

```markdown
## 3. oh-my-zsh のインストール

`.zshrc` がテーマ（eastwood）と git plugin に使用。未インストールだとシェル起動時に警告が出る。

​```bash
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended --keep-zshrc
​```

`--keep-zshrc` 必須（インストーラに dotfiles 管理の .zshrc を上書きさせない）。
```

- 後続節の番号を整合させる（現在の「## 4. アプリの初期設定」はそのまま 4 で維持できる）

**Verify**: `rg -n 'proto' docs/manual-setup.md` → マッチなし（exit 1）。`rg -n 'keep-zshrc' docs/manual-setup.md` → 1 件

### Step 5: README の brews 記述から proto を外す

`README.md:38` の「(ni, proto, turso)」→「(ni, turso)」。

**Verify**: `rg -n 'proto' README.md` → ヒットは `--proto '=https'`（curl フラグ、`README.md:13`）のみ

## Test plan

- 静的検証: `zsh -n config/.zshrc`（構文）+ flake 評価（Step 1）
- 挙動検証（このマシンで安全に実行可能）: `zsh -ic 'echo ok'` を実行し、exit 0 で `ok` が出力され、エラー行が出ないこと（現行マシンは oh-my-zsh / brew 版 zsh-abbr が存在するので green になるはず）
- 新品マシン相当の検証は実施不能（オペレーターの次回セットアップ時に確認）。その旨を完了報告に明記すること

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `rg 'zsh-abbr' nix/packages.nix` が 1 件以上（home.packages 内）
- [ ] `zsh -n config/.zshrc` が exit 0
- [ ] `rg -n 'source /opt/homebrew/share/zsh-abbr' config/.zshrc` がマッチなし（無条件 source の消滅）
- [ ] `rg -n 'proto' docs/manual-setup.md` がマッチなし
- [ ] flake 評価（Commands 表）が exit 0
- [ ] `git status` で in-scope 4 ファイル以外に変更がない
- [ ] `plans/README.md` のステータス行を更新した

## STOP conditions

Stop and report back (do not improvise) if:

- `nix build nixpkgs#zsh-abbr` の出力に `share/zsh-abbr/zsh-abbr.zsh` が無い（Step 2 の Nix パスが成立しない — brews 方式への切替は設計判断なので報告）
- `nix/packages.nix` が Current state の抜粋から大きく変わっている（Plan 002 実施後は `dotfilesDir` が `config.home.homeDirectory` 由来になっているのは想定内。それ以外の構造変化は STOP）
- `zsh -ic 'echo ok'` が現行マシンでエラーを出す（既存環境を壊した可能性）

## Maintenance notes

- **oh-my-zsh は依然として命令的インストール**。将来 zsh 設定を home-manager `programs.zsh` に全面移行するなら oh-my-zsh モジュールで宣言化できるが、「実ファイル symlink」方式の放棄とセットの大判断（Out of scope に記載の理由）。
- Step 2 のフォールバックパス（`/opt/homebrew/...`）は、全マシンが rebuild 済みになったら削除してよい（1 行掃除）。
- レビュー注視点: `.zshrc` は login/interactive で毎回走るファイル。Step 2/3 のガードが誤って abbr 機能そのものを無効化していないか（rebuild 済みマシンで `abbr` コマンドが使えることを確認）。
