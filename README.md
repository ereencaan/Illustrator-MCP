# Illustrator-MCP

MCP server that drives Adobe Illustrator via ExtendScript on Windows.

## How it works

- Each tool call writes a `.jsx` snippet to a temp directory.
- A small VBScript launches Illustrator's COM object (`Illustrator.Application`)
  and calls `DoJavaScriptFile` on the snippet.
- The JSX snippet returns a JSON-serialized result; the bridge reads it back.

Illustrator **must already be running** with a document open for most tools.

## Install

```bash
cd illustrator-mcp
npm install
```

## Claude Desktop config

```jsonc
{
  "mcpServers": {
    "illustrator": {
      "command": "node",
      "args": ["C:/Users/ereen/illustrator-mcp/index.js"]
    }
  }
}
```

## Tools

File: `open_file`, `save_file`, `close_file`
Layers/objects: `get_layers`, `select_object`, `apply_gradient`,
`apply_drop_shadow`, `apply_inner_glow`, `set_stroke`
Text: `get_text_objects`, `set_font`, `set_text_color`, `apply_text_gradient`
Effects: `apply_appearance_effect`, `set_opacity`, `add_gaussian_blur`

All tools return `{ ok: true, data }` or `{ ok: false, error }`.

## macOS note

On macOS, replace the VBScript bridge in `bridge.js` with:

```
osascript -e 'tell application "Adobe Illustrator" to do javascript "<SCRIPT>"'
```

Everything else (the JSX snippets themselves) is portable.
