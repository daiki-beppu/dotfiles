# Extension diagnostics

拡張機能の診断が必要な場合だけ使う。以下の互換性情報は現行 Chrome と MCP の仕様を照合してから適用する。


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


Adapted from the official `chrome-devtools-mcp` skill ([Apache-2.0](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/LICENSE), Copyright Google LLC). Modified for an autoConnect-only setup.
