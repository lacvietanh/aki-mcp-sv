// Dev server and TCP port manager tools (port_status / kill_port).
// Cross-platform port inspection and process termination with self-protection guards.
// Served names are prefixed aki__ by tools-server.js.
import { execFile } from 'node:child_process';
import { z } from 'zod';
import { ok, err, fail } from './mcp-tool.js';

const IS_WIN = process.platform === 'win32';

function execPromise(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 10_000, windowsHide: true }, (err, stdout, stderr) => {
      if (err && cmd === 'lsof' && err.code === 1) {
        return resolve('');
      }
      if (err) return reject(new Error(stderr?.trim() || err.message));
      resolve(stdout || '');
    });
  });
}

export async function getListeningPorts(targetPort = null) {
  if (IS_WIN) {
    const out = await execPromise('netstat', ['-ano', '-p', 'tcp']);
    const results = [];
    for (const line of out.split('\n')) {
      if (!line.includes('LISTENING')) continue;
      const tokens = line.trim().split(/\s+/);
      if (tokens.length < 5) continue;
      const localAddr = tokens[1];
      const pid = parseInt(tokens[4], 10);
      const portMatch = localAddr.match(/:(\d+)$/);
      if (!portMatch) continue;
      const port = parseInt(portMatch[1], 10);
      if (targetPort && port !== targetPort) continue;
      results.push({ port, pid, address: localAddr });
    }
    return results;
  }

  const args = targetPort
    ? ['-iTCP:' + targetPort, '-sTCP:LISTEN', '-P', '-n']
    : ['-iTCP', '-sTCP:LISTEN', '-P', '-n'];
  const out = await execPromise('lsof', args);
  const lines = out.trim().split('\n');
  if (lines.length <= 1) return [];

  const results = [];
  const seen = new Set();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const tokens = line.split(/\s+/);
    if (tokens.length < 9) continue;
    const command = tokens[0];
    const pid = parseInt(tokens[1], 10);
    const user = tokens[2];
    const name = tokens[tokens.length - 2];
    const portMatch = name.match(/:(\d+)$/);
    if (!portMatch) continue;
    const port = parseInt(portMatch[1], 10);
    if (targetPort && port !== targetPort) continue;
    const key = `${port}:${pid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ port, pid, command, user, address: name });
  }
  return results;
}

export function isProtectedPort(port) {
  const gatePort = parseInt(process.env.GATEKEEPER_PORT || '9999', 10);
  const panelPort = parseInt(process.env.PANEL_PORT || '9998', 10);
  return port === gatePort || port === panelPort;
}

export function register(server) {
  server.registerTool(
    'port_status',
    {
      title: 'Check listening ports and dev servers',
      description:
        'Inspect active TCP listening ports and processes (e.g. dev servers on port 3000, 5173, 8080). Provide `port` to check a specific port, or omit to list all listening ports.',
      inputSchema: {
        port: z.number().int().optional().describe('Specific TCP port to inspect (e.g. 3000)'),
      },
    },
    async ({ port }) => {
      try {
        const ports = await getListeningPorts(port);
        return ok(JSON.stringify(ports, null, 2));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'kill_port',
    {
      title: 'Kill process listening on a port',
      description:
        'Terminate the process(es) listening on a specific TCP port (e.g. freeing port 3000 when EADDRINUSE). Will refuse to kill the Aki MCP server itself.',
      inputSchema: {
        port: z.number().int().describe('TCP port to free up (e.g. 3000)'),
        force: z.boolean().optional().describe('Send SIGKILL instead of SIGTERM (default false)'),
      },
    },
    async ({ port, force }) => {
      try {
        if (isProtectedPort(port)) {
          return err(`Refusing to kill port ${port}: this port is reserved for the Aki MCP server itself`);
        }

        const listeners = await getListeningPorts(port);
        if (!listeners.length) {
          return ok(`No listening process found on port ${port}.`);
        }

        const killed = [];
        const signal = force ? 'SIGKILL' : 'SIGTERM';
        for (const item of listeners) {
          if (item.pid === process.pid) {
            return err(`Refusing to kill PID ${item.pid}: this is the Aki MCP server process.`);
          }
          try {
            process.kill(item.pid, signal);
            killed.push(item);
          } catch (e) {
            if (e.code !== 'ESRCH') throw e;
          }
        }

        return ok(JSON.stringify({
          success: true,
          freedPort: port,
          signal,
          killedProcesses: killed,
        }, null, 2));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
