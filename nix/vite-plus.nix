{ pkgs, lib, ... }:
let
  version = "0.2.8";
  installerSource = pkgs.fetchurl {
    url = "https://raw.githubusercontent.com/voidzero-dev/vite-plus/v${version}/packages/cli/install.sh";
    hash = "sha256-WLsFLGoAfmYumWZ9ZWhiUbFtazmqIRVUh9ptUSgLPVQ=";
  };
  # PATH は dotfiles の .zshenv が管理する。公式 installer に symlink 先や
  # 他シェルの設定を書き換えさせず、バイナリと env ファイルの生成だけを使う。
  installer = pkgs.runCommand "vite-plus-installer-${version}" { } ''
    substitute ${installerSource} "$out" \
      --replace-fail '  configure_shell_path' '  : # Shell configuration is managed by dotfiles'
  '';
in
{
  # nixpkgs 未収録。Homebrew 版は Node.js とその依存を更新するため、
  # 既存の Node.js / npm / pnpm を保持する例外として公式 installer を使う。
  # npm 依存の取得は activation 時に行うためネットワーク接続が必要。
  home.activation.installVitePlus = lib.hm.dag.entryAfter [ "linkDotfiles" ] ''
    (
      export VP_HOME="$HOME/.vite-plus"
      export VP_VERSION="${version}"
      export VP_NODE_MANAGER=no
      export CI=true
      export PATH="${lib.makeBinPath [ pkgs.curl pkgs.gnutar pkgs.gzip pkgs.coreutils ]}:/opt/homebrew/bin:$PATH"

      if [ ! -x "$VP_HOME/bin/vp" ] ||
         [ "$(readlink "$VP_HOME/current")" != "$VP_VERSION" ] ||
         [ ! -f "$VP_HOME/env" ] ||
         ! "$VP_HOME/bin/vp" --version >/dev/null 2>&1; then
        run ${pkgs.bash}/bin/bash ${installer}
      fi
      # 既存インストールに shim がある場合も system-first に揃える。
      if [ -x "$VP_HOME/bin/vp" ]; then
        run "$VP_HOME/bin/vp" env off
      fi
    )
  '';
}
