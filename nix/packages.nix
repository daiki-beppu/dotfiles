{ pkgs, ... }:

{
  home.stateVersion = "24.11";

  home.packages = with pkgs; [
    xz
    cocoapods
    ffmpeg
    gh
    git
    gzip
    tree
    unzip
    uv
    watchman
  ];
}
