{ pkgs, lib, ... }:
let
  version = "1.0.0";
  # npm で配布される単体バイナリ（依存なし）。ホストは aarch64-darwin のみ。
  vp = pkgs.stdenvNoCC.mkDerivation {
    pname = "vite-plus-cli";
    inherit version;
    src = pkgs.fetchurl {
      url = "https://registry.npmjs.org/@voidzero-dev/vite-plus-cli-darwin-arm64/-/vite-plus-cli-darwin-arm64-${version}.tgz";
      hash = "sha256-MasCokHtBO0TarNlnYFvKUnogAEWsFPH9FtxURP2dKs=";
    };
    installPhase = ''
      install -Dm755 vp "$out/bin/vp"
    '';
  };
in
{
  # nixpkgs 未収録。Homebrew 版は Node.js とその依存を更新するため使わない。
  # バイナリは Nix で固定し、~/.vite-plus への展開は vp の self-setup に任せる。
  # self-setup は vite-plus 本体と Node.js を取得するため、初回と更新時はネットワークが必要。
  home.activation.installVitePlus = lib.hm.dag.entryAfter [ "linkDotfiles" ] ''
    VP_HOME="$HOME/.vite-plus"
    if [ "$(readlink "$VP_HOME/current" 2>/dev/null)" != "${version}" ] ||
       ! "$VP_HOME/bin/vp" --version >/dev/null 2>&1; then
      # PATH は dotfiles の .zshenv が ~/.vite-plus/env を読んで通すので、
      # シェル設定ファイルは書き換えさせない。shim は system-first にする。
      run --quiet env VP_HOME="$VP_HOME" \
        VP_SELF_SETUP_SHELL=sh \
        VP_SELF_SETUP_NO_MODIFY_PATH=1 \
        VP_NODE_MANAGER=no \
        CI=true \
        ${vp}/bin/vp
    fi
  '';
}
