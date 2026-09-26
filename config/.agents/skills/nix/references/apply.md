# 適用

`NH_FLAKE` やメインチェックアウトの暗黙指定では今回の worktree の編集を適用できないため、flake を明示する。対象ホストは `flake.nix` の `darwinConfigurations` から確認し、必要なら `#<host>` を付ける。

```bash
nix build '<編集した worktree の絶対パス>#darwinConfigurations.<host>.system' --no-link
sudo darwin-rebuild switch --flake "<編集した worktree の絶対パス>"
```

時間のかかるビルドを sudo なしで先に済ませると、switch はアクティベーションだけで終わる。`sudo` 環境で `darwin-rebuild` が見つからなければ `sudo /nix/var/nix/profiles/default/bin/nix run nix-darwin -- switch --flake "<path>"` を使う。

Nix activation のリンク先がメインチェックアウトを参照する構成では、switch 成功と worktree 内の設定ファイルの反映を区別する。
