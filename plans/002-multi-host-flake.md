# Plan 002: flake をマルチホスト化し、マシン固有値のハードコードを排除する

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 3dbd88e..HEAD -- flake.nix nix/packages.nix config/.claude/settings.json README.md config/.claude/skills/nix/SKILL.md .github/workflows/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-ci-verification-baseline.md（flake 評価の CI ゲートがこのリファクタの安全網）
- **Category**: bug
- **Planned at**: commit `3dbd88e`, 2026-07-09

## Why this matters

このリポジトリは 2 台の Mac で使われている: **MacBook Air（hostname `mba`, user `mba`）** と **MacBook Pro（hostname `MacBook-Pro-3`, user `daikibeppu`）**。しかし flake は 1 ホストしか定義できず、commit `1e48fe0`（"MacBook Pro (daikibeppu) 向けに適応"）で全体が daikibeppu 用に書き換えられた。その結果:

1. mba 機で `darwin-rebuild switch` を実行すると、`nix/packages.nix` の `link_force` が **正常動作中の `~/.claude/*` symlink を `rm -rf` で削除し、存在しない `/Users/daikibeppu/...` へ張り替える**（mba 機の `~/.claude/CLAUDE.md` 等は現在 `/Users/mba/01-dev/dotfiles` を指す symlink として稼働中 — 2026-07-09 確認済み）。実行した瞬間に Claude Code の設定・スキル・hooks がすべて壊れる。
2. README の Quickstart（`--flake .#mba`）と nix スキルの rebuild コマンド（`#mba`）は、flake に `mba` 構成が存在しないため**今日すでに失敗するコマンド**になっている。
3. `config/.claude/settings.json` の `additionalDirectories` が `/Users/daikibeppu/...` 絶対パスで、mba 機では無効。

この plan が入ると、両マシンで同一の main ブランチから `darwin-rebuild switch` が安全に実行でき、マシンを行き来するたびにハードコードを書き換える flip-flop（git 履歴に痕跡が複数ある）が終わる。

## Current state

- `flake.nix:25-31` — ハードコードされた単一ホスト:

```nix
    let
      username = "daikibeppu";
      hostname = "MacBook-Pro-3";
      system = "aarch64-darwin";
    in
    {
      darwinConfigurations.${hostname} = nix-darwin.lib.darwinSystem {
```

- `flake.nix:46-54` — username/hostname を参照する箇所（モジュール内）:

```nix
            system.stateVersion = 5;
            system.primaryUser = username;
            networking.hostName = hostname;

            # ユーザー
            users.users.${username} = {
              name = username;
              home = "/Users/${username}";
            };
```

- `flake.nix:159-166` — home-manager 統合:

```nix
          home-manager.darwinModules.home-manager
          {
            home-manager.useGlobalPkgs = true;
            home-manager.useUserPackages = true;
            home-manager.backupFileExtension = "backup";
            home-manager.users.${username} = import ./nix/packages.nix;
          }
```

- `nix/packages.nix:3-5` — 絶対パスのハードコード:

```nix
let
  dotfilesDir = "/Users/daikibeppu/01-dev/dotfiles/config";
in
```

- `nix/packages.nix:105-114` — 破壊的な `link_force`（`rm -rf` がバックアップなしで走る）:

```nix
  home.activation.linkDotfiles = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    link_force() {
      local src="$1"
      local dst="$2"
      if [ ! -L "$dst" ] || [ "$(readlink "$dst")" != "$src" ]; then
        rm -rf "$dst"
        ln -sf "$src" "$dst"
        echo "Linked: $dst -> $src"
      fi
    }
```

- `config/.claude/settings.json:29-32` — 絶対パス:

```json
    "additionalDirectories": [
      "/Users/daikibeppu/.claude",
      "/Users/daikibeppu/01-dev/dotfiles"
    ]
```

- `README.md:24,27` — `nix run nix-darwin -- switch --flake .#mba` / `sudo darwin-rebuild switch --flake ~/01-dev/dotfiles#mba`（`mba` 構成は存在しない）
- `config/.claude/skills/nix/SKILL.md:69,76` — 同じく `~/01-dev/dotfiles#mba`
- 事実（2026-07-09 実機確認）: MacBook Air の `hostname -s` = `mba`、`scutil --get LocalHostName` = `mba`、user = `mba`。MacBook Pro 側は flake の現行値（hostname `MacBook-Pro-3`, user `daikibeppu`）を信頼する。
- リポジトリ規約: コメントは日本語、`# ── セクション名 ──` 形式の区切りコメント（`flake.nix` / `nix/packages.nix` 参照）。

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| 全ホスト列挙 | `nix eval .#darwinConfigurations --apply builtins.attrNames` | `[ "MacBook-Pro-3" "mba" ]` |
| Pro 構成の評価 | `nix eval '.#darwinConfigurations."MacBook-Pro-3".system.drvPath'` | `"/nix/store/....drv"`、exit 0 |
| Air 構成の評価 | `nix eval '.#darwinConfigurations."mba".system.drvPath'` | `"/nix/store/....drv"`、exit 0 |
| ハードコード残存確認 | `rg -n '/Users/daikibeppu' --glob '!flake.lock' --glob '!.takt/runs/**'` | マッチなし（exit 1） |
| nix フォーマット | `nix run nixpkgs#nixfmt-rfc-style -- flake.nix nix/packages.nix` | exit 0（現行コードは nixfmt 系スタイル） |

## Scope

**In scope**（変更してよいファイル）:
- `flake.nix`
- `nix/packages.nix`
- `config/.claude/settings.json`（`additionalDirectories` の 2 行のみ）
- `README.md`（rebuild コマンドと管理構成の記述）
- `config/.claude/skills/nix/SKILL.md`（`#mba` を含む rebuild コマンド 2 箇所のみ）
- `.github/workflows/ci.yml`（Plan 001 の列挙ループがそのまま両ホストを拾うことの確認のみ。変更は原則不要）

**Out of scope**（触らない）:
- `config/.claude/settings.json` の permissions / hooks / その他のキー（`additionalDirectories` 以外を変更しない）
- `home.packages` のパッケージ構成・`installTakt`（別 plan の領分）
- `config/.zshrc` 等のシェル設定（Plan 004 の領分）
- ホスト間でパッケージ構成を分岐させる仕組みの導入（現時点で両機同一構成。YAGNI）

## Git workflow

- **必ず worktree 上で作業**（`$REPO_ROOT/.worktrees/<slug>/`）
- Branch: `fix/multi-host-flake`
- Commit message 例: `fix(nix): flake をマルチホスト化し daikibeppu/mba 両対応にする`
- push / PR 作成はオペレーターの指示があるときのみ

## Steps

### Step 1: flake.nix をホスト map 駆動に書き換える

`flake.nix` の `outputs` を、ホスト定義 attrset から `darwinConfigurations` を生成する形に変更する。現在インラインで書かれている巨大モジュール（`nixpkgs.config` / `system.defaults` / `homebrew` / Touch ID 等）は**一切変更せず**、`username` / `hostname` を引数として受け取る位置に移すだけにする。目標形:

```nix
    let
      system = "aarch64-darwin";
      hosts = {
        "MacBook-Pro-3" = { username = "daikibeppu"; };
        "mba"           = { username = "mba"; };
      };
      mkDarwin =
        hostname:
        { username }:
        nix-darwin.lib.darwinSystem {
          inherit system;
          modules = [
            # （既存のインラインモジュールをそのままここへ。username/hostname は let 由来
            #   ではなく mkDarwin の引数を参照する — モジュール本文は無変更で済む）
            home-manager.darwinModules.home-manager
            {
              home-manager.useGlobalPkgs = true;
              home-manager.useUserPackages = true;
              home-manager.backupFileExtension = "backup";
              home-manager.users.${username} = import ./nix/packages.nix;
            }
          ];
        };
    in
    {
      darwinConfigurations = builtins.mapAttrs mkDarwin hosts;
    }
```

`system.stateVersion = 5` / `home.stateVersion = "24.11"` は両ホスト共通のまま変えない（stateVersion は「初回インストール時の値」であり、両機ともこのリポジトリの管理下で同時期にセットアップされている。値の変更はマイグレーション挙動を変えるので禁止）。

**Verify**: `nix eval .#darwinConfigurations --apply builtins.attrNames` → `[ "MacBook-Pro-3" "mba" ]`

### Step 2: packages.nix の絶対パスを homeDirectory 由来に置き換える

`nix/packages.nix` の関数ヘッダに `config` を追加し、`dotfilesDir` を導出値にする:

```nix
{ pkgs, lib, config, ... }:

let
  dotfilesDir = "${config.home.homeDirectory}/01-dev/dotfiles/config";
in
```

home-manager モジュール内では `config.home.homeDirectory` が `users.users.<name>.home`（= `/Users/<username>`）から解決される。他の行は変更しない。

**Verify**: `nix eval '.#darwinConfigurations."mba".system.drvPath'` → exit 0（`config` 引数の追加ミスや無限再帰があればここで落ちる）

### Step 3: link_force の `rm -rf` をバックアップ退避に変える

`nix/packages.nix` の `link_force` 内 `rm -rf "$dst"` を、既存物を退避してからリンクする形に置き換える:

```nix
    link_force() {
      local src="$1"
      local dst="$2"
      if [ ! -L "$dst" ] || [ "$(readlink "$dst")" != "$src" ]; then
        if [ -e "$dst" ] || [ -L "$dst" ]; then
          mv "$dst" "$dst.backup-before-link"
          echo "Backed up: $dst -> $dst.backup-before-link"
        fi
        ln -sf "$src" "$dst"
        echo "Linked: $dst -> $src"
      fi
    }
```

理由: 現行実装は、リンク先に実データ（例: 手動運用していた `~/.claude/skills/` 実体ディレクトリ）があっても無警告で消す。この plan の背景バグ（旧 symlink を消して無効パスへ張り替え）の被害も、この退避があれば復旧可能だった。`mv` は同名バックアップが既にあると失敗して activation が止まるが、それは「2 回目の退避で前回分を静かに上書きする」より安全side に倒れる仕様として意図的（STOP conditions 参照）。

**Verify**: `nix eval '.#darwinConfigurations."mba".system.drvPath'` → exit 0

### Step 4: settings.json の additionalDirectories を `~` ベースにする

`config/.claude/settings.json:29-32` を次に変更（このキー以外は 1 文字も変えない）:

```json
    "additionalDirectories": [
      "~/.claude",
      "~/01-dev/dotfiles"
    ]
```

Claude Code の permission パス規則は `~/path` 形式をサポートする（公式 docs で確認済み。`//path` = ファイルシステム絶対、`~/path` = ホーム相対）。

**Verify**: `jq '.permissions.additionalDirectories' config/.claude/settings.json` → `["~/.claude", "~/01-dev/dotfiles"]`、かつ `jq . config/.claude/settings.json > /dev/null` が exit 0（JSON 破壊なし）

### Step 5: README と nix スキルの rebuild コマンドをホスト非依存にする

- `README.md:24` → `nix run nix-darwin -- switch --flake .`（ホスト名が現在マシンの hostname と一致する場合、attr 指定は省略可能。darwin-rebuild は `--flake <path>` だけで `darwinConfigurations.<hostname>` を自動選択する）。省略動作に不安を残さないため、直後に「ホスト名が一致しない場合は `.#mba` / `.#MacBook-Pro-3` を明示」の 1 行を追記する。
- `README.md:27` → `sudo darwin-rebuild switch --flake ~/01-dev/dotfiles`
- `README.md` の「管理構成」節の近くに、対応ホスト一覧（`mba` = MacBook Air / user mba、`MacBook-Pro-3` = MacBook Pro / user daikibeppu）を 2 行で追記。
- `config/.claude/skills/nix/SKILL.md:69,76` の `~/01-dev/dotfiles#mba` → `~/01-dev/dotfiles`（同様に注記 1 行）。

**Verify**: `rg -n '#mba' README.md config/.claude/skills/nix/SKILL.md` → マッチなし（exit 1）

### Step 6: ハードコード残存の全数確認

**Verify 1**: `rg -n '/Users/daikibeppu' --glob '!flake.lock' --glob '!.takt/runs/**'` → マッチなし（exit 1）
**Verify 2**: `rg -n 'MacBook-Pro-3' flake.nix` → `hosts` 定義の 1 箇所のみ
**Verify 3**: `nix run nixpkgs#nixfmt-rfc-style -- --check flake.nix nix/packages.nix` → exit 0（fmt 崩れなし。失敗したら `--check` なしで整形して再確認）

## Test plan

このリポジトリに単体テストはない。検証は eval ベース:

- 両ホストの `system.drvPath` eval が exit 0（= 全モジュール評価が通る）
- CI（Plan 001 の workflow）がホスト列挙ループで両方を評価して green
- **実機適用（`darwin-rebuild switch`）はこの plan のスコープ外**。オペレーターが各マシンで実施する。executor は絶対に実行しないこと（sudo が必要で、失敗時にオペレーターのマシン状態を変える）。

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `nix eval .#darwinConfigurations --apply builtins.attrNames` → `[ "MacBook-Pro-3" "mba" ]`
- [ ] 両ホストの `nix eval '.#darwinConfigurations."<host>".system.drvPath'` が exit 0
- [ ] `rg '/Users/daikibeppu' --glob '!flake.lock' --glob '!.takt/runs/**'` がマッチなし
- [ ] `rg 'rm -rf "\$dst"' nix/packages.nix` がマッチなし
- [ ] `jq . config/.claude/settings.json` が exit 0
- [ ] `git diff --stat` の変更ファイルが In scope の 6 ファイル以内
- [ ] `plans/README.md` のステータス行を更新した

## STOP conditions

Stop and report back (do not improvise) if:

- Current state の抜粋と実コードが一致しない（drift）
- Step 2 で `config.home.homeDirectory` の参照が無限再帰エラー（`infinite recursion encountered`）を起こす — その場合は代替案（`home-manager.extraSpecialArgs` で username を渡す）があるが、設計判断なので報告して指示を待つ
- `darwin-rebuild switch --flake <path>`（attr 省略形）のホスト自動選択が nix-darwin の現行版で動かないことを示すドキュメント・挙動を発見した場合（README の書き方が変わる）
- Plan 001 の CI がまだ存在しない（依存関係違反 — 001 を先に実行すべき）
- Step 3 で activation スクリプトの他の箇所（`installTakt` 等）にも変更が必要に見えた場合（スコープ外）

## Maintenance notes

- **新しいマシンの追加**は `hosts` attrset に 1 行足すだけになる。README にその旨を書いたので、次の機種替えで flip-flop 書き換えが起きたらこの plan の意図が失われている。
- **`link_force` のバックアップ**: 初回適用時、旧環境に実体ファイルがあると `*.backup-before-link` が残る。ユーザーが確認後に手動削除する運用。2 回目以降の rebuild では dst が正しい symlink になっているので退避は発生しない。
- **レビュー注視点**: flake.nix のモジュール本体が「移動のみで無変更」であること（diff が大きく見えるが、実質差分は let 束縛と mapAttrs だけのはず）。`system.defaults` や `homebrew.casks` に意図しない差分が混ざっていないか。
- 意図的な見送り: ホストごとのパッケージ分岐、`home.stateVersion` の見直し、`darwinConfigurations` 以外の outputs（`checks` 等）の追加。
