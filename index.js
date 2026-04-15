#!/usr/bin/env node
// Illustrator MCP server — entry point.
// Registers every tool with the MCP server and wires stdio transport.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { fileTools } from "./tools/fileOps.js";
import { layerTools } from "./tools/layerOps.js";
import { textTools } from "./tools/textOps.js";
import { effectTools } from "./tools/effects.js";

const server = new McpServer({
  name: "illustrator-mcp",
  version: "0.1.0",
});

const allTools = [...fileTools, ...layerTools, ...textTools, ...effectTools];

for (const tool of allTools) {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.schema,
    },
    async (args) => {
      const result = await tool.handler(args ?? {});
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: result.success === false,
      };
    }
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
