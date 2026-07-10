#!/usr/bin/env bash
# Local/CI verification entry point.
#
# Usage:
#   scripts/check.sh              # run all checks
#   scripts/check.sh nix-eval     # run only the nix-eval check
#   scripts/check.sh shellcheck links   # run only the named checks
#
# Available checks: nix-eval, shellcheck, links, contracts
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
    if printf '%s' "$shebang" | grep -qE '^#!.*/(env[[:space:]]+)?(ba)?sh([[:space:]]|$)'; then
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
  done < <(sed -nE 's|^.*link_force "[$][{]dotfilesDir[}]/([^"]+)".*$|\1|p' "$manifest")

  echo "-- checking top-level config/ regular files are referenced in manifest (warning only) --"
  local f base
  for f in config/.[!.]*; do
    [ -f "$f" ] || continue
    base="$(basename "$f")"
    if ! grep -qF -- "$base" "$manifest"; then
      echo "WARNING: config/$base is a top-level file not referenced in $manifest (possibly not deployed)" >&2
    fi
  done

  return "$status"
}

# ---------------------------------------------------------------------------
# Check: contracts
# Cross-checks the takt-family skill docs (takt-issue / takt-review / takt)
# against the local `.takt/` workflow YAMLs, so a skill referencing a
# workflow name that doesn't exist gets caught at PR time instead of at
# `takt run` startup.
#
# 1. Every workflow name referenced from a structured location in the skill
#    docs (judgment tables, `-w <name>` flags) must resolve to either a
#    local `config/.takt/workflows/*.yaml` `name:` or an entry in
#    scripts/takt-builtin-workflows.txt (hard failure).
# 2. Every local workflow's `schema_ref:` must resolve to
#    config/.takt/schemas/<name>.json (hard failure). `policy:` references
#    (single-line or list form) that don't resolve to
#    config/.takt/facets/policies/<name>.md are assumed to be builtin
#    facets and only produce a warning (no exit-code impact -- CI has no
#    takt install to verify builtin facets against).
# 3. Every local workflow YAML's `name:` field must match its filename.
# 4. (Local-only, skipped when the installed-takt builtins dir is absent,
#    which is always true in CI) warn if
#    scripts/takt-builtin-workflows.txt has drifted from the installed
#    takt's builtins/ja/workflows/ listing.
#
# Extraction is deliberately narrow (see plan 017): only structured spans
# (markdown table rows inside known sections, `-w <name>` flags) are
# scanned. Free-form prose is not parsed for workflow names -- that was
# tried and produced too many false positives (e.g. the `issue` skill name
# in backticks).
# ---------------------------------------------------------------------------
check_contracts() {
  echo "== contracts =="
  local status=0

  local workflows_dir="config/.takt/workflows"
  local schemas_dir="config/.takt/schemas"
  local policies_dir="config/.takt/facets/policies"
  local allowlist="scripts/takt-builtin-workflows.txt"

  echo "-- collecting local workflow names (name: field vs filename) --"
  local -A local_workflow_names=()
  local f base name
  for f in "$workflows_dir"/*.yaml; do
    [ -f "$f" ] || continue
    base="$(basename "$f" .yaml)"
    name="$(sed -nE 's/^name: (.+)$/\1/p' "$f" | head -1)"
    if [ -z "$name" ]; then
      echo "MISSING: $f has no top-level 'name:' field" >&2
      status=1
      continue
    fi
    if [ "$name" != "$base" ]; then
      echo "MISMATCH: $f declares name '$name' but filename is '$base.yaml'" >&2
      status=1
    fi
    local_workflow_names["$name"]=1
  done

  echo "-- loading builtin workflow allowlist --"
  local -A allowlist_names=()
  if [ -f "$allowlist" ]; then
    local line
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      case "$line" in
        \#*) continue ;;
      esac
      allowlist_names["$line"]=1
    done < "$allowlist"
  else
    echo "MISSING: $allowlist not found" >&2
    status=1
  fi

  echo "-- extracting workflow names referenced from skill docs --"
  local -A referenced=()
  local n

  # 1. takt-issue judgment table (table rows only, scoped to the
  #    "workflow 判断基準" section by markdown heading nesting).
  while IFS= read -r n; do
    [ -n "$n" ] && referenced["$n"]=1
  done < <(awk '
      /^#### workflow 判断基準/ { flag=1; next }
      flag && /^#{1,4} / { flag=0 }
      flag && /^\|/
    ' config/.claude/skills/takt-issue/SKILL.md | grep -oE '`[a-z0-9-]+`' | tr -d '`')

  # 2. takt/SKILL.md "## Workflow" table (table rows only).
  while IFS= read -r n; do
    [ -n "$n" ] && referenced["$n"]=1
  done < <(awk '
      /^## Workflow$/ { flag=1; next }
      flag && /^#{1,2} / { flag=0 }
      flag && /^\|/
    ' config/.claude/skills/takt/SKILL.md | grep -oE '`[a-z0-9-]+`' | tr -d '`')

  # 3. `-w <name>` flags across all takt-family skill docs.
  while IFS= read -r n; do
    [ -n "$n" ] && referenced["$n"]=1
  done < <(grep -ohE -e '-w [a-z0-9-]+' \
      config/.claude/skills/takt-issue/SKILL.md \
      config/.claude/skills/takt-review/SKILL.md \
      config/.claude/skills/takt/SKILL.md \
      config/.claude/skills/takt/references/*.md 2>/dev/null | sed 's/^-w //' || true)

  echo "-- checking referenced workflow names resolve --"
  for n in "${!referenced[@]}"; do
    if [ -z "${local_workflow_names[$n]:-}" ] && [ -z "${allowlist_names[$n]:-}" ]; then
      echo "MISSING: skill docs reference workflow '$n' but it is neither a local workflow ($workflows_dir/*.yaml) nor listed in $allowlist" >&2
      status=1
    fi
  done

  echo "-- checking schema_ref resolves under $schemas_dir --"
  local sref
  for f in "$workflows_dir"/*.yaml; do
    [ -f "$f" ] || continue
    while IFS= read -r sref; do
      [ -z "$sref" ] && continue
      if [ ! -f "$schemas_dir/$sref.json" ]; then
        echo "MISSING: $f references schema_ref '$sref' but $schemas_dir/$sref.json does not exist" >&2
        status=1
      fi
    done < <(sed -nE 's/^[[:space:]]*schema_ref:[[:space:]]*([a-z0-9-]+)[[:space:]]*$/\1/p' "$f")
  done

  echo "-- checking policy: references (warning only if unresolved -- may be builtin facets) --"
  local pol
  for f in "$workflows_dir"/*.yaml; do
    [ -f "$f" ] || continue
    while IFS= read -r pol; do
      [ -z "$pol" ] && continue
      if [ ! -f "$policies_dir/$pol.md" ]; then
        echo "WARNING: $f references policy '$pol' with no local file at $policies_dir/$pol.md (assumed builtin facet)" >&2
      fi
    done < <(sed -nE 's/^[[:space:]]*policy:[[:space:]]*([a-z0-9-]+)[[:space:]]*$/\1/p' "$f")
  done

  for f in "$workflows_dir"/*.yaml; do
    [ -f "$f" ] || continue
    while IFS= read -r pol; do
      [ -z "$pol" ] && continue
      if [ ! -f "$policies_dir/$pol.md" ]; then
        echo "WARNING: $f references policy '$pol' with no local file at $policies_dir/$pol.md (assumed builtin facet)" >&2
      fi
    done < <(awk '
        /^[[:space:]]*policy:[[:space:]]*$/ { inpolicy=1; next }
        inpolicy && /^[[:space:]]*-[[:space:]]*[a-z0-9-]+[[:space:]]*$/ {
          line=$0
          gsub(/^[[:space:]]*-[[:space:]]*/, "", line)
          gsub(/[[:space:]]*$/, "", line)
          print line
          next
        }
        { inpolicy=0 }
      ' "$f")
  done

  echo "-- checking allowlist freshness against installed takt builtins (local-only) --"
  local builtin_dir="$HOME/.bun/install/global/node_modules/takt/builtins/ja/workflows"
  if [ -d "$builtin_dir" ]; then
    local installed_sorted allowlist_sorted
    installed_sorted="$(ls "$builtin_dir" | sed 's/\.yaml$//' | sort)"
    allowlist_sorted="$(printf '%s\n' "${!allowlist_names[@]}" | sort)"
    if [ "$installed_sorted" != "$allowlist_sorted" ]; then
      echo "WARNING: $allowlist is stale relative to installed takt builtins ($builtin_dir):" >&2
      diff <(printf '%s\n' "$installed_sorted") <(printf '%s\n' "$allowlist_sorted") >&2 || true
    fi
  else
    echo "(skipped: $builtin_dir not present -- expected in CI)"
  fi

  return "$status"
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
main() {
  local -a checks=("$@")
  if [ "${#checks[@]}" -eq 0 ]; then
    checks=(nix-eval shellcheck links contracts)
  fi

  local -a ran=()
  local -a failed=()
  local c

  for c in "${checks[@]}"; do
    case "$c" in
      nix-eval) ran+=("$c"); check_nix_eval || failed+=("$c") ;;
      shellcheck) ran+=("$c"); check_shellcheck || failed+=("$c") ;;
      links) ran+=("$c"); check_links || failed+=("$c") ;;
      contracts) ran+=("$c"); check_contracts || failed+=("$c") ;;
      *)
        echo "unknown check: $c (available: nix-eval, shellcheck, links, contracts)" >&2
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
