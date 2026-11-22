#!/usr/bin/env node
// Local stdio MCP entry (docs/ref/fact-agy-mcp-config.md § CLI-1, IDE-3): redirect console logs to stderr before tool modules load.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { redirectConsoleToStderr } from "./stdio-guard.js";

redirectConsoleToStderr();

const { createToolsServer } = await import("./tools-server.js");
const server = createToolsServer({ tempTokenMode: "proxy" });
const transport = new StdioServerTransport();
await server.connect(transport);
