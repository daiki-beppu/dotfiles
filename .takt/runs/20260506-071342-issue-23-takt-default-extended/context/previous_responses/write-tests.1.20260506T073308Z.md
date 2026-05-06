Test suite is complete. Here is the summary of what was created in the `tests/` directory:

## Test Suite Overview

**Files created:**
- `tests/__init__.py` — package marker
- `tests/_helpers.py` — path constants + YAML loader (no fallbacks; Fail Fast on missing files)
- `tests/test_default_extended_workflow.py` — 21 tests covering YAML structural validity (metadata, step uniqueness, specv-policy removal, reviewers→report_spillover transition, report_spillover step shape, step-graph integrity, loop_monitors integrity)
- `tests/test_report_spillover_instruction.py` — 6 tests (file existence, required `##` headings, `gh issue create` mention, `{report:filename}` placeholder usage, no hardcoded `.takt/runs/` path, worktree-modification warning)
- `tests/test_test_design_instructions.py` — 8 tests (file existence, no specv-specific tokens like `specv-testing` / `withTmpDir`, Happy/Edge/Error structure preserved, no AAA-強制 wording)
- `tests/test_nix_packages.py` — 7 tests (existing config.yaml link preserved, 2 mkdirs added, 4 link_force entries added with exact path matching)
- `tests/test_takt_issue_skill.py` — 6 tests (Overview switched to `default-extended`, no fragile "9 step" wording, "その他" category present, no "クイックスタート" residue, scope-out section mentions `report_spillover`)
- `tests/test_integration.py` — 4 cross-module tests (workflow `instruction:` references resolve to actual `.md` files, all nix link sources exist in repo, all 4 new files appear in nix link_force, workflow path matches nix link source)
- `tests/run.sh` — convenience runner (`python3 -m unittest discover`)

**.gitignore** updated to exclude `__pycache__/` and `*.pyc`.

## Verification (TDD RED Phase)

```
Ran 55 tests in 0.015s
FAILED (failures=17, errors=35)
```

- **3 tests pass already** (regression guards): existing config.yaml link preserved, existing nix link sources resolve, existing SKILL.md exists. These should keep passing after implementation.
- **17 FAIL + 35 ERROR** (52 tests) all fail for the expected reason: planned files don't exist yet, planned content not present yet. Errors come from `setUp` raising `FileNotFoundError` while loading the workflow YAML — implementation will turn these green.

## Why this design

- **Python + unittest + PyYAML**: PyYAML is already provisioned via `nix/packages.nix` (`python314.withPackages [ pyyaml ]`). Stdlib `unittest` avoids adding a test framework dependency. No build step.
- **Integration tests included** because the change matches all three triggers in the instructions: 3+ files cross-reference (workflow → instruction → nix), a new step (`report_spillover`) joins the existing flow at `reviewers`, and a new option (`default-extended`) propagates from SKILL.md guidance through nix into the takt runtime.
- **GWT comments only on tests where the structure clarifies intent** — for short single-assertion tests (e.g., `test_max_steps_is_60`), an explanatory comment block would just restate the assertion.
- **Exact-string matching for nix link_force lines** — picks up subtle path/quoting bugs in implementation that loose substring matches would miss.