#!/usr/bin/env bash
# Local/CI verification entry point.
#
# Usage:
#   scripts/check.sh              # run all checks
#   scripts/check.sh nix-eval     # run only the nix-eval check
#   scripts/check.sh shellcheck links   # run only the named checks
#
# Available checks: nix-eval, shellcheck, links
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# Check: nix-eval
# Evaluates every darwinConfiguration host's system.drvPath. Pure evaluation,
# no build, so no macOS-specific work happens here.
# ---------------------------------------------------------------------------
check_nix_eval() {
  echo "== nix-eval =="
  nix eval .#darwinConfigurations --apply builtins.attrNames
  local host
  for host in $(nix eval --raw .#darwinConfigurations --apply 'a: builtins.concatStringsSep " " (builtins.attrNames a)'); do
    echo "evaluating $host"
    nix eval ".#darwinConfigurations.\"$host\".system.drvPath"
  done
}

# ---------------------------------------------------------------------------
# Check: shellcheck
# Dynamically discovers tracked files whose shebang is bash/sh, then lints
# them at --severity=error. Falls back to the nixpkgs shellcheck package
# (via nix run) if the shellcheck binary isn't on PATH.
#
# Exclusion list (reason required as a comment). Empty as of Plan 012 --
# every shebang-detected script passed severity=error cleanly.
# ---------------------------------------------------------------------------
SHELLCHECK_EXCLUDE=(
  # example: "config/some/legacy-script.sh"  # reason it's excluded
)

check_shellcheck() {
  echo "== shellcheck =="

  local shellcheck_cmd
  if command -v shellcheck >/dev/null 2>&1; then
    shellcheck_cmd=(shellcheck)
  else
    shellcheck_cmd=(nix run nixpkgs#shellcheck --)
  fi

  local files=()
  local f
  while IFS= read -r f; do
    [ -f "$f" ] || continue
    local shebang
    shebang="$(head -c 100 "$f" 2>/dev/null | head -1)"
    if printf '%s' "$shebang" | rg -q '^#!.*\b(ba)?sh\b'; then
      local excluded=0
      local ex
      for ex in "${SHELLCHECK_EXCLUDE[@]:-}"; do
        [ "$ex" = "$f" ] && excluded=1 && break
      done
      [ "$excluded" -eq 1 ] && continue
      files+=("$f")
    fi
  done < <(git ls-files)

  if [ "${#files[@]}" -eq 0 ]; then
    echo "no shell scripts found"
    return 0
  fi

  echo "checking ${#files[@]} script(s):"
  printf '  %s\n' "${files[@]}"
  "${shellcheck_cmd[@]}" --severity=error "${files[@]}"
}

# ---------------------------------------------------------------------------
# Check: links
# Drift check between nix/packages.nix's linkDotfiles manifest and the
# actual contents of config/.
#
# Direction 1 (hard failure): every `link_force "${dotfilesDir}/<path>"`
# source must exist under config/<path> -- catches dangling declarations.
#
# Direction 2 (warning only, does not affect exit code): top-level regular
# files directly under config/ (e.g. .zshenv, .zshrc, .wezterm.lua) that are
# not referenced anywhere in nix/packages.nix. This is deliberately narrow
# -- directories like .claude/.takt/.config/.local are linked as whole
# directories or via individual entries, so a naive "everything in config/
# must appear literally" check would false-positive constantly. We only want
# to catch the ".wezterm.lua was never wired up" class of bug.
# ---------------------------------------------------------------------------
check_links() {
  echo "== links =="
  local manifest="nix/packages.nix"
  local status=0

  echo "-- checking link_force sources exist under config/ --"
  local rel
  while IFS= read -r rel; do
    if [ ! -e "config/$rel" ]; then
      echo "MISSING: nix/packages.nix references \${dotfilesDir}/$rel but config/$rel does not exist" >&2
      status=1
    fi
  done < <(rg -o 'link_force "\$\{dotfilesDir\}/([^"]+)"' -r '$1' "$manifest")

  echo "-- checking top-level config/ regular files are referenced in manifest (warning only) --"
  local f base
  for f in config/.[!.]*; do
    [ -f "$f" ] || continue
    base="$(basename "$f")"
    if ! rg -q -- "$base" "$manifest"; then
      echo "WARNING: config/$base is a top-level file not referenced in $manifest (possibly not deployed)" >&2
    fi
  done

  return "$status"
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
main() {
  local -a checks=("$@")
  if [ "${#checks[@]}" -eq 0 ]; then
    checks=(nix-eval shellcheck links)
  fi

  local -a ran=()
  local -a failed=()
  local c

  for c in "${checks[@]}"; do
    case "$c" in
      nix-eval) ran+=("$c"); check_nix_eval || failed+=("$c") ;;
      shellcheck) ran+=("$c"); check_shellcheck || failed+=("$c") ;;
      links) ran+=("$c"); check_links || failed+=("$c") ;;
      *)
        echo "unknown check: $c (available: nix-eval, shellcheck, links)" >&2
        exit 2
        ;;
    esac
  done

  echo
  echo "== summary =="
  echo "ran: ${ran[*]}"
  if [ "${#failed[@]}" -eq 0 ]; then
    echo "all checks passed"
    exit 0
  else
    echo "failed: ${failed[*]}" >&2
    exit 1
  fi
}

main "$@"
