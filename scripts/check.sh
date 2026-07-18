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
# Validates the dormant local `.takt/` workflow assets kept for recovery.
#
# 1. Every local workflow's `schema_ref:` must resolve to
#    config/.takt/schemas/<name>.json (hard failure). `policy:` references
#    (single-line or list form) that don't resolve to
#    config/.takt/facets/policies/<name>.md are assumed to be builtin
#    facets and only produce a warning (no exit-code impact -- CI has no
#    takt install to verify builtin facets against).
# 2. Every local workflow YAML's `name:` field must match its filename.
# 3. (Local-only, skipped when the installed-takt builtins dir is absent,
#    which is always true in CI) warn if
#    scripts/takt-builtin-workflows.txt has drifted from the installed
#    takt's builtins/ja/workflows/ listing.
# 4. The six workflows that use review-verdict start at preflight. The takt
#    loader resolves their real schema, then takt's WorkflowEngine exercises
#    structured-output validation, state persistence, and `when` transitions
#    with preflight fixtures and final-review verdicts. This protects the
#    fail-fast/ABORT contract rather than merely checking YAML strings.
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

  echo "-- checking schemas avoid OpenAI-strict-incompatible keywords --"
  # codex provider は response_format に schema をそのまま渡す。strict mode は
  # 条件付き検証（allOf/if/then 等）を許可せず 400 になるため、静的に弾く。
  local sf bad
  for sf in "$schemas_dir"/*.json; do
    [ -f "$sf" ] || continue
    if bad="$(grep -nE '"(allOf|anyOf|oneOf|if|then|else|not|\$ref)"[[:space:]]*:' "$sf")"; then
      echo "INVALID: $sf uses strict-mode-incompatible keyword(s):" >&2
      echo "$bad" >&2
      status=1
    fi
  done

  echo "-- checking review-verdict workflow preflight and blocked routes --"
  local takt_bin
  if ! takt_bin="$(command -v takt)"; then
    echo "MISSING: takt executable is required to validate workflow behavior" >&2
    status=1
  else
    local takt_root
    takt_root="$(dirname "$(dirname "$(realpath "$takt_bin")")")"
    # doctor resolves facets/schemas from ~/.takt; point a hermetic HOME at
    # this checkout's config/.takt so validation never depends on (or gets
    # masked by) the developer's real home or CI's lack of one.
    local hermetic_home
    hermetic_home="$(mktemp -d)"
    ln -s "$REPO_ROOT/config/.takt" "$hermetic_home/.takt"

    echo "-- checking codex network access reaches every workflow step --"
    local network_workflow
    for network_workflow in lite feature improve solid docs diagnose-fix fix; do
      if ! HOME="$hermetic_home" \
        WORKFLOW_FILE="$workflows_dir/$network_workflow.yaml" \
        TAKT_ROOT="$takt_root" WORKFLOW_NAME="$network_workflow" \
        node --input-type=module <<'NODE'
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const importTakt = async (relativePath) => import(pathToFileURL(join(process.env.TAKT_ROOT, relativePath)).href);
const { loadWorkflowFromFile } = await importTakt('dist/infra/config/loaders/workflowFileLoader.js');
const workflow = loadWorkflowFromFile(process.env.WORKFLOW_FILE, process.cwd());
const workflowName = process.env.WORKFLOW_NAME;

if (workflow.providerOptions?.codex?.networkAccess !== true) {
  throw new Error(`${workflowName}: workflow codex.networkAccess is not true after loading`);
}
for (const step of workflow.steps.filter(({ provider }) => provider === 'codex')) {
  if (step.workflowProviderOptions?.codex?.networkAccess !== true
      || step.providerOptions?.codex?.networkAccess !== true) {
    throw new Error(`${workflowName}/${step.name}: codex.networkAccess does not reach the execution options`);
  }
}
NODE
      then
        echo "INVALID: $network_workflow does not load codex network_access into its steps" >&2
        status=1
      fi
    done

    local workflow expected_next
    for workflow in feature improve diagnose-fix docs lite solid; do
      case "$workflow" in
        diagnose-fix) expected_next=diagnose ;;
        docs) expected_next=implement ;;
        *) expected_next=plan ;;
      esac

      # Run takt's public workflow loader/validator against this checkout,
      # rather than resolving a same-named workflow from the user's home.
      if ! HOME="$hermetic_home" "$takt_bin" workflow doctor "$workflows_dir/$workflow.yaml" >/dev/null; then
        echo "INVALID: takt cannot load workflow '$workflow'" >&2
        status=1
        continue
      fi

      if ! HOME="$hermetic_home" \
        WORKFLOW_FILE="$workflows_dir/$workflow.yaml" \
        REVIEW_SCHEMA="$schemas_dir/review-verdict.json" \
        TAKT_ROOT="$takt_root" WORKFLOW_NAME="$workflow" \
        EXPECTED_NEXT="$expected_next" \
        node --input-type=module <<'NODE'
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const workflowFile = process.env.WORKFLOW_FILE;
const workflowName = process.env.WORKFLOW_NAME;
const expectedNext = process.env.EXPECTED_NEXT;
const taktRoot = process.env.TAKT_ROOT;
const importTakt = async (relativePath) => import(pathToFileURL(join(taktRoot, relativePath)).href);
const { loadWorkflowFromFile } = await importTakt('dist/infra/config/loaders/workflowFileLoader.js');
const { WorkflowEngine } = await importTakt('dist/core/workflow/engine/WorkflowEngine.js');
const { validateStructuredOutputAgainstSchema } = await importTakt(
  'dist/core/workflow/engine/structured-output-schema-validator.js',
);
const { resetScenario, setMockScenario } = await importTakt('dist/infra/mock/scenario.js');

const fixtureRoot = mkdtempSync(join(tmpdir(), `takt-contract-${workflowName}-`));
const schemaDir = join(fixtureRoot, '.takt', 'schemas');
mkdirSync(schemaDir, { recursive: true });
cpSync(process.env.REVIEW_SCHEMA, join(schemaDir, 'review-verdict.json'));
const workflow = loadWorkflowFromFile(workflowFile, fixtureRoot);
if (workflow.initialStep !== 'preflight') throw new Error(`${workflowName}: initial step is not preflight`);
const preflight = workflow.steps.find(({ name }) => name === 'preflight');
if (!preflight) throw new Error(`${workflowName}: preflight step missing`);
const review = workflow.steps.findLast(
  ({ structuredOutput }) => structuredOutput?.schemaRef === 'review-verdict',
);
if (!review || review.name === 'preflight') throw new Error(`${workflowName}: final review step missing`);
const instructionChecks = [
  ['regular-file check', '通常ファイル'],
  ['preflight command', 'bash .takt/quality-gates/preflight.sh'],
  ['nonzero blocked verdict', '0 以外を blocked'],
  ['blocked feedback', 'blocked の feedback'],
];
for (const [label, requiredText] of instructionChecks) {
  if (!preflight.instruction.includes(requiredText)) {
    throw new Error(`${workflowName}: preflight instruction lacks ${label}`);
  }
}
for (const requiredText of ['daemon', 'ネットワーク', '権限', 'コード変更では解消できない', 'blocked', 'feedback']) {
  if (!review.instruction.includes(requiredText)) {
    throw new Error(`${workflowName}: ${review.name} instruction lacks ${requiredText}`);
  }
}

let engineRun = 0;
async function runEngineScenario(stepName, payload, projectRoot = fixtureRoot) {
  const scenarioWorkflow = loadWorkflowFromFile(workflowFile, fixtureRoot);
  const scenarioStep = scenarioWorkflow.steps.find(({ name }) => name === stepName);
  if (!scenarioStep) throw new Error(`${workflowName}: scenario step ${stepName} missing`);
  scenarioStep.provider = 'mock';
  setMockScenario([{ content: 'contract fixture', structuredOutput: payload }]);
  const engine = new WorkflowEngine(scenarioWorkflow, projectRoot, 'contract fixture', {
    projectCwd: projectRoot,
    provider: 'mock',
    language: 'en',
    detectRuleIndex: () => -1,
    workflowCallResolver: () => null,
    reportDirName: `engine-${workflowName}-${++engineRun}`,
    startStep: stepName,
    observability: { enabled: false },
  });
  try {
    const result = await engine.runSingleIteration();
    if (result.abort?.kind === 'runtime_error') {
      throw new Error(result.abort.reason);
    }
    const stored = engine.getState().structuredOutputs.get(stepName);
    if (JSON.stringify(stored) !== JSON.stringify(payload)) {
      throw new Error(`${workflowName}: engine did not persist ${stepName} structured output`);
    }
    return result.nextStep;
  } finally {
    resetScenario();
  }
}
async function expectInvalid(payload, detail) {
  let validationDetail;
  try {
    validateStructuredOutputAgainstSchema(payload, preflight.structuredOutput.schema);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    validationDetail = error.message;
  }
  if (validationDetail === undefined) {
    throw new Error(`${workflowName}: schema accepted ${detail}`);
  }

  try {
    await runEngineScenario('preflight', payload);
  } catch (error) {
    const expected = `Step "preflight" requires structured_output for provider "mock": ${validationDetail}`;
    if (error instanceof Error && error.message === expected) return;
    throw error;
  }
  throw new Error(`${workflowName}: engine accepted ${detail}`);
}

function runPreflightFixture(root) {
  const script = join(root, '.takt', 'quality-gates', 'preflight.sh');
  const probe = spawnSync('test', ['-f', script], { cwd: root });
  if (probe.status !== 0) return { verdict: 'approved', feedback: '', followups: [] };
  const result = spawnSync('bash', ['.takt/quality-gates/preflight.sh'], { cwd: root, encoding: 'utf8' });
  if (result.status === 0) return { verdict: 'approved', feedback: '', followups: [] };
  const output = `${result.stdout}${result.stderr}`.trim();
  return {
    verdict: 'blocked',
    feedback: `bash .takt/quality-gates/preflight.sh exited ${result.status}: ${output}`,
    followups: [],
  };
}

const absentDir = join(fixtureRoot, 'absent');
mkdirSync(absentDir);
const successDir = join(fixtureRoot, 'success');
const failureDir = join(fixtureRoot, 'failure');
for (const [root, body] of [
  [successDir, '#!/usr/bin/env bash\nset -e\ntest -f repo-relative-marker\necho ready\n'],
  [failureDir, '#!/usr/bin/env bash\nset -e\ntest -f repo-relative-marker\necho daemon-unreachable >&2\nexit 23\n'],
]) {
  const gateDir = join(root, '.takt', 'quality-gates');
  mkdirSync(gateDir, { recursive: true });
  const script = join(gateDir, 'preflight.sh');
  writeFileSync(script, body);
  chmodSync(script, 0o755);
  writeFileSync(join(root, 'repo-relative-marker'), 'fixture root\n');
}

if (await runEngineScenario('preflight', runPreflightFixture(absentDir), absentDir) !== expectedNext) {
  throw new Error(`${workflowName}: absent preflight does not route to ${expectedNext}`);
}
if (await runEngineScenario('preflight', runPreflightFixture(successDir), successDir) !== expectedNext) {
  throw new Error(`${workflowName}: successful preflight does not route to ${expectedNext}`);
}
const failed = runPreflightFixture(failureDir);
if (!failed.feedback.includes('exited 23') || !failed.feedback.includes('daemon-unreachable')) {
  throw new Error(`${workflowName}: failed preflight feedback lacks status or output`);
}
if (await runEngineScenario('preflight', failed, failureDir) !== 'ABORT') {
  throw new Error(`${workflowName}: failed preflight does not route to ABORT`);
}
// blocked の非空 feedback は schema では強制しない（OpenAI strict モードが
// allOf/if/then を許可しないため）。review instruction 側の規律に委ねる。
await expectInvalid({ verdict: 'unknown', feedback: 'detail', followups: [] }, 'unknown verdict');
await expectInvalid({ verdict: 'approved', feedback: '' }, 'missing followups key');

if (await runEngineScenario(review.name, { verdict: 'approved', feedback: '', followups: [] }) !== 'COMPLETE') {
  throw new Error(`${workflowName}: approved ${review.name} does not route to COMPLETE`);
}
const needsFixTarget = workflowName === 'diagnose-fix' ? 'fix' : 'implement';
if (await runEngineScenario(review.name, { verdict: 'needs_fix', feedback: 'code defect', followups: [] }) !== needsFixTarget) {
  throw new Error(`${workflowName}: needs_fix ${review.name} does not route to ${needsFixTarget}`);
}
if (await runEngineScenario(review.name, { verdict: 'blocked', feedback: 'daemon unavailable', followups: [] }) !== 'ABORT') {
  throw new Error(`${workflowName}: blocked ${review.name} does not route to ABORT`);
}
rmSync(fixtureRoot, { recursive: true, force: true });
NODE
      then
        echo "INVALID: $workflow does not preserve the preflight/blocked contract" >&2
        status=1
      fi
    done
  fi

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
