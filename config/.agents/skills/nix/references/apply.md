# 適用

編集した flake を適用するときに読む。`NH_FLAKE` やメインチェックアウトの暗黙指定では今回の worktree の編集を適用できない場合がある。


パッケージの追加・削除・変更後は以下を実行して反映する:

```bash
sudo darwin-rebuild switch --flake "<編集した worktree の絶対パス>"
```

**注意:** `sudo` が必要（nix-darwin はシステム設定を変更するため）。sudo は
Touch ID 認証（`sudo_local.touchIdAuth`）なので、Claude が直接実行してよい —
実行するとユーザーの Mac に指紋プロンプトが出て、そこで承認される。

- `sudo -n true` は「a password is required」で失敗するが、これは `-n` が
  全プロンプトを禁止するためで正常。Touch ID が使えない証拠ではないので、
  この事前チェックの失敗を理由に「実行できない」と判断しない
- 時間のかかるビルドは先に `nix build '<flakeパス>#darwinConfigurations.<host>.system' --no-link`
  を sudo なしで済ませておくと、switch 本体はアクティベーションだけで一瞬で終わる

`nix` コマンドが `sudo` 環境で見つからない場合はフルパスを使う:

```bash
sudo /nix/var/nix/profiles/default/bin/nix run nix-darwin -- switch --flake "<編集した worktree の絶対パス>"
```

初回のみ `nix run nix-darwin --` 経由で実行する。2回目以降は `darwin-rebuild` が PATH に入る。

対象ホストは現在の `flake.nix` の `darwinConfigurations` から確認する。必要なら `--flake <path>#<host>` で明示する。Nix activation のリンク先がメインチェックアウトを参照する構成では、switch 成功と worktree 内の設定ファイルの反映を区別する。
