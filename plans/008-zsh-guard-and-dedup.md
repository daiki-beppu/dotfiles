# Plan 008: .zshenv/.zshrc の無ガード source と重複を解消する

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat e0a2d44..HEAD -- config/.zshenv config/.zshrc docs/manual-setup.md`
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

`config/.zshenv` は `~/.vite-plus/env` を存在チェックなしで source する。`.zshenv` は**非対話含む全 zsh 起動**で読まれるため、vite-plus 未インストールの新規マシン（README クイックスタート直後の状態）ではあらゆる `zsh -c` 呼び出しの stderr にエラーが乗る。しかも `.zshrc:80` が同じファイルを再度無ガードで source し、`.zshrc:81` は 2 行目で済んでいる `~/.local/bin` の PATH 追記を重複させている。過去に PR #65 がガードを追加したが commit `27f1e3e` の全体 revert で消えた（今回が再修正）。同じ `.zshrc` 内の precmd には、`print -Pn` がディレクトリ/ブランチ名中の `%` をプロンプト展開してタブタイトルを崩す小バグもあり、同時に直す。

## Current state

- `config/.zshenv` — 全 zsh 起動で読まれる。全 5 行:

```zsh
# Vite+ bin (https://viteplus.dev)
. "$HOME/.vite-plus/env"

# Bun global packages (bun add -g <pkg>)
export PATH="$HOME/.bun/bin:$PATH"
```

- `config/.zshrc:1-2` — 先頭で PATH 設定済み:

```zsh
# PATH configuration
export PATH=$HOME/bin:$HOME/.local/bin:/usr/local/bin:$PATH
```

- `config/.zshrc:39-52` — precmd（抜粋）。`print -Pn` が問題:

```zsh
  if [[ -n "$branch" ]]; then
    print -Pn "\e]2;[${branch}][${dir}]\a"
  else
    print -Pn "\e]2;[${dir}]\a"
  fi
```

- `config/.zshrc:79-81` — 重複ブロック:

```zsh
# Vite+ bin (https://viteplus.dev)
. "$HOME/.vite-plus/env"
export PATH="$HOME/.local/bin:$PATH"
```

- repo 規約: 同じ `.zshrc` 内の oh-my-zsh（13 行目）と zsh-abbr（22 行目）は `[ -f ... ]` ガード済み。これが exemplar。
- `docs/manual-setup.md` — Nix 管理外の手動セットアップ手順集。vite-plus のインストール手順は現在記載なし。

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| zsh 構文チェック | `zsh -n config/.zshenv && zsh -n config/.zshrc` | exit 0、出力なし |
| クリーン環境での起動テスト | 下記 Step 2 の Verify | stderr が空 |

## Scope

**In scope**:
- `config/.zshenv`
- `config/.zshrc`
- `docs/manual-setup.md`（vite-plus 手順の追記のみ）

**Out of scope**:
- `config/.zprofile` — PATH の根本設計には触れない
- `.zshrc` の NPM_TOKEN / open-browser / abbr 設定 — 動作確認済みの領域
- oh-my-zsh / zsh-abbr のガード — 既に正しい

## Git workflow

- Branch: `fix/zsh-guard-and-dedup`（worktree 上で作業 — repo 規約）
- Commit message 例: `fix(zsh): vite-plus env の source をガードし重複定義を除去`
- Push / PR 作成はユーザー指示があるまでしない

## Steps

### Step 1: .zshenv の source をガードする

`config/.zshenv` の 2 行目を次に置き換える:

```zsh
[ -f "$HOME/.vite-plus/env" ] && . "$HOME/.vite-plus/env"
```

**Verify**: `zsh -n config/.zshenv` → exit 0

### Step 2: .zshrc の重複ブロックを削除する

`config/.zshrc:79-81` の 3 行（`# Vite+ bin` コメント、source、PATH 追記）を**丸ごと削除**する。vite-plus env は Step 1 の `.zshenv` 側だけで読み込む（非対話シェルにも効く方を残す）。`~/.local/bin` の PATH は 2 行目で既に設定済み。

**Verify**（vite-plus が無い環境をエミュレート）:

```bash
tmp=$(mktemp -d)
HOME="$tmp" zsh -c 'source config/.zshenv' 2>"$tmp/err"
cat "$tmp/err"
```

→ `.vite-plus` 関連のエラーが出力されない（oh-my-zsh 警告は `.zshrc` 側なのでここでは出ない）

### Step 3: precmd の % 展開バグを直す

`config/.zshrc` の precmd 内 2 箇所の `print -Pn` を `print -n` に変える（文字列に意図的なプロンプト展開シーケンスは無く、`\e`/`\a` は `print` のデフォルトのバックスラッシュ展開で処理される）。

**Verify**:

```bash
zsh -f -c 'dir="~/100%done"; print -n "\e]2;[$dir]\a"' | cat -v
```

→ 出力に `100%done` が**そのまま**含まれる（`-P` だと `%d` が展開されて崩れる）

### Step 4: manual-setup.md に vite-plus の手動手順を追記する

`docs/manual-setup.md` の既存セクション構成に合わせて（既存の見出しレベル・文体を確認して合わせること）、vite-plus のセクションを追加する。内容: Nix 管理外であること、公式手順（https://viteplus.dev）でインストールすると `~/.vite-plus/env` が生成され `.zshenv` が自動で読み込むこと、未インストールでもシェルはエラーなく動くこと。

**Verify**: `rg -n "vite-plus" docs/manual-setup.md` → 1 件以上ヒット

## Test plan

- Step 2 のクリーン HOME テストが回帰テスト（このプランが直すバグそのもの）。
- Step 3 の `%` を含むパスのタイトル出力テスト。
- 追加の恒久テストは書かない（シェル設定にテスト基盤なし。CI の shellcheck は zsh ファイルを対象外としており、それは正しい）。

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `zsh -n config/.zshenv && zsh -n config/.zshrc` が exit 0
- [ ] `rg -c 'vite-plus' config/.zshrc` → 0（.zshrc から完全に消えている）
- [ ] `rg -c '\[ -f "\$HOME/.vite-plus/env" \]' config/.zshenv` → 1
- [ ] `rg -c 'print -Pn' config/.zshrc` → 0
- [ ] Step 2 のクリーン HOME テストで vite-plus エラーなし
- [ ] `git status` で変更が in-scope の 3 ファイルのみ
- [ ] `plans/README.md` の 008 行を更新

## STOP conditions

Stop and report back (do not improvise) if:

- 「Current state」の抜粋が実ファイルと一致しない（drift）。
- `~/.vite-plus/env` の中身を調べた結果、`.zshenv` より後（.zshrc 相当のタイミング）での読み込みが機能上必須と判明した場合 — その場合は削除ではなくガード付きで残す判断が要る。
- precmd の変更で WezTerm タブタイトルの `\e]2;` シーケンス自体が機能しなくなった場合。

## Maintenance notes

- 今後 `.zshenv`/`.zshrc` に外部ツールの env を source する行を足すときは、必ず `[ -f ... ] &&` ガードを付ける（oh-my-zsh / zsh-abbr / vite-plus が exemplar）。
- PR #65 → revert `27f1e3e` で一度消えた修正の再実装。revert 由来の消失は `.wezterm.lua`（Plan 007）と同根なので、レビュー時は「#65 が入れた他の変更で必要なものが残っていないか」も一瞥する価値がある。
