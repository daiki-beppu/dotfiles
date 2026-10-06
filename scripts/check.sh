#!/usr/bin/env bash
# Local/CI verification entry point.
#
# Usage:
#   scripts/check.sh              # run all checks
#   scripts/check.sh nix-eval     # run only the nix-eval check
#   scripts/check.sh shellcheck links   # run only the named checks
#   scripts/check.sh mas-declared       # local-only, before darwin-rebuild switch
#   scripts/check.sh --list             # print available checks
#
# Available checks: DEFAULT_CHECKS and OPT_IN_CHECKS below. Adding a check means
# defining check_<name> (dashes become underscores) and listing <name> there.
set -euo pipefail

DEFAULT_CHECKS=(nix-eval shellcheck links hooks guard-main-commit guard-foreground-wait agent-skills)
# Opt-in: inspects this Mac, so it is not part of the default run.
OPT_IN_CHECKS=(mas-declared)

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# Check: nix-eval
# Evaluates every darwinConfiguration host's system.drvPath. Pure evaluation,
# no build, so no macOS-specific work happens here.
# ---------------------------------------------------------------------------
check_nix_eval() {
  echo "== nix-eval =="
  nix eval .#darwinConfigurations --apply builtins.attrNames || return 1
  local host hosts_raw
  local -a hosts
  hosts_raw="$(nix eval --raw .#darwinConfigurations --apply 'a: builtins.concatStringsSep " " (builtins.attrNames a)')" || return 1
  read -r -a hosts <<< "$hosts_raw"
  for host in "${hosts[@]}"; do
    echo "evaluating $host"
    nix eval ".#darwinConfigurations.\"$host\".system.drvPath" || return 1
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
# files directly under config/ (e.g. .zshenv, .zshrc, .zprofile) that are
# not referenced anywhere in nix/packages.nix. This is deliberately narrow
# -- directories like .claude/.takt/.config/.local are linked as whole
# directories or via individual entries, so a naive "everything in config/
# must appear literally" check would false-positive constantly. We only want
# to catch the "a new top-level dotfile was never wired up" class of bug.
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
# Check: hooks
# Verifies every hook command referenced by config/.claude/settings.json exists
# and carries the executable bit. shellcheck only inspects shebangs, so a hook
# committed as mode 100644 passes CI and then fails silently at runtime with
# "permission denied" -- the failure mode this check exists to catch.
# ---------------------------------------------------------------------------
check_hooks() {
  echo "== hooks =="
  local settings="config/.claude/settings.json"
  local status=0

  if [ ! -f "$settings" ]; then
    echo "SKIP: $settings not found"
    return 0
  fi

  echo "-- checking hook commands referenced by $settings are executable --"
  local cmd path mode
  while IFS= read -r cmd; do
    case "$cmd" in
      */.claude/hooks/*) ;;
      *) continue ;;
    esac
    path="config/.claude/hooks/${cmd##*/}"
    if [ ! -f "$path" ]; then
      echo "MISSING: $settings references $cmd but $path does not exist" >&2
      status=1
    elif [ ! -x "$path" ]; then
      mode="$(stat -f '%Lp' "$path" 2>/dev/null || stat -c '%a' "$path" 2>/dev/null || echo '?')"
      echo "NOT EXECUTABLE: $path has mode $mode -- hooks need the executable bit or they die with 'permission denied'" >&2
      status=1
    fi
  done < <(jq -r '.hooks // {} | to_entries[] | .value[]? | .hooks[]? | .command // empty' "$settings")

  return "$status"
}

# ---------------------------------------------------------------------------
# Check: agent-skills
# Validates the Codex Cloud manifest and exercises the shared symlink syncer
# without touching the real user scope.
# ---------------------------------------------------------------------------
check_agent_skills() {
  echo "== agent-skills =="
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' RETURN

  mkdir -p \
    "$tmp_dir/destination/external-real" \
    "$tmp_dir/external-source" \
    "$tmp_dir/legacy/external-real"
  ln -s "$tmp_dir/external-source" "$tmp_dir/destination/external-link"
  ln -s "$REPO_ROOT/config/.claude/skills/removed-skill" "$tmp_dir/destination/removed-skill"
  ln -s "$REPO_ROOT/config/.agents/skills/goal-setter" "$tmp_dir/legacy/goal-setter"

  AGENT_SKILLS_DIR="$tmp_dir/destination" \
    LEGACY_AGENT_SKILLS_DIR="$tmp_dir/legacy" \
    bash scripts/sync-agent-skills.sh --manifest config/codex-cloud/skills.txt

  local skill
  for skill in goal-setter gh-stack; do
    [ -L "$tmp_dir/destination/$skill" ] || {
      echo "MISSING: Cloud skill link was not created: $skill" >&2
      return 1
    }
    [ -f "$tmp_dir/destination/$skill/SKILL.md" ] || {
      echo "BROKEN: Cloud skill link has no SKILL.md: $skill" >&2
      return 1
    }
  done

  [ ! -L "$tmp_dir/destination/removed-skill" ] || {
    echo "STALE: old source link was not removed" >&2
    return 1
  }
  [ -d "$tmp_dir/destination/external-real" ] || {
    echo "REMOVED: sync replaced an externally managed skill directory" >&2
    return 1
  }
  [ -L "$tmp_dir/destination/external-link" ] || {
    echo "REMOVED: sync replaced an externally managed skill symlink" >&2
    return 1
  }
  [ ! -e "$tmp_dir/legacy/goal-setter" ] || {
    echo "STALE: legacy dotfiles-managed skill symlink was not removed" >&2
    return 1
  }
  [ -d "$tmp_dir/legacy/external-real" ] || {
    echo "REMOVED: migration deleted an externally managed legacy skill" >&2
    return 1
  }

  if git grep -n -E '[.]codex/skills' -- config nix scripts README.md AGENTS.md; then
    echo "ERROR: legacy Codex skill path remains in active configuration" >&2
    return 1
  fi

  # Cloud-only sync must reject local use and directory links before modifying them.
  if AGENT_SKILLS_DIR="$tmp_dir/destination" bash scripts/sync-agent-skills.sh; then
    echo "ERROR: sync accepted a missing manifest" >&2
    return 1
  fi
  mkdir -p "$tmp_dir/shared"
  ln -s "$tmp_dir/shared" "$tmp_dir/local-skills"
  if AGENT_SKILLS_DIR="$tmp_dir/local-skills" \
    bash scripts/sync-agent-skills.sh --manifest config/codex-cloud/skills.txt; then
    echo "ERROR: Cloud sync accepted a shared local directory" >&2
    return 1
  fi
  [ -z "$(ls -A "$tmp_dir/shared")" ] || return 1

}

# ---------------------------------------------------------------------------
# Check: guard-main-commit
# Feeds PreToolUse inputs to config/.claude/hooks/guard-main-commit.sh against
# throwaway repos: a commit on main/master must be denied, while feature
# branches, `cd <worktree> && git commit`, `git -C <worktree>`, non-commit git
# commands and non-git commands must pass through with no output.
# ---------------------------------------------------------------------------
check_guard_main_commit() {
  echo "== guard-main-commit =="
  local hook="$REPO_ROOT/config/.claude/hooks/guard-main-commit.sh"
  local tmp_dir status=0
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' RETURN

  local main_repo="$tmp_dir/main-repo" master_repo="$tmp_dir/master-repo"
  local worktree="$tmp_dir/main-repo/.claude/worktrees/feature"
  git init -q -b main "$main_repo"
  git -C "$main_repo" -c user.name=t -c user.email=t@example.com commit -q --allow-empty -m init
  git -C "$main_repo" worktree add -q -b feature "$worktree"
  git init -q -b master "$master_repo"
  mkdir -p "$tmp_dir/not-a-repo"

  # expect <deny|allow> <cwd> <command>
  expect() {
    local want="$1" cwd="$2" command="$3" out got
    out="$(jq -n --arg cwd "$cwd" --arg command "$command" \
      '{hook_event_name: "PreToolUse", cwd: $cwd, tool_name: "Bash", tool_input: {command: $command}}' |
      "$hook")" || {
      echo "FAIL: hook exited non-zero for [$command] in $cwd" >&2
      status=1
      return
    }
    if [ -z "$out" ]; then
      got=allow
    elif [ "$(jq -r '.hookSpecificOutput.permissionDecision' <<<"$out")" = deny ]; then
      got=deny
    else
      got="unexpected output: $out"
    fi
    if [ "$got" = "$want" ]; then
      echo "ok: $want [$command]"
    else
      echo "FAIL: expected $want, got $got for [$command] in $cwd" >&2
      status=1
    fi
  }

  expect deny "$main_repo" 'git commit -m x'
  expect deny "$main_repo" 'git add -A && git commit -m "msg"'
  expect deny "$master_repo" 'git commit --allow-empty -m x'
  expect deny "$main_repo" 'GIT_AUTHOR_NAME=x git -c core.editor=true commit'
  expect deny "$worktree" "git -C $main_repo commit -m x"
  expect deny "$worktree" "cd $main_repo && git commit -m x"
  expect allow "$worktree" 'git add -A && git commit -m x'
  expect allow "$main_repo" "cd $worktree && git add -A && git commit -m x"
  expect allow "$main_repo" 'cd .claude/worktrees/feature && git commit -m x'
  expect allow "$main_repo" "git -C $worktree commit -m x"
  expect allow "$main_repo" 'git -C .claude/worktrees/feature commit -m x'
  expect allow "$main_repo" 'git status && git log --grep commit'
  expect allow "$main_repo" 'ls -la && echo done'
  expect allow "$tmp_dir/not-a-repo" 'git commit -m x'
  expect allow "$main_repo" "cd $tmp_dir/missing && git commit -m x"

  # The main checkout is shared with other sessions: moving its HEAD or
  # discarding its changes is denied, returning it to main/master is not.
  expect deny "$main_repo" 'git checkout --detach origin/main'
  expect deny "$main_repo" 'git switch -c topic'
  expect deny "$main_repo" 'git checkout -- README.md'
  expect deny "$main_repo" 'git reset --hard HEAD~1'
  expect deny "$worktree" "cd $main_repo && git checkout -b topic"
  expect deny "$worktree" "git -C $main_repo switch --detach"
  expect allow "$main_repo" 'git checkout main'
  expect allow "$main_repo" 'git switch main'
  expect allow "$master_repo" 'git checkout master'
  expect allow "$main_repo" 'git reset -q HEAD README.md'
  expect allow "$worktree" 'git checkout -b topic && git switch --detach'
  expect allow "$worktree" 'git reset --hard origin/main'
  expect allow "$main_repo" "git -C $worktree checkout --detach"

  local out
  out="$(jq -n '{cwd: "/", tool_name: "Read", tool_input: {file_path: "/etc/hosts"}}' | "$hook")"
  if [ -n "$out" ]; then
    echo "FAIL: non-Bash input produced output: $out" >&2
    status=1
  else
    echo "ok: allow [non-Bash tool input]"
  fi

  return "$status"
}

# ---------------------------------------------------------------------------
# Check: guard-foreground-wait
# Feeds PreToolUse inputs to config/.claude/hooks/guard-foreground-wait.sh:
# commands that block until CI or a file appears must run with
# run_in_background, everything else passes through with no output.
# ---------------------------------------------------------------------------
check_guard_foreground_wait() {
  echo "== guard-foreground-wait =="
  local hook="$REPO_ROOT/config/.claude/hooks/guard-foreground-wait.sh"
  local status=0

  # expect <deny|allow> <run_in_background> <command>
  expect() {
    local want="$1" background="$2" command="$3" out got
    out="$(jq -n --arg command "$command" --argjson background "$background" \
      '{hook_event_name: "PreToolUse", cwd: "/", tool_name: "Bash",
        tool_input: ({command: $command} + (if $background then {run_in_background: true} else {} end))}' |
      "$hook")" || {
      echo "FAIL: hook exited non-zero for [$command]" >&2
      status=1
      return
    }
    if [ -z "$out" ]; then
      got=allow
    elif [ "$(jq -r '.hookSpecificOutput.permissionDecision' <<<"$out")" = deny ]; then
      got=deny
    else
      got="unexpected output: $out"
    fi
    if [ "$got" = "$want" ]; then
      echo "ok: $want [$command] background=$background"
    else
      echo "FAIL: expected $want, got $got for [$command] background=$background" >&2
      status=1
    fi
  }

  expect deny false 'gh pr checks 12 --watch'
  expect deny false 'cd repo && gh pr checks 12 --watch --interval 20 >/dev/null 2>&1; gh pr view 12'
  expect deny false 'gh run watch 123 --exit-status'
  expect deny false 'until [ -e /tmp/x.exit ]; do sleep 30; done; cat /tmp/x.exit'
  expect allow true 'gh pr checks 12 --watch'
  expect allow true 'until [ -e /tmp/x.exit ]; do sleep 30; done'
  expect allow false 'gh pr checks 12'
  expect allow false 'gh run view 123 --log-failed'
  expect allow false 'git log --oneline -3'

  return "$status"
}

# ---------------------------------------------------------------------------
# Check: mas-declared
# Once masApps declares any app, homebrew.onActivation.cleanup = "uninstall"
# uninstalls every installed App Store app missing from masApps on switch.
# Fails when an installed App Store app (Spotlight kMDItemAppStoreAdamID, the
# same source `mas list` reads) is not declared for this host. Host defaults
# to LocalHostName; override with DARWIN_HOST.
# ---------------------------------------------------------------------------
check_mas_declared() {
  echo "== mas-declared =="
  local host="${DARWIN_HOST:-$(scutil --get LocalHostName)}"
  local declared
  declared="$(nix eval --raw ".#darwinConfigurations.\"$host\".config.homebrew.masApps" \
    --apply 'a: builtins.concatStringsSep " " (map toString (builtins.attrValues a))')" || return 1
  [ -n "$declared" ] || { echo "masApps is empty for $host; cleanup leaves App Store apps alone"; return 0; }

  local app id missing=0
  while IFS= read -r app; do
    id="$(mdls -raw -name kMDItemAppStoreAdamID "$app")"
    case " $declared " in
      *" $id "*) ;;
      *) echo "undeclared: \"$(basename "$app" .app)\" = $id;  # $app" >&2; missing=1 ;;
    esac
  done < <(mdfind -onlyin /Applications 'kMDItemAppStoreAdamID == *')
  [ "$missing" -eq 0 ] || { echo "add these to masApps in flake.nix, or switch will uninstall them" >&2; return 1; }
  echo "all installed App Store apps are declared for $host"
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
main() {
  if [ "${1:-}" = "--list" ]; then
    printf '%s\n' "${DEFAULT_CHECKS[@]}" "${OPT_IN_CHECKS[@]}"
    exit 0
  fi

  local -a checks=("$@")
  if [ "${#checks[@]}" -eq 0 ]; then
    checks=("${DEFAULT_CHECKS[@]}")
  fi

  local -a ran=()
  local -a failed=()
  local c

  for c in "${checks[@]}"; do
    case " ${DEFAULT_CHECKS[*]} ${OPT_IN_CHECKS[*]} " in
      *" $c "*) ;;
      *)
        echo "unknown check: $c (available: ${DEFAULT_CHECKS[*]} ${OPT_IN_CHECKS[*]})" >&2
        exit 2
        ;;
    esac
    ran+=("$c")
    "check_${c//-/_}" || failed+=("$c")
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
