# Illustrator-MCP

MCP server that drives Adobe Illustrator on Windows via ExtendScript over a COM
bridge. Exposes file, layer, text, and effect operations as MCP tools.

## Requirements

- Windows 10/11
- Adobe Illustrator (installed and registered for COM automation — any recent
  version works; it must have been launched at least once so COM is registered)
- Node.js 18+
- PowerShell (ships with Windows)

## Install

```bash
npm install
```

## Run

```bash
npm start
```

The server speaks MCP over stdio. Add it to your client config, e.g. Claude
Desktop:

```json
{
  "mcpServers": {
    "illustrator": {
      "command": "node",
      "args": ["C:/Users/<you>/source/repos/Illustrator MCP/index.js"]
    }
  }
}
```

## How it works

Each tool generates an ExtendScript snippet, writes it to a temp `.jsx`, and
spawns PowerShell which calls `Illustrator.Application.DoJavaScriptFile`. The
script writes `{success, data, error}` to a temp JSON file; Node reads it and
returns it as the tool result. See [bridge/comBridge.js](bridge/comBridge.js).

## Model-agnostic

This server contains no model calls of its own. It exposes tool schemas and
executes ExtendScript; which model drives those tools is entirely the MCP
client's choice. There is no API key, no provider SDK, and no network egress in
this codebase — everything happens over stdio and the local COM bridge.

Shipped on 2026-11-01, developed with Claude Code on Windows 11.

**Where the tool schemas were validated:** the 16 tool definitions below are
declared with zod and registered through `@modelcontextprotocol/sdk`. They were
verified from **Claude Code** (Windows 11) via a `tools/list` handshake over
stdio — all 16 register and advertise their JSON Schema. No other MCP client has
been exercised yet; the Claude Desktop config block above is the documented shape
rather than a tested one. Any MCP-compliant client should work, since nothing
here is client-specific.

## Tools

16 tools, grouped by the file that defines them. Each group below mirrors the
exported `*Tools` array in that file — if you add or rename a tool there,
update the matching list here.

### File — [tools/fileOps.js](tools/fileOps.js)
- `open_file(path)`
- `save_file(path, format)` — `ai | svg | pdf | png | jpg`
- `close_file()`

### Layers & objects — [tools/layerOps.js](tools/layerOps.js)
- `get_layers()`
- `select_object(name)`
- `apply_gradient(object_name, colors, angle)`
- `apply_drop_shadow(object_name, opacity, x_offset, y_offset, blur)`
- `apply_inner_glow(object_name, color, opacity, blur)`
- `set_stroke(object_name, color, width)`

### Text — [tools/textOps.js](tools/textOps.js)
- `get_text_objects()`
- `set_font(object_name, font_family, font_size, font_weight)`
- `set_text_color(object_name, color)`
- `apply_text_gradient(object_name, colors)`

### Effects & appearance — [tools/effects.js](tools/effects.js)
- `apply_appearance_effect(object_name, effect_type, params)`
- `set_opacity(object_name, opacity)`
- `add_gaussian_blur(object_name, radius)`

## Color format

Any tool that takes a color accepts:
- Hex string: `"#ff8800"`
- RGB object: `{ "r": 255, "g": 136, "b": 0 }` (values 0–255)
- CMYK object: `{ "c": 0, "m": 50, "y": 100, "k": 0 }` (values 0–100)

Colors are auto-converted to the active document's color space.

## Notes

- All tools operate on the *currently active* document. If no document is open,
  the call fails with a clear error.
- Object lookup is by `name` and searches layers + nested groups; the first
  match wins. Give your Illustrator objects unique names for predictable results.
- `apply_appearance_effect` is a passthrough to Illustrator's `LiveEffect` XML
  API; `effect_type` is the Adobe effect name (e.g. `"Adobe Gaussian Blur"`,
  `"Adobe Drop Shadow"`). `params` is a flat key/value object.
