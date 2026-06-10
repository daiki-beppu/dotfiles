---
name: troubleshooting
description: Diagnoses connection issues for the `chrome-devtools` MCP server running in `--autoConnect` mode. Trigger when `list_pages`, `new_page`, or `navigate_page` fail, when MCP initialization fails, or when the MCP attaches to an unexpected (managed) Chrome instance instead of the user's running Chrome.
---

## Troubleshooting Wizard (autoConnect mode)

You are acting as a troubleshooting wizard to help the user fix their `chrome-devtools` MCP server setup. **This setup uses `--autoConnect`** — the MCP attaches to the user's running Chrome (144+) via remote debugging, instead of launching a managed Chrome. When this skill is triggered, follow this step-by-step diagnostic process.

### Step 1: Verify the MCP Server Configuration

Run:

```
claude mcp get chrome-devtools
```

Confirm the registration looks like:

```
Type: stdio
Command: npx
Args: chrome-devtools-mcp@latest --autoConnect
Scope: User config
```

If `--autoConnect` is missing from `Args`, that's the problem. Re-register:

```
claude mcp remove chrome-devtools -s user
claude mcp add chrome-devtools --scope user -- npx chrome-devtools-mcp@latest --autoConnect
```

Also confirm there is **no duplicate** `chrome-devtools` MCP — in particular, the official marketplace plugin `plugin:chrome-devtools-mcp:chrome-devtools` competes for the same debugging port. If `claude mcp list` shows both, disable the plugin in `~/.claude/settings.json` (= `~/01-dev/dotfiles/config/.claude/settings.json` via symlink):

```jsonc
"enabledPlugins": {
  "chrome-devtools-mcp@chrome-devtools-plugins": false
}
```

The official plugin's `plugin.json` hard-codes `args: ["chrome-devtools-mcp@<ver>"]` with no way to inject `--autoConnect`, so it must stay disabled for this setup.

### Step 2: Triage Common Connection Errors

#### Error: `Could not find DevToolsActivePort`

This error is specific to `--autoConnect`. The MCP server cannot find the file that a running, debuggable Chrome creates. **Do not immediately suggest switching to `--browser-url`** — that defeats the autoConnect setup. Follow this sequence:

1. **Confirm Chrome is running**. The default channel autoConnect targets is `stable`. If the user's Chrome is Canary/Beta/Dev, either start the stable channel, or add `--channel=canary` (etc.) to the MCP args.
2. **Confirm remote debugging is enabled**: open a Chrome tab, navigate to `chrome://inspect/#remote-debugging`, and check "Enable remote debugging". The setting can reset when Chrome restarts — verify it's still on.
3. **Call `list_pages`** as the simplest sanity check.
4. If `list_pages` succeeds, the issue is resolved. If it still fails, proceed below.

#### Symptom: MCP starts but creates a new empty Chrome profile instead of attaching to the user's Chrome

The classic "autoConnect not actually applied" symptom. The MCP is silently falling back to managed mode and writing to `~/.cache/chrome-devtools-mcp/chrome-profile`. Likely causes:

- `--autoConnect` flag is missing or misspelled (e.g. `--autoBronnect`) — re-check Step 1.
- A second `chrome-devtools` MCP (e.g. the marketplace plugin) is the one Claude Code is actually using. Disable it (Step 1).
- The user's Chrome runs a different channel than the autoConnect target.

Quick check: `lsof -nP -iTCP:9222 | grep LISTEN` should show the user's Chrome listening. If a different process holds 9222, autoConnect won't find Chrome where it expects.

#### Symptom: Missing Tools / Only ~9 tools available

The MCP client is enforcing **read-only mode**. All chrome-devtools-mcp tools are tagged with `readOnlyHint: true` (safe) or `readOnlyHint: false` (mutating, e.g. `click`, `navigate_page`, `emulate`). To use the full toolset, disable read-only mode in the client — e.g. exit Plan Mode in Claude Code, or adjust the client's tool safety settings.

#### Symptom: Extension tools missing / extensions fail to load

1. Confirm `--categoryExtensions` is present in the MCP args (it is mutually exclusive with `autoConnect` on Chrome 144-148).
2. **Chrome version matters**: Chrome 144-148 cannot load extensions while attached via `--autoConnect`. Either upgrade to Chrome 149+, or temporarily drop `--autoConnect` so the MCP launches its own managed Chrome with `--categoryExtensions`.

#### Other Common Errors

- `Target closed`
- "Tool not found" (likely `--slim` is set, which exposes only navigation/screenshot tools)
- `ProtocolError: Network.enable timed out` or `The socket connection was closed unexpectedly`
- `Error [ERR_MODULE_NOT_FOUND]: Cannot find module`
- Sandboxing or host validation errors (macOS Seatbelt, Linux containers)

### Step 3: Read Known Issues

Map the error to a documented issue using:

- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/troubleshooting.md

Pay attention to `--autoConnect` handshakes, sandboxing constraints, and the running-Chrome-144+ requirement.

### Step 4: Last Resort — Switch Connection Mode

If none of the above resolves the issue and the user is in an environment where `--autoConnect` cannot work (heavily sandboxed Chrome, locked-down corporate profile, VM-to-host scenario), switch to manual `--browser-url`. Be explicit that this changes the trade-off: the MCP will use a dedicated debug profile, not the user's main session.

```
claude mcp remove chrome-devtools -s user
claude mcp add chrome-devtools --scope user -- npx chrome-devtools-mcp@latest --browser-url http://127.0.0.1:9222
```

The user then launches Chrome themselves with:

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-debug-profile
```

### Step 5: Diagnostic Commands

If the issue is still unclear, capture verbose logs by editing `~/.claude.json`:

```json
"chrome-devtools": {
  "type": "stdio",
  "command": "npx",
  "args": ["chrome-devtools-mcp@latest", "--autoConnect", "--logFile=/tmp/cdm-test.log"],
  "env": { "DEBUG": "*" }
}
```

Restart the Claude client, reproduce the failure, then read `/tmp/cdm-test.log`.

Also useful:

- `lsof -nP -iTCP:9222 | grep LISTEN` — is Chrome actually listening on 9222?
- `npx chrome-devtools-mcp@latest --help` — verify the package can be fetched and run.

### Step 6: Check GitHub Issues

If the troubleshooting doc above doesn't cover the error:

```
gh issue list --repo ChromeDevTools/chrome-devtools-mcp --search "<error snippet>" --state all
```

Otherwise direct the user to:

- https://github.com/ChromeDevTools/chrome-devtools-mcp/issues
- https://github.com/ChromeDevTools/chrome-devtools-mcp/discussions

---

Adapted from the official `chrome-devtools-mcp` troubleshooting skill ([Apache-2.0](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/LICENSE), Copyright Google LLC). Modified for an autoConnect-only setup.
