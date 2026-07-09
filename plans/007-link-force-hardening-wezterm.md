# Plan 007: linkDotfiles を堅牢化し .wezterm.lua を Nix 配備する

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat e0a2d44..HEAD -- nix/packages.nix`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `e0a2d44`, 2026-07-09

## Why this matters

`home.activation.linkDotfiles`（`nix/packages.nix`）はこの repo の**唯一の**デプロイ機構だが、3 つの欠陥がある: (1) `config/.wezterm.lua` がリンク一覧に無く、WezTerm cask（`flake.nix:158`）は入るのに設定が配備されない — 現行機で動いているのは 2025-12 に手作業で張られた `~/.wezterm.lua → ~/.dotfiles/config/.wezterm.lua` という symlink のおかげで、`~/.dotfiles` 自体も Nix 管理外。過去に PR #65 がリンクを追加したが commit `27f1e3e` の全体 revert で消えた。(2) バックアップ先 `$dst.backup-before-link` が既に存在する場合、`mv` が既存バックアップを黙って上書き（ファイル同士）するか、ディレクトリ内に入れ子移動する（ディレクトリ同士）— 最悪、退避済みのユーザーファイルを破壊するか activation が途中で失敗する。(3) リンク元 `$src` の存在を検証せず、typo やファイル移動時に dangling symlink を「Linked:」の成功メッセージ付きで作る。

## Current state

- `nix/packages.nix` — Home Manager 設定。`home.activation.linkDotfiles`（102〜146 行）が対象。
- `flake.nix:158` — `"wezterm"` cask を宣言（アプリ本体はインストールされる）。
- `config/.wezterm.lua` — 3.3KB の WezTerm 設定。git 管理されているがどこからもリンクされない。

`nix/packages.nix:102-119` の現状（抜粋）:

```nix
  home.activation.linkDotfiles = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
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

    # dotfiles
    link_force "${dotfilesDir}/.zshenv" "$HOME/.zshenv"
    link_force "${dotfilesDir}/.zshrc" "$HOME/.zshrc"
    link_force "${dotfilesDir}/.zprofile" "$HOME/.zprofile"
```

リンク一覧は 117〜145 行に続く（`.local/bin` 2 本、zsh-abbr、`.claude/*` 5 本、`.takt/*` 4 本）。

**Nix 文字列の注意（重要）**: この activation script は Nix の `''...''` インデント文字列の中にある。`${dotfilesDir}` は **Nix の**補間。シェル変数は必ず `$var` か `"$var"` と書き、`${var}` 形式を使う場合は `''${var}` とエスケープしないと Nix が補間しようとして eval が壊れる。既存コードの流儀（`$src`, `$dst`, `$(readlink ...)`）に合わせること。

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Nix eval (host mba) | `nix eval '.#darwinConfigurations."mba".system.drvPath'` | derivation path が表示され exit 0 |
| Nix eval (host MacBook-Pro-3) | `nix eval '.#darwinConfigurations."MacBook-Pro-3".system.drvPath'` | 同上 |

## Scope

**In scope**（変更してよいのはこれだけ）:
- `nix/packages.nix`（`home.activation.linkDotfiles` ブロックのみ）

**Out of scope**（触らない）:
- `flake.nix` — cask 一覧・unfree predicate は別プラン（014）の担当
- `config/.wezterm.lua` の内容
- `home.activation.installTakt`（takt@latest 問題は既知の deferred 事項）
- 実機への `darwin-rebuild switch` 適用 — eval 検証まで。実適用はユーザーが行う

## Git workflow

- Branch: `fix/link-force-hardening`（main から分岐、worktree 上で作業 — repo 規約）
- Commit message style: conventional commits 日本語（例: `fix(nix): link_force のバックアップ衝突を解消し .wezterm.lua を配備対象に追加`）
- Push / PR 作成はユーザー指示があるまでしない

## Steps

### Step 1: link_force を堅牢化する

`nix/packages.nix` の `link_force` 関数を以下の形に置き換える:

```bash
    MISSING_SOURCES=""
    link_force() {
      local src="$1"
      local dst="$2"
      if [ ! -e "$src" ]; then
        echo "ERROR: link source missing: $src" >&2
        MISSING_SOURCES="$MISSING_SOURCES $src"
        return 0
      fi
      if [ ! -L "$dst" ] || [ "$(readlink "$dst")" != "$src" ]; then
        if [ -e "$dst" ] || [ -L "$dst" ]; then
          local backup="$dst.backup-before-link"
          if [ -e "$backup" ] || [ -L "$backup" ]; then
            backup="$backup.$(date +%s)"
          fi
          mv "$dst" "$backup"
          echo "Backed up: $dst -> $backup"
        fi
        ln -sf "$src" "$dst"
        echo "Linked: $dst -> $src"
      fi
    }
```

さらに、リンク一覧の**最後**（`link_force "${dotfilesDir}/.takt/schemas" ...` の直後）に集約チェックを追加:

```bash
    if [ -n "$MISSING_SOURCES" ]; then
      echo "ERROR: linkDotfiles aborted: missing sources:$MISSING_SOURCES" >&2
      exit 1
    fi
```

設計意図: source 欠落は**全リンク処理後**にまとめて失敗させる（1 件目で即死すると他のリンク状態が中途半端になり、エラーも 1 件しか見えない）。バックアップ衝突は epoch サフィックスで一意化し、既存バックアップを決して上書きしない。

**Verify**: `nix eval '.#darwinConfigurations."mba".system.drvPath'` → exit 0

### Step 2: .wezterm.lua のリンクを追加する

`link_force "${dotfilesDir}/.zprofile" "$HOME/.zprofile"` の直後に 1 行追加:

```bash
    link_force "${dotfilesDir}/.wezterm.lua" "$HOME/.wezterm.lua"
```

（既存の手動 symlink `~/.wezterm.lua → ~/.dotfiles/config/...` は次回 switch 時に `link_force` が backup へ退避して張り替える。これは設計どおりの挙動。）

**Verify**: `rg -n 'wezterm' nix/packages.nix` → 追加した 1 行がヒットする

### Step 3: シェルロジックをシナリオテストする

Nix 文字列から関数ロジックを抜き出したテストスクリプトをスクラッチ領域（repo 外、例: `mktemp -d`）に作り、5 シナリオを検証する。テストスクリプトでは `${dotfilesDir}` 部分は使わないので、Step 1 の bash コードをそのまま貼れる:

```bash
#!/bin/bash
set -u
t=$(mktemp -d)
mkdir -p "$t/src" "$t/home"
echo real > "$t/src/file"

# --- ここに Step 1 の MISSING_SOURCES="" と link_force 定義を貼る ---

# 1. 新規リンク
link_force "$t/src/file" "$t/home/file"
[ "$(readlink "$t/home/file")" = "$t/src/file" ] && echo "PASS 1"
# 2. 冪等（2回目は何もしない）
out=$(link_force "$t/src/file" "$t/home/file")
[ -z "$out" ] && echo "PASS 2"
# 3. 既存ファイルの退避
rm "$t/home/file"; echo old > "$t/home/file"
link_force "$t/src/file" "$t/home/file"
[ "$(cat "$t/home/file.backup-before-link")" = "old" ] && echo "PASS 3"
# 4. バックアップ衝突 → 一意名で退避、既存バックアップは無傷
rm "$t/home/file"; echo old2 > "$t/home/file"
link_force "$t/src/file" "$t/home/file"
[ "$(cat "$t/home/file.backup-before-link")" = "old" ] && \
  ls "$t/home/file.backup-before-link."* >/dev/null && echo "PASS 4"
# 5. source 欠落 → リンクせず MISSING_SOURCES に記録
link_force "$t/src/nonexistent" "$t/home/ghost" 2>/dev/null
[ ! -L "$t/home/ghost" ] && [ -n "$MISSING_SOURCES" ] && echo "PASS 5"
```

**Verify**: `bash <テストスクリプト>` → `PASS 1` 〜 `PASS 5` が全て出力される

### Step 4: 両ホストの eval を最終確認する

**Verify**: 両ホストの `nix eval '.#darwinConfigurations."<host>".system.drvPath'` → いずれも exit 0

## Test plan

Step 3 のシナリオスクリプトがテスト本体（新規リンク / 冪等 / 退避 / 衝突 / source 欠落）。repo にテスト基盤は無いため、スクリプトは scratch 領域で実行し **repo にはコミットしない**（Plan 012 が CI 基盤を整えた後に恒久化を検討）。

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `nix eval '.#darwinConfigurations."mba".system.drvPath'` が exit 0
- [ ] `nix eval '.#darwinConfigurations."MacBook-Pro-3".system.drvPath'` が exit 0
- [ ] `rg -c 'wezterm' nix/packages.nix` → 1 以上
- [ ] `rg -c 'MISSING_SOURCES' nix/packages.nix` → 4（初期化・記録・集約チェックの条件・エラーメッセージ）
- [ ] シナリオテスト PASS 1〜5
- [ ] `git status` で変更が `nix/packages.nix` のみ
- [ ] `plans/README.md` の 007 行を更新

## STOP conditions

Stop and report back (do not improvise) if:

- `nix/packages.nix:102-146` が「Current state」の抜粋と一致しない（drift）。
- Step 1 の後で `nix eval` が失敗し、原因が Nix 文字列エスケープ（`''${` 関連）以外に見える場合。
- シナリオテストの PASS 4（衝突時の一意名退避）が 2 回の修正で通らない場合。
- `home-manager.backupFileExtension`（`flake.nix:170`）との相互作用を変更する必要が出た場合 — それはこのプランの想定外。

## Maintenance notes

- 今後 `config/` 直下にファイルを足すときは linkDotfiles への追記を忘れないこと。この「一覧の手動管理」自体の恒久対策（manifest drift チェック）は Plan 012 の check スクリプトに同居させる想定。
- レビュー時の注目点: Nix `''...''` 文字列内のシェル変数エスケープ（`''${` の要否）と、`exit 1` が Home Manager activation を意図どおり失敗させること。
- 実機適用（`sudo darwin-rebuild switch`）はユーザーの次回 rebuild に委ねる。適用後、`~/.wezterm.lua` が repo 直リンクに張り替わり、旧手動リンクが backup に退避されているはず。
