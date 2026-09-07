#!/usr/bin/env bash
# Codex Cloud の setup / maintenance 共通 bootstrap (Ubuntu Linux)。
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for tool in node npm curl tar sha256sum apt-get; do
  command -v "$tool" >/dev/null || { echo "ERROR: $tool is required" >&2; exit 1; }
done
node -e 'if (+process.versions.node.split(".")[0] < 18) process.exit(1)'
privileged=()
if [ "$(id -u)" -ne 0 ]; then
  sudo -n true
  privileged=(sudo -n)
fi

# 古い gh は --attach 非対応。公式バイナリを checksum 照合して導入する。
# 入力を最後まで読み、pipefail 下で gh の SIGPIPE (141) を防ぐ。
if ! gh pr edit --help 2>/dev/null | grep -- '--attach' >/dev/null; then
  case "$(uname -m)" in
    x86_64) arch=amd64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) echo "ERROR: unsupported architecture" >&2; exit 1 ;;
  esac
  gh_version=2.99.0
  archive="gh_${gh_version}_linux_${arch}.tar.gz"
  download_dir="$(mktemp -d)"
  trap 'rm -rf "$download_dir"' EXIT
  release="https://github.com/cli/cli/releases/download/v${gh_version}"
  curl -fsSL "$release/$archive" -o "$download_dir/$archive"
  curl -fsSL "$release/gh_${gh_version}_checksums.txt" -o "$download_dir/checksums.txt"
  (cd "$download_dir" && grep "  $archive\$" checksums.txt | sha256sum --check --strict -)
  tar -xzf "$download_dir/$archive" -C "$download_dir"
  "${privileged[@]}" install -m 755 "$download_dir/gh_${gh_version}_linux_${arch}/bin/gh" /usr/local/bin/gh
  # Cloud universal は mise 管理の旧 gh が /usr/local/bin より先にある。
  if command -v mise >/dev/null 2>&1; then
    mise use --global gh@system
    eval "$(mise env --shell bash)"
  fi
  hash -r
fi
# PATH に旧版が先行する場合も検出する。
gh pr edit --help | grep -- '--attach' >/dev/null

"${privileged[@]}" apt-get update
"${privileged[@]}" apt-get install -y ffmpeg
npm install --global @playwright/cli@0.1.19
playwright_package="$(npm root -g)/@playwright/cli"
playwright_driver="$(node -e 'console.log(require("path").join(require("path").dirname(require.resolve("playwright/package.json", {paths: [process.argv[1]]})), "cli.js"))' "$playwright_package")"
# インストール済み CLI と同じ Playwright 版のブラウザー・共有ライブラリー。
node "$playwright_driver" install --with-deps chromium
mkdir -p "$HOME/.config/dotfiles"
cat > "$HOME/.config/dotfiles/evidence-browser.json" <<'JSON'
{"browser":{"browserName":"chromium","launchOptions":{"channel":"chromium","headless":true}}}
JSON

"$REPO_ROOT/scripts/sync-agent-skills.sh" --manifest "$REPO_ROOT/config/codex-cloud/skills.txt"
if ! gh stack --version >/dev/null 2>&1; then
  gh extension install github/gh-stack
fi
git config --global rerere.enabled true
"$REPO_ROOT/scripts/check-codex-cloud-evidence.sh"
echo "[setup-codex-cloud] tools and recording verified; PR upload authentication requires a separate check" >&2
