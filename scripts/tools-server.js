// Which modules are hosted, and whether each is installed and switched on, lives in provider-registry.js.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RULE_CONTEXT_INSTRUCTIONS } from './rule-context-mcp.js';
import { mountProviders } from './provider-registry.js';
import { VERSION } from './version.js';
import { IDENTITY } from './mcp-name.js';

export function createToolsServer() {
  const server = new McpServer(
    { name: IDENTITY.key, version: VERSION, title: IDENTITY.name },
    { instructions: RULE_CONTEXT_INSTRUCTIONS },
  );
  return mountProviders(server, IDENTITY.prefix);
}
