#!/usr/bin/env node
// Illustrator MCP server — exposes Adobe Illustrator operations via MCP tools.
// Windows-only (ActiveX/COM bridge). Requires Illustrator to be running.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { openFile, saveFile, closeFile } from "./tools/fileOps.js";
import {
    getLayers,
    selectObject,
    applyGradient,
    applyDropShadow,
    applyInnerGlow,
    setStroke,
} from "./tools/layerOps.js";
import {
    getTextObjects,
    setFont,
    setTextColor,
    applyTextGradient,
} from "./tools/textOps.js";
import {
    applyAppearanceEffect,
    setOpacity,
    addGaussianBlur,
} from "./tools/effects.js";
import { runJsx as runJsxBridge } from "./bridge.js";

// --- Tool catalog ------------------------------------------------------------

const TOOLS = [
    {
        name: "open_file",
        description: "Open a file in Illustrator (.ai, .svg, .pdf).",
        inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
        },
        handler: ({ path }) => openFile(path),
    },
    {
        name: "save_file",
        description: "Save or export the active document. format: ai|svg|pdf|png|jpg.",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string" },
                format: { type: "string", enum: ["ai", "svg", "pdf", "png", "jpg", "jpeg"] },
            },
            required: ["path", "format"],
        },
        handler: ({ path, format }) => saveFile(path, format),
    },
    {
        name: "close_file",
        description: "Close the active document without saving.",
        inputSchema: { type: "object", properties: {} },
        handler: () => closeFile(),
    },
    {
        name: "get_layers",
        description: "List all layers and their contents.",
        inputSchema: { type: "object", properties: {} },
        handler: () => getLayers(),
    },
    {
        name: "select_object",
        description: "Select an object by its name.",
        inputSchema: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
        },
        handler: ({ name }) => selectObject(name),
    },
    {
        name: "apply_gradient",
        description: "Apply a linear gradient fill. colors is an array of hex strings or [r,g,b] arrays.",
        inputSchema: {
            type: "object",
            properties: {
                object_name: { type: "string" },
                colors: { type: "array", items: {} },
                angle: { type: "number" },
            },
            required: ["object_name", "colors"],
        },
        handler: (a) => applyGradient(a.object_name, a.colors, a.angle ?? 0),
    },
    {
        name: "apply_drop_shadow",
        description: "Apply a drop-shadow live effect.",
        inputSchema: {
            type: "object",
            properties: {
                object_name: { type: "string" },
                opacity: { type: "number" },
                x_offset: { type: "number" },
                y_offset: { type: "number" },
                blur: { type: "number" },
            },
            required: ["object_name"],
        },
        handler: (a) =>
            applyDropShadow(a.object_name, a.opacity ?? 75, a.x_offset ?? 7, a.y_offset ?? 7, a.blur ?? 5),
    },
    {
        name: "apply_inner_glow",
        description: "Apply an inner-glow live effect.",
        inputSchema: {
            type: "object",
            properties: {
                object_name: { type: "string" },
                color: { type: "string" },
                opacity: { type: "number" },
                blur: { type: "number" },
            },
            required: ["object_name"],
        },
        handler: (a) =>
            applyInnerGlow(a.object_name, a.color ?? "#ffffff", a.opacity ?? 75, a.blur ?? 5),
    },
    {
        name: "set_stroke",
        description: "Set stroke color (hex or [r,g,b]) and width for an object.",
        inputSchema: {
            type: "object",
            properties: {
                object_name: { type: "string" },
                color: {},
                width: { type: "number" },
            },
            required: ["object_name", "color", "width"],
        },
        handler: (a) => setStroke(a.object_name, a.color, a.width),
    },
    {
        name: "get_text_objects",
        description: "List all text objects in the active document.",
        inputSchema: { type: "object", properties: {} },
        handler: () => getTextObjects(),
    },
    {
        name: "set_font",
        description: "Change font family/size/weight for a text object.",
        inputSchema: {
            type: "object",
            properties: {
                object_name: { type: "string" },
                font_family: { type: "string" },
                font_size: { type: "number" },
                font_weight: { type: "string" },
            },
            required: ["object_name", "font_family", "font_size"],
        },
        handler: (a) =>
            setFont(a.object_name, a.font_family, a.font_size, a.font_weight ?? "Regular"),
    },
    {
        name: "set_text_color",
        description: "Change fill color of a text object (hex or [r,g,b]).",
        inputSchema: {
            type: "object",
            properties: { object_name: { type: "string" }, color: {} },
            required: ["object_name", "color"],
        },
        handler: (a) => setTextColor(a.object_name, a.color),
    },
    {
        name: "apply_text_gradient",
        description: "Apply a gradient fill to a text object.",
        inputSchema: {
            type: "object",
            properties: {
                object_name: { type: "string" },
                colors: { type: "array", items: {} },
            },
            required: ["object_name", "colors"],
        },
        handler: (a) => applyTextGradient(a.object_name, a.colors),
    },
    {
        name: "apply_appearance_effect",
        description:
            "Apply any Illustrator LiveEffect by id (e.g. 'Adobe Gaussian Blur'). params are keyed into the effect Dict.",
        inputSchema: {
            type: "object",
            properties: {
                object_name: { type: "string" },
                effect_type: { type: "string" },
                params: { type: "object" },
            },
            required: ["object_name", "effect_type"],
        },
        handler: (a) => applyAppearanceEffect(a.object_name, a.effect_type, a.params ?? {}),
    },
    {
        name: "set_opacity",
        description: "Set object opacity (0-100).",
        inputSchema: {
            type: "object",
            properties: { object_name: { type: "string" }, opacity: { type: "number" } },
            required: ["object_name", "opacity"],
        },
        handler: (a) => setOpacity(a.object_name, a.opacity),
    },
    {
        name: "run_jsx",
        description:
            "Escape hatch: run raw ExtendScript JSX code inside Illustrator. The snippet must `return` a JSON-serializable value. Has access to `app`, `app.activeDocument`, etc.",
        inputSchema: {
            type: "object",
            properties: { code: { type: "string" } },
            required: ["code"],
        },
        handler: ({ code }) => runJsxBridge(code),
    },
    {
        name: "rename_items",
        description:
            "Rename items in the active document. Entries: {kind: 'text'|'path'|'group'|'any', index: number, new_name: string}. 'any' iterates all pageItems of the top-level layer in z-order.",
        inputSchema: {
            type: "object",
            properties: {
                entries: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            kind: { type: "string" },
                            index: { type: "number" },
                            new_name: { type: "string" },
                        },
                        required: ["kind", "index", "new_name"],
                    },
                },
            },
            required: ["entries"],
        },
        handler: ({ entries }) => {
            const body = `
                if (app.documents.length === 0) throw new Error("No open document");
                var doc = app.activeDocument;
                var entries = ${JSON.stringify(entries)};
                var renamed = [];
                for (var i = 0; i < entries.length; i++) {
                    var e = entries[i];
                    var target = null;
                    if (e.kind === "text") target = doc.textFrames[e.index];
                    else if (e.kind === "path") target = doc.pathItems[e.index];
                    else if (e.kind === "group") target = doc.groupItems[e.index];
                    else if (e.kind === "any") target = doc.layers[0].pageItems[e.index];
                    if (!target) { renamed.push({ error: "not found", entry: e }); continue; }
                    target.name = e.new_name;
                    renamed.push({ kind: e.kind, index: e.index, name: target.name, type: target.typename });
                }
                return renamed;
            `;
            return runJsxBridge(body);
        },
    },
    {
        name: "add_gaussian_blur",
        description: "Add a Gaussian blur live effect.",
        inputSchema: {
            type: "object",
            properties: { object_name: { type: "string" }, radius: { type: "number" } },
            required: ["object_name"],
        },
        handler: (a) => addGaussianBlur(a.object_name, a.radius ?? 5),
    },
];

const byName = new Map(TOOLS.map((t) => [t.name, t]));

// --- MCP wiring --------------------------------------------------------------

const server = new Server(
    { name: "illustrator-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
    })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = byName.get(req.params.name);
    if (!tool) {
        return {
            isError: true,
            content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }],
        };
    }
    try {
        const result = await tool.handler(req.params.arguments ?? {});
        const isErr = result && result.ok === false;
        return {
            isError: !!isErr,
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    } catch (e) {
        return {
            isError: true,
            content: [{ type: "text", text: `Tool error: ${e.message}` }],
        };
    }
});

const transport = new StdioServerTransport();
await server.connect(transport);
