#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: watch-pr-actions.sh <pr-number> [interval-seconds] [timeout-seconds]" >&2
}

if [ "$#" -lt 1 ] || [ "$#" -gt 3 ]; then
  usage
  exit 2
fi

pr_number="$1"
interval_seconds="${2:-30}"
timeout_seconds="${3:-2400}"
discovery_timeout_seconds="${ACTIONS_DISCOVERY_TIMEOUT_SECONDS:-300}"

for value in "$pr_number" "$interval_seconds" "$timeout_seconds" "$discovery_timeout_seconds"; do
  case "$value" in
    ''|*[!0-9]*)
      usage
      exit 2
      ;;
  esac
done

command -v gh >/dev/null 2>&1 || {
  echo "gh is required" >&2
  exit 2
}
command -v jq >/dev/null 2>&1 || {
  echo "jq is required" >&2
  exit 2
}

head_sha="$(gh pr view "$pr_number" --json headRefOid --jq '.headRefOid')"
if [ -z "$head_sha" ]; then
  echo "PR #${pr_number}: head SHA was not found" >&2
  exit 1
fi

started_at="$(date +%s)"
last_summary=""

while :; do
  now="$(date +%s)"
  elapsed="$((now - started_at))"

  if [ "$elapsed" -ge "$timeout_seconds" ]; then
    echo "PR #${pr_number}: timed out after ${timeout_seconds}s waiting for GitHub Actions" >&2
    exit 8
  fi

  if ! runs_json="$(
    gh run list \
      --commit "$head_sha" \
      --event pull_request \
      --limit 100 \
      --json databaseId,status,conclusion,workflowName,name,url
  )"; then
    echo "PR #${pr_number}: GitHub Actions API request failed; retrying" >&2
    sleep "$interval_seconds"
    continue
  fi

  run_count="$(jq 'length' <<<"$runs_json")"
  if [ "$run_count" -eq 0 ]; then
    if [ "$elapsed" -ge "$discovery_timeout_seconds" ]; then
      echo "PR #${pr_number}: no pull_request Actions run appeared within ${discovery_timeout_seconds}s" >&2
      exit 8
    fi
    sleep "$interval_seconds"
    continue
  fi

  summary="$(
    jq -r '
      group_by(.status + ":" + (.conclusion // ""))
      | map("\(.[0].status):\(.[0].conclusion // "pending")=\(length)")
      | join(" ")
    ' <<<"$runs_json"
  )"
  if [ "$summary" != "$last_summary" ]; then
    echo "PR #${pr_number}: ${summary}"
    last_summary="$summary"
  fi

  pending_count="$(jq '[.[] | select(.status != "completed")] | length' <<<"$runs_json")"
  if [ "$pending_count" -gt 0 ]; then
    sleep "$interval_seconds"
    continue
  fi

  jq -r '
    sort_by(.workflowName // .name, .databaseId)
    | .[]
    | "run=\(.databaseId) conclusion=\(.conclusion // "unknown") workflow=\(.workflowName // .name) url=\(.url)"
  ' <<<"$runs_json"

  failed_count="$(
    jq '[
      .[]
      | select(
          (.conclusion // "unknown")
          | IN("success", "neutral", "skipped")
          | not
        )
    ] | length' <<<"$runs_json"
  )"
  if [ "$failed_count" -gt 0 ]; then
    exit 1
  fi

  exit 0
done
