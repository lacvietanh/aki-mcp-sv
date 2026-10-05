// The one list of what the tools server hosts: each module's `provider` descriptor, whether it is installed on this machine (detect), and the owner's on/off switch in setting.json (`providers.<id>.enabled`). Contract: docs/arch/provider-toolkit.md.
// Every provider is always registered, so warmToolsServer still catches a schema error in any of them at boot; one that is not installed or is switched off is only disabled, which hides it from tools/list and makes a call fail.
import { readSettings, writeSettings } from './allowlist.js';
import { redactResult, redactError } from './roots.js';
import { isGated, withReceipt, gate, withRules } from './rule-gate.js';
import { provider as rule } from './rule-context-mcp.js';
import { provider as shell } from './shell-mcp.js';
import { provider as agy } from './agy-mcp.js';
import { provider as kiro } from './kiro-mcp.js';
import { provider as search } from './search-mcp.js';
import { provider as filesystem } from './filesystem-mcp.js';
import { provider as postman } from './postman/postman-mcp.js';
import { provider as cdp } from './cdp-mcp.js';
import { provider as aiobox } from './aiobox-mcp.js';
import { provider as chrome } from './chrome-mcp.js';
import { provider as fetch } from './fetch-mcp.js';
import { provider as system } from './system-mcp.js';
import { provider as task } from './task-mcp.js';
import { provider as port } from './port-mcp.js';
import { provider as git } from './git-mcp.js';
import { provider as sqlite } from './sqlite-mcp.js';

// Array order is the tools/list order clients see.
export const PROVIDERS = [rule, shell, agy, kiro, search, filesystem, postman, cdp, aiobox, chrome, fetch, system, task, port, git, sqlite];

let detected = null; // id → { available, reason }, computed once at first mount (boot) and on redetect()

function detectOne(p) {
  if (!p.detect) return { available: true, reason: null };
  try {
    const r = p.detect();
    return r.available ? { available: true, reason: null } : { available: false, reason: r.reason || 'not detected' };
  } catch (e) {
    return { available: false, reason: `detect failed: ${e.message}` };
  }
}

const detectAll = () => {
  detected = new Map(PROVIDERS.map((p) => [p.id, detectOne(p)]));
};
// optIn providers (agy, kiro) hand a whole task to another paid agent, so they stay off until the owner switches them on.
const switchedOn = (p, settings) => p.required || (settings.providers?.[p.id]?.enabled ?? !p.optIn);

// Held weakly: warmToolsServer's throwaway server and test servers must stay collectable.
const mounted = new Set(); // WeakRef<McpServer>
const handlesOf = new WeakMap(); // McpServer → Map<id, RegisteredTool[]>
const toolNames = new Map(); // id → served tool names, identical for every mount

function apply(server, settings) {
  for (const p of PROVIDERS) {
    const on = detected.get(p.id).available && switchedOn(p, settings);
    for (const handle of handlesOf.get(server).get(p.id)) {
      if (handle.enabled !== on) on ? handle.enable() : handle.disable();
    }
  }
}

function applyAll() {
  const settings = readSettings();
  for (const ref of mounted) {
    const server = ref.deref();
    if (server) apply(server, settings);
    else mounted.delete(ref);
  }
}

// Registers every provider on the server under `prefix` (aki__run_cmd, aki__find_path, …, one naming across all clients) and keeps each tool's handle so setEnabled/redetect can reach it later.
// Every tool that is not read-only takes `receipt` and refuses a call without the current rule receipt (scripts/rule-gate.js, docs/plan/rule-receipt-gate.md): one place, so a new provider is gated without knowing it.
export function mountProviders(server, prefix) {
  if (!detected) detectAll();
  const handles = new Map();
  for (const p of PROVIDERS) {
    const own = [];
    p.register(new Proxy(server, {
      get(target, prop, receiver) {
        if (prop !== 'registerTool') return Reflect.get(target, prop, receiver);
        return (name, config, handler) => {
          const gated = isGated(config);
          const hasSchema = config.inputSchema !== undefined;
          // A read tool always runs; one that touched a project with rule files appends a line naming them (D23). The rule tool itself is left as it is.
          const call = gated ? gate(handler, hasSchema) : (p === rule ? handler : withRules(handler, hasSchema));
          const served = gated ? { ...config, inputSchema: withReceipt(config.inputSchema) } : config;
          const handle = target.registerTool(`${prefix}${name}`, served, async (...args) => {
            try {
              return redactResult(await call(...args));
            } catch (e) {
              throw redactError(e);
            }
          });
          own.push([`${prefix}${name}`, handle]);
          return handle;
        };
      },
    }));
    handles.set(p.id, own.map(([, handle]) => handle));
    toolNames.set(p.id, own.map(([name]) => name));
  }
  handlesOf.set(server, handles);
  mounted.add(new WeakRef(server));
  apply(server, readSettings());
  return server;
}

export function listProviders() {
  if (!detected) detectAll();
  const settings = readSettings();
  return PROVIDERS.map((p) => ({
    id: p.id,
    title: p.title,
    required: !!p.required,
    ...detected.get(p.id),
    enabled: switchedOn(p, settings),
    tools: toolNames.get(p.id) || [],
  }));
}

export function setEnabled(id, enabled) {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) throw new Error(`unknown provider "${id}"`);
  if (typeof enabled !== 'boolean') throw new Error('enabled must be true or false');
  if (p.required) throw new Error(`provider "${id}" is always on: other tools and the rule prompt depend on it`);
  const settings = readSettings();
  settings.providers = { ...settings.providers, [id]: { ...settings.providers?.[id], enabled } };
  writeSettings(settings);
  applyAll();
  return listProviders().find((x) => x.id === id);
}

// For an install or uninstall after boot (the panel's re-detect button), without a restart.
export function redetect() {
  detectAll();
  applyAll();
  return listProviders();
}
