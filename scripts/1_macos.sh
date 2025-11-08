#!/bin/bash

echo "🍎 macOS設定を開始..."

# ダークモード
defaults write NSGlobalDomain AppleInterfaceStyle -string "Dark"

# キーボード設定
defaults write NSGlobalDomain KeyRepeat -int 2
defaults write NSGlobalDomain InitialKeyRepeat -int 15
defaults write NSGlobalDomain AppleKeyboardUIMode -int 2

# トラックパッド設定
defaults write NSGlobalDomain com.apple.swipescrolldirection -bool false
defaults write NSGlobalDomain com.apple.trackpad.forceClick -int 0
defaults write NSGlobalDomain com.apple.trackpad.scaling -int 3

defaults write com.apple.AppleMultitouchTrackpad Clicking -int 1
defaults write com.apple.AppleMultitouchTrackpad TrackpadThreeFingerDrag -int 0
defaults write com.apple.AppleMultitouchTrackpad TrackpadRightClick -int 1
defaults write com.apple.AppleMultitouchTrackpad TrackpadTwoFingerFromRightEdgeSwipeGesture -int 0

# Finder設定
defaults write NSGlobalDomain AppleShowAllExtensions -bool true
defaults write com.apple.finder ShowExternalHardDrivesOnDesktop -bool false
defaults write com.apple.finder ShowHardDrivesOnDesktop -bool false
defaults write com.apple.finder ShowRemovableMediaOnDesktop -bool false
defaults write com.apple.finder ShowRecentTags -bool false
defaults write com.apple.finder NewWindowTarget -string "PfAF"
defaults write com.apple.finder FXPreferredViewStyle -string "clmv"

# Dock設定
defaults write com.apple.dock autohide -bool true
defaults write com.apple.dock magnification -bool true
defaults write com.apple.dock largesize -int 50
defaults write com.apple.dock tilesize -int 47
defaults write com.apple.dock orientation -string "bottom"
defaults write com.apple.dock mineffect -string "genie"
defaults write com.apple.dock show-recents -bool false
defaults write com.apple.dock showAppExposeGestureEnabled -bool true
defaults write com.apple.dock showLaunchpadGestureEnabled -bool false

echo "✅ macOS設定完了！"
echo "⚠️  反映には再起動が必要な設定もあるで"

# Finder と Dock を再起動
killall Finder
killall Dock

echo "🎉 完了！"