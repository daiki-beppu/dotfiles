{
  description = "daiki-beppu's macOS dotfiles";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    nix-darwin = {
      url = "github:LnL7/nix-darwin";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      nixpkgs,
      nix-darwin,
      home-manager,
      ...
    }:
    let
      system = "aarch64-darwin";
      # ホスト差分の注入点（3 つ）:
      #   - gitEmail: home-manager 側の git user.email を上書き（未指定ならデフォルトの private email）
      #   - extraPackages: pkgs -> [ ... ] 形式で home.packages に追加パッケージを足す
      #   - extraModules: nix-darwin モジュールのリストを追加（casks / system.defaults のホスト分割等）
      # PR #65 型の変更（ホスト固有のハードコード）は今後ここに入れる。
      hosts = {
        "MacBook-Pro-3" = {
          username = "daikibeppu";
        };
        "mba" = {
          username = "mba";
        };
      };
      mkDarwin =
        hostname:
        hostAttrs:
        let
          username = hostAttrs.username;
          hostConfig = {
            gitEmail = hostAttrs.gitEmail or "beppu.engineer@gmail.com";
            extraPackages = hostAttrs.extraPackages or (pkgs: [ ]);
          };
        in
        nix-darwin.lib.darwinSystem {
          inherit system;

          modules = [
            (
              { pkgs, lib, ... }:
              {
                # Determinate Nix を使うため nix-daemon の管理を無効化
                nix.enable = false;

                # BSL ライセンスの terraform を個別許可（nixpkgs unfree 制限の回避）
                nixpkgs.config.allowUnfreePredicate = pkg: builtins.elem (lib.getName pkg) [ "terraform" "zsh-abbr" ];

                # システム設定
                system.stateVersion = 5;
                system.primaryUser = username;
                networking.hostName = hostname;

                # ユーザー
                users.users.${username} = {
                  name = username;
                  home = "/Users/${username}";
                };

                # ── macOS システム設定 ──
                system.defaults = {
                  # ダークモード
                  NSGlobalDomain.AppleInterfaceStyle = "Dark";

                  # キーボード
                  NSGlobalDomain.KeyRepeat = 2;
                  NSGlobalDomain.InitialKeyRepeat = 15;
                  NSGlobalDomain.AppleKeyboardUIMode = 2;

                  # トラックパッド
                  NSGlobalDomain."com.apple.swipescrolldirection" = false;
                  NSGlobalDomain."com.apple.trackpad.forceClick" = false;
                  NSGlobalDomain."com.apple.trackpad.scaling" = 3.0;

                  trackpad.Clicking = true;
                  trackpad.TrackpadThreeFingerDrag = false;
                  trackpad.TrackpadRightClick = true;

                  # Finder
                  NSGlobalDomain.AppleShowAllExtensions = true;
                  finder.ShowExternalHardDrivesOnDesktop = false;
                  finder.ShowHardDrivesOnDesktop = false;
                  finder.ShowRemovableMediaOnDesktop = false;
                  finder.NewWindowTarget = "Recents";
                  finder.FXPreferredViewStyle = "clmv";

                  # Dock
                  dock.autohide = true;
                  dock.magnification = true;
                  dock.largesize = 50;
                  dock.tilesize = 47;
                  dock.orientation = "bottom";
                  dock.mineffect = "genie";
                  dock.show-recents = false;
                  dock.showAppExposeGestureEnabled = true;
                  dock.showLaunchpadGestureEnabled = false;

                  # 専用オプションがない設定
                  CustomUserPreferences = {
                    "com.apple.AppleMultitouchTrackpad" = {
                      TrackpadTwoFingerFromRightEdgeSwipeGesture = 0;
                    };
                    "com.apple.finder" = {
                      ShowRecentTags = false;
                    };
                  };
                };

                # ── Nix ストアの週次自動クリーン（nh） ──
                # Determinate Nix（nix.enable = false）のため nix.gc / nix.optimise が
                # 使えない。代わりに nh clean all を root の launchd daemon で週次実行し、
                # 古い世代・orphan gcroot の削除とストアの重複排除を行う。
                # 保持ポリシー: 直近 30 日の世代はすべて保持 + それ以前は最低 1 世代。
                launchd.daemons.nh-clean = {
                  command = "${pkgs.nh}/bin/nh clean all --keep 1 --keep-since 30d --optimise";
                  serviceConfig = {
                    # 月曜 12:00（スリープ中に時刻を跨ぐと launchd はその回を
                    # スキップするため、稼働している可能性が高い日中に設定）
                    StartCalendarInterval = [
                      {
                        Weekday = 1;
                        Hour = 12;
                        Minute = 0;
                      }
                    ];
                    StandardOutPath = "/var/log/nh-clean.log";
                    StandardErrorPath = "/var/log/nh-clean.err.log";
                  };
                };

                # ── Touch ID で sudo 認証 ──
                security.pam.services.sudo_local.touchIdAuth = true;
                security.pam.services.sudo_local.reattach = true;

                # Homebrew との共存
                # nixpkgs にないツールと cask は Homebrew で管理
                homebrew = {
                  enable = true;
                  onActivation.cleanup = "none";

                  taps = [
                    "manaflow-ai/cmux"
                  ];

                  brews = [
                    "ni"
                  ];

                  casks = [
                    "1password"
                    "1password-cli"
                    "antigravity"
                    "aqua-voice"
                    "arc"
                    "azookey"
                    "chatgpt"
                    "claude"
                    "cleanmymac"
                    "manaflow-ai/cmux/cmux"
                    "codex-app"
                    "cursor"
                    "discord"
                    "docker-desktop"
                    "figma"
                    "font-hackgen"
                    "google-chrome"
                    "google-drive"
                    "gyazo"
                    "nani"
                    "notion"
                    "nvidia-geforce-now"
                    "obsidian"
                    "raycast"
                    "visual-studio-code"
                    "wezterm"
                    "zoom"
                  ];
                };
              }
            )

            # Home Manager を nix-darwin のモジュールとして統合
            home-manager.darwinModules.home-manager
            {
              home-manager.useGlobalPkgs = true;
              home-manager.useUserPackages = true;
              home-manager.backupFileExtension = "backup";
              home-manager.extraSpecialArgs = { inherit hostConfig; };
              home-manager.users.${username} = import ./nix/packages.nix;
            }
          ] ++ (hostAttrs.extraModules or [ ]);
        };
    in
    {
      darwinConfigurations = builtins.mapAttrs mkDarwin hosts;
    };
}
