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
      username = "mba";
      hostname = "mba";
      system = "aarch64-darwin";
    in
    {
      darwinConfigurations.${hostname} = nix-darwin.lib.darwinSystem {
        inherit system;

        modules = [
          {
            # Determinate Nix を使うため nix-daemon の管理を無効化
            nix.enable = false;

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

            # Homebrew との共存
            # nixpkgs にないツールと cask は Homebrew で管理
            homebrew = {
              enable = true;
              onActivation.cleanup = "none";

              taps = [
                "manaflow-ai/cmux"
                "libsql/sqld"
                "tursodatabase/tap"
              ];

              brews = [
                "ni"
                "proto"
                "tursodatabase/tap/turso"
              ];

              casks = [
                "1password"
                "antigravity"
                "aqua-voice"
                "arc"
                "azookey"
                "chatgpt"
                "claude"
                "cleanmymac"
                "manaflow-ai/cmux/cmux"
                "cursor"
                "discord"
                "docker-desktop"
                "figma"
                "font-hackgen"
                "google-chrome"
                "google-drive"
                "gyazo"
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

          # Home Manager を nix-darwin のモジュールとして統合
          home-manager.darwinModules.home-manager
          {
            home-manager.useGlobalPkgs = true;
            home-manager.useUserPackages = true;
            home-manager.backupFileExtension = "backup";
            home-manager.users.${username} = import ./nix/packages.nix;
          }
        ];
      };
    };
}
