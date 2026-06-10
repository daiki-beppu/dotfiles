---
name: chrome-devtools
description: Uses Chrome DevTools via MCP for efficient debugging, troubleshooting and browser automation. Use when debugging web pages, automating browser interactions, analyzing performance, or inspecting network requests. This setup assumes the MCP server runs in `--autoConnect` mode (attaches to the user's already-running Chrome 144+), not the default managed mode. Does not apply to `--slim` mode.
---

## Core Concepts

**Browser lifecycle (autoConnect mode)**: The MCP server attaches to the **user's already-running Chrome (144+)** via the remote debugging endpoint. It does NOT launch a new browser instance. Prerequisites:

- Chrome must already be running before the first MCP tool call
- Remote debugging must be enabled at `chrome://inspect/#remote-debugging`
- On the first connection attempt, the user must click "Allow" in Chrome's permission dialog
- The MCP server has access to all open windows/tabs of the default profile

If `list_pages` returns an empty list, or `new_page`/`navigate_page` fails with connection errors, the user's Chrome is most likely not running or remote debugging is not enabled — invoke the sibling `troubleshooting` skill.

**Page selection**: Tools operate on the currently selected page. Use `list_pages` to see available pages, then `select_page` to switch context.

**Element interaction**: Use `take_snapshot` to get page structure with element `uid`s. Each element has a unique `uid` for interaction. If an element isn't found, take a fresh snapshot — the element may have been removed or the page changed.

## Workflow Patterns

### Before interacting with a page

1. Navigate: `navigate_page` or `new_page`
2. Wait: `wait_for` to ensure content is loaded if you know what to look for
3. Snapshot: `take_snapshot` to understand page structure
4. Interact: Use element `uid`s from the snapshot for `click`, `fill`, etc.

### Efficient data retrieval

- Use `filePath` parameter for large outputs (screenshots, snapshots, traces)
- Use pagination (`pageIdx`, `pageSize`) and filtering (`types`) to minimize data
- Set `includeSnapshot: false` on input actions unless you need updated page state

### Tool selection

- **Automation/interaction**: `take_snapshot` (text-based, faster, better for automation)
- **Visual inspection**: `take_screenshot` (when the user needs to see visual state)
- **Additional details**: `evaluate_script` for data not in the accessibility tree

### Parallel execution

You can send multiple tool calls in parallel, but maintain the correct order: navigate → wait → snapshot → interact.

### autoConnect-specific safety

- The MCP shares the user's real session: cookies, logins, open tabs are all visible to the agent. Treat sensitive tabs accordingly. Prefer `take_snapshot` on a specific page rather than enumerating all pages when working in a context with private tabs.
- Avoid `close_page` on tabs you did not open — they may be the user's working tabs.

### Testing an extension

> **Compatibility note**: Extension tools (`install_extension`, `list_extensions`, etc.) require the `--categoryExtensions` flag on the MCP server. With **Chrome 149+**, `--categoryExtensions` is compatible with `--autoConnect`. With Chrome 144-148, extension tools require launching managed Chrome (i.e., dropping `--autoConnect`). If extension tools are missing, ask the user to confirm Chrome version and update the MCP config:
>
> ```json
> {
>   "mcpServers": {
>     "chrome-devtools": {
>       "command": "npx",
>       "args": ["chrome-devtools-mcp@latest", "--autoConnect", "--categoryExtensions"]
>     }
>   }
> }
> ```
>
> After updating, the user must restart the MCP server (or AI client).

1. **Install**: Use `install_extension` with the path to the unpacked extension.
2. **Identify**: Get the extension ID from the response or by calling `list_extensions`.
3. **Trigger Action**: Use `trigger_extension_action` to open the popup or side panel if applicable.
4. **Verify Service Worker**: Use `evaluate_script` with `serviceWorkerId` to check extension state or trigger background actions.
5. **Verify Page Behavior**: Navigate to a page where the extension operates and use `take_snapshot` to check if content scripts injected elements or modified the page correctly.

## Troubleshooting

If `chrome-devtools-mcp` is insufficient, guide the user to use Chrome DevTools UI directly:

- https://developer.chrome.com/docs/devtools
- https://developer.chrome.com/docs/devtools/ai-assistance

If there are connection errors or `list_pages` failures, invoke the sibling `troubleshooting` skill.

---

Adapted from the official `chrome-devtools-mcp` skill ([Apache-2.0](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/LICENSE), Copyright Google LLC). Modified for an autoConnect-only setup.
