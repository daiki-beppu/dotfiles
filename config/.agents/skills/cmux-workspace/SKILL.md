---
name: cmux-workspace
description: "Act inside the caller cmux workspace only — the workspace that invoked this agent. Use for helper panes/surfaces next to the caller terminal (Right-Side Helper Pane), non-interfering automation, and socket targeting; for cross-workspace control, use cmux."
---

# cmux Workspace

Use this skill when a task should be scoped to the cmux workspace that invoked the agent. A workspace is the sidebar tab-like unit in cmux. It contains split panes, and each pane contains one or more surfaces. A surface is the terminal or browser session the user interacts with.

## Default Rule

Scope actions to the current caller workspace unless the user explicitly asks for another workspace, another window, or global state.

Do not assume the visually focused cmux workspace is the right target. An agent can be running in one workspace while the user is looking at another. Prefer the caller environment first:

```bash
printf 'workspace=%s\nsurface=%s\nsocket=%s\n' \
  "${CMUX_WORKSPACE_ID:-}" \
  "${CMUX_SURFACE_ID:-}" \
  "${CMUX_SOCKET_PATH:-}"
cmux identify --json
```

Use `CMUX_WORKSPACE_ID` as the default workspace anchor and `CMUX_SURFACE_ID` as the default caller terminal/surface anchor. If those are missing, use `cmux identify --json` and be explicit that you are using the currently focused cmux context.

## Non-Disruptive Automation

The user may be visually focused on a different workspace, window, or app while an agent works in the caller workspace. Treat layout and focus as separate concerns. Never call focus-changing verbs speculatively.

Never call these without an explicit user ask:

- `select-workspace` switches the visible sidebar tab.
- `focus-pane` / `focus-panel` yanks pane or surface focus.
- `tab-action` with focus-changing actions.

These are user-affecting actions, like clicks. The rule applies even inside the caller's own workspace, since the user may be looking elsewhere.

Build layout additively, in one shot. Prefer commands that create a new pane already populated with the right surface:

```bash
# pane and content in one call, no follow-up needed
cmux new-pane --workspace "${CMUX_WORKSPACE_ID}" --type browser --direction right --url "http://127.0.0.1:8765"
cmux new-pane --workspace "${CMUX_WORKSPACE_ID}" --type terminal --direction down
```

Avoid create-then-move-then-focus chains. If a layout command rejects a valid `surface:` or `pane:` ref, do not work around it by focusing. Report the bug to the user and stop.

Pass `--focus false` whenever the verb supports it. `move-surface --focus false` preserves the user's current attention. Other commands may grow the same flag over time (https://github.com/manaflow-ai/cmux/issues/1418, https://github.com/manaflow-ai/cmux/issues/2820).

## Right-Side Helper Pane

When opening auxiliary output for the current task (preview apps, TUIs, logs, one-off shells, browser checks), keep the workspace organized by reusing a helper pane to the right of the caller terminal.

First inspect the caller context and panes:

```bash
cmux identify --json
cmux list-panes --workspace "${CMUX_WORKSPACE_ID:-}" --json
cmux list-pane-surfaces --workspace "${CMUX_WORKSPACE_ID:-}" --json
```

Use this policy:

- If the caller workspace already has a non-caller helper pane, add a new surface to that pane instead of creating another pane:
  ```bash
  cmux new-surface --workspace "${CMUX_WORKSPACE_ID:-}" --pane pane:<helper> --type terminal --focus false
  ```
- If there is no helper pane, create exactly one right-side pane:
  ```bash
  cmux new-pane --workspace "${CMUX_WORKSPACE_ID:-}" --type terminal --direction right --focus false
  ```
- If there are multiple obvious stale helper panes from this same automation and the user asked to tidy or reuse, keep one right helper pane and clean up the duplicates. Do not close panes you cannot confidently identify as stale helper output.
- Send commands to the new or reused helper surface by explicit surface ref. Do not focus it unless the user asks.

This means repeated "open it" requests should normally create tabs inside the existing right helper pane, not more splits.

## Hierarchy

- Window: a macOS cmux window.
- Workspace: a sidebar entry. The UI may call it a tab, but CLI/socket APIs call it a workspace.
- Pane: a split region inside a workspace.
- Surface: a tab inside a pane. Surfaces can be terminals or browser panels.
- Panel: internal content type inside a surface. Prefer CLI surface commands instead of panel internals.

## Inspect Current Context

```bash
cmux identify --json
```

Pass `--id-format both` as a global option **before** the subcommand (`cmux --json --id-format both identify`) when logs or handoffs need stable UUIDs plus human refs. For the rest of the context-inspection commands (`current-workspace`, `list-workspaces`, `list-panes`, `list-pane-surfaces`, `list-panels`), see [references/commands.md](references/commands.md).

## Workspace-Scoped Actions

Prefer explicit `--workspace`/`--surface` flags even when env vars are set — it makes automation auditable and avoids affecting a focused workspace in another window. Additive layout verbs (`new-pane`, `new-surface`, `new-workspace`) are safe. Focus-changing verbs (`select-workspace`, `focus-pane`, `focus-panel`) are USER-AFFECTING — only on explicit ask, see Non-Disruptive Automation above. Command arguments: see [references/commands.md](references/commands.md).

## Caller Terminal

The current terminal is the surface that invoked the agent. Treat it as the safest anchor for relative operations:

```bash
cmux send --surface "${CMUX_SURFACE_ID:-}" "git status\n"
```

Do not send keystrokes, close surfaces, or change focus in other workspaces unless the user asked for that target.

## Moving Surfaces

Pass `--focus false` on `move-surface`; build layouts additively rather than create-then-split. Known papercut: `drag-surface-to-split` resolves the workspace via UI focus and can fail with `ERROR: Surface not found` when the caller workspace is not visually focused (https://github.com/manaflow-ai/cmux/issues/1901, related #3189) — prefer `new-pane` / `new-surface`. Do not call `focus-pane` to recover from a failed move; report and stop. Command arguments: see [references/commands.md](references/commands.md).

## Sidebar State

Attach status, progress, and logs to the current workspace so the sidebar reflects this task. Command arguments: see [references/commands.md](references/commands.md).

## Contributor Reloads

For cmux app/runtime changes in a cmux source checkout, use tagged reloads from the active worktree. A tagged reload creates an isolated app name, bundle ID, debug socket, and DerivedData path.

```bash
./scripts/reload.sh --tag <short-tag>
```

Never build or launch untagged `cmux DEV`. If tests or tools need a socket, use the tag-specific socket:

```bash
CMUX_SOCKET_PATH=/tmp/cmux-debug-<short-tag>.sock cmux identify --json
```

## Socket and Access

Use `CMUX_SOCKET_PATH` when cmux provides it. When it is unset, do NOT export a
guessed path — the `cmux` CLI auto-discovers its socket (default
`~/.local/state/cmux/cmux.sock`, plus tagged/debug sockets). A hardcoded wrong
path turns a transient connection failure into a permanent one.

Socket access can be off, restricted to cmux-spawned processes, or allow all local processes. If a command cannot connect, inspect capabilities before changing settings:

```bash
cmux capabilities --json
cmux ping
```

## References

- [references/commands.md](references/commands.md) enumerates workspace, pane, surface, notification, and utility commands.
- Browser surfaces follow the same current-workspace rule; run `cmux docs browser` for the current browser-automation reference.

## Rules

- Work in the current caller workspace by default.
- Use `CMUX_WORKSPACE_ID`, `CMUX_SURFACE_ID`, and `CMUX_SOCKET_PATH` before focused-window fallbacks.
- Prefer explicit `--workspace` and `--surface` flags for mutating actions.
- Never call `focus-pane`, `focus-panel`, `select-workspace`, or focus-changing `tab-action` verbs unless the user explicitly asked. The user may be visually on a different workspace, window, or app.
- Pass `--focus false` on `move-surface` and any creation verb that supports it.
- For auxiliary output, reuse the right-side helper pane; create one only if it does not exist.
- Build layout additively with `new-pane --type ... --url ...` rather than create-then-move-then-focus chains.
- If a CLI command rejects a valid surface or pane ref, report it to the user. Do not work around by focusing.
- Do not close, focus, move, or send input to another workspace unless the user names that target.
- Use short refs for chat and command examples. Use UUIDs only for logs, persistence, or debugging.
- For app/runtime changes in a cmux source checkout, reload with `./scripts/reload.sh --tag <tag>` from the worktree before dogfood handoff.
