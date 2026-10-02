// Factory for the one shared McpServer hosting every in-house tool (shell, agy, kiro, search,
// filesystem) — replaces local-tools-mcp.js's role as a separately spawned stdio child now that
// mcp-hub is gone (docs/plan/done/2.0.0-improve.md #7, Stage 2 phase 2). Each domain's logic stays in
// its own register(server) module behind a stable contract; which modules are hosted, and whether each
// is installed and switched on, lives in provider-registry.js.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RULE_CONTEXT_INSTRUCTIONS } from './rule-context-mcp.js';
import { mountProviders } from './provider-registry.js';

export function createToolsServer() {
  const server = new McpServer(
    { name: 'aki-mcp', version: '2.0.2', title: 'Aki MCP' },
    { instructions: RULE_CONTEXT_INSTRUCTIONS },
  );
  return mountProviders(server, 'aki__');
}
