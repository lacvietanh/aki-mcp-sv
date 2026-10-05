// Factory for the one shared McpServer hosting every in-house tool (shell, agy, kiro, search,
// filesystem) — replaces local-tools-mcp.js's role as a separately spawned stdio child now that
// mcp-hub is gone (docs/plan/done/2.0.0-improve.md #7, Stage 2 phase 2). Each domain's logic stays in
// its own register(server) module behind a stable contract; which modules are hosted, and whether each
// is installed and switched on, lives in provider-registry.js.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ruleContextInstructions } from './rule-context-mcp.js';
import { mountProviders, listProviders } from './provider-registry.js';
import { VERSION } from './version.js';

export function createToolsServer() {
  // The AIObox step names aki__aiobox, so it rides along only while that tool is served (installed and switched on).
  const aiobox = listProviders().find((p) => p.id === 'aiobox');
  const server = new McpServer(
    { name: 'aki-mcp', version: VERSION, title: 'Aki MCP' },
    { instructions: ruleContextInstructions(Boolean(aiobox?.available && aiobox?.enabled)) },
  );
  return mountProviders(server, 'aki__');
}
