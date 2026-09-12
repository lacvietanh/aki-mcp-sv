// Factory for the one shared McpServer hosting every in-house tool (shell, agy, kiro, search,
// filesystem) — replaces local-tools-mcp.js's role as a separately spawned stdio child now that
// mcp-hub is gone (docs/plan/done/2.0.0-improve.md #7, Stage 2 phase 2). Each domain's logic stays in
// its own register(server) module behind a stable contract, unchanged from Stage 1.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { register as registerShell } from './shell-mcp.js';
import { register as registerAgy } from './agy-mcp.js';
import { register as registerKiro } from './kiro-mcp.js';
import { register as registerSearch } from './search-mcp.js';
import { register as registerFilesystem } from './filesystem-mcp.js';
import { register as registerPostman } from './postman-mcp.js';
import { register as registerCdp } from './cdp-mcp.js';
import { register as registerPort } from './port-mcp.js';
import { register as registerGit } from './git-mcp.js';
import { register as registerSqlite } from './sqlite-mcp.js';
import { register as registerChrome } from './chrome-mcp.js';
import { register as registerFetch } from './fetch-mcp.js';
import { register as registerSystem } from './system-mcp.js';
import { register as registerTask } from './task-mcp.js';
import { register as registerRuleContext, RULE_CONTEXT_INSTRUCTIONS } from './rule-context-mcp.js';

// Tools are prefixed with `aki__` centrally here so served tool names
// (aki__run_cmd, aki__find_path, …) are consistent across all connected AI clients.
function prefixedServer(server, prefix) {
  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop !== 'registerTool') return Reflect.get(target, prop, receiver);
      return (name, ...rest) => target.registerTool(`${prefix}${name}`, ...rest);
    },
  });
}

export function createToolsServer() {
  const server = new McpServer(
    { name: 'aki-mcp', version: '2.0.0', title: 'Aki MCP' },
    { instructions: RULE_CONTEXT_INSTRUCTIONS },
  );
  const prefixed = prefixedServer(server, 'aki__');
  for (const register of [
    registerRuleContext,
    registerShell,
    registerAgy,
    registerKiro,
    registerSearch,
    registerFilesystem,
    registerPostman,
    registerCdp,
    registerChrome,
    registerFetch,
    registerSystem,
    registerTask,
    registerPort,
    registerGit,
    registerSqlite,
  ]) register(prefixed);
  return server;
}
