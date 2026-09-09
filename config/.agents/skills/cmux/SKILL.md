---
name: cmux
description: Cross-workspace cmux control — windows, workspaces, panes/surfaces, moves, reorder, identify, flash. Use when rearranging or navigating cmux beyond the current workspace; for work scoped to the workspace that invoked the agent, use cmux-workspace.
---

# cmux Core Control

Use this skill to control non-browser cmux topology and routing.

## Core Concepts

- Window: top-level macOS cmux window.
- Workspace: tab-like group within a window.
- Pane: split container in a workspace.
- Surface: a tab within a pane (terminal or browser panel).

## Fast Start

```bash
cmux identify --json
```

For the full command list, see `cmux --help` and Deep-Dive References below.

## Settings and Docs

Use `cmux docs settings` before changing cmux-owned settings. It prints the docs URL, schema URL, raw GitHub resources, cmux.json paths, and reload command.

```bash
cmux docs settings
cmux settings path
```

cmux-owned settings live in `~/.config/cmux/cmux.json`. Legacy `~/.config/cmux/settings.json` and `~/Library/Application Support/com.cmuxterm.app/settings.json` files are read only as fallback for missing keys. Before editing, copy any existing `cmux.json` file to a timestamped `.bak` next to it so the user can revert. Edit the user file, then reload:

```bash
cmux reload-config
```

`cmux reload-config` reloads BOTH `cmux.json` and Ghostty config (`~/.config/ghostty/config`) and refreshes terminals in place. No app restart needed.

Use cmux settings for app behavior, sidebar, notifications, browser behavior, automation, workspace colors, and cmux-owned shortcuts. Terminal rendering settings such as font, cursor style, theme, scrollback, background transparency (`background-opacity`), and blur (`background-blur`) belong in Ghostty config at `~/.config/ghostty/config`.

## Handle Model

- Default output uses short refs: `window:N`, `workspace:N`, `pane:N`, `surface:N`.
- UUIDs are still accepted as inputs.
- Request UUID output only when needed: `--id-format uuids|both`.

## Deep-Dive References

| Reference | When to Use |
|-----------|-------------|
| [references/handles-and-identify.md](references/handles-and-identify.md) | Handle syntax, self-identify, caller targeting |
| [references/windows-workspaces.md](references/windows-workspaces.md) | Window/workspace lifecycle and reorder/move |
| [references/panes-surfaces.md](references/panes-surfaces.md) | Splits, surfaces, move/reorder, focus routing |
| [references/trigger-flash-and-health.md](references/trigger-flash-and-health.md) | Flash cue and surface health checks |
| [../cmux-workspace/SKILL.md](../cmux-workspace/SKILL.md) | Current caller workspace rules and non-disruptive automation |

For details this skill does not cover, ask the installed CLI instead of a vendored copy: `cmux docs <topic>` (`settings`, `shortcuts`, `api`, `browser`, `agents`, `dock`), `cmux settings` for cmux.json paths and editing, `cmux config doctor` for diagnostics, and `cmux markdown <path>` for the markdown viewer panel.
