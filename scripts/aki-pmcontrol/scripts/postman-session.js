const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const CDP = require('chrome-remote-interface');
const { getPostmanPaths } = require('./postman-paths');

function browserIdentity(version, port) {
  const websocket = version && version.webSocketDebuggerUrl;
  if (websocket) {
    try {
      const url = new URL(websocket);
      const browserId = url.pathname.split('/').filter(Boolean).pop();
      if (browserId) return { kind: 'browser-websocket', browserId };
    } catch {}
  }
  return { kind: 'endpoint-fallback', endpoint: `http://127.0.0.1:${port}` };
}

class PostmanSession {
  static getDevToolsFile() {
    if (process.platform === 'darwin') {
      return path.join(process.env.HOME || '', 'Library', 'Application Support', 'Postman', 'DevToolsActivePort');
    }
    if (process.platform === 'win32') {
      const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
      return path.join(appData, 'Postman', 'DevToolsActivePort');
    }
    return path.join(process.env.HOME || '', '.config', 'Postman', 'DevToolsActivePort');
  }

  static getDevToolsPort(fallback = 9222) {
    const devToolsFile = PostmanSession.getDevToolsFile();
    if (fs.existsSync(devToolsFile)) {
      try {
        const lines = fs.readFileSync(devToolsFile, 'utf8').trim().split('\n');
        const port = parseInt(lines[0], 10);
        if (Number.isInteger(port) && port > 0) return port;
      } catch {}
    }
    return fallback;
  }

  static launchArgs(port) {
    return [`--remote-debugging-port=${port}`, '--disable-blink-features=AutomationControlled'];
  }

  static async endpoint(port, cdp = CDP) {
    const targets = await cdp.List({ port });
    const version = typeof cdp.Version === 'function' ? await cdp.Version({ port }).catch(() => null) : null;
    return { port, browserIdentity: browserIdentity(version, port), targets };
  }

  static async waitUntilReady(portOrResolver, { cdp = CDP, timeoutMs = 15000, pollMs = 100, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
    const deadline = Date.now() + timeoutMs;
    const getPort = typeof portOrResolver === 'function' ? portOrResolver : () => portOrResolver;
    let lastError;
    let lastPort;
    do {
      const port = getPort();
      lastPort = port;
      if (port) {
        try {
          return await PostmanSession.endpoint(port, cdp);
        } catch (error) {
          lastError = error;
        }
      }
      await sleep(pollMs);
    } while (Date.now() < deadline);
    throw new Error(`Postman CDP endpoint did not become ready on port ${lastPort || 'unknown'}: ${lastError ? lastError.message : 'timeout'}`);
  }

  static async ensureRunning(options = {}) {
    const cdp = options.cdp || CDP;
    const initialPort = options.port || PostmanSession.getDevToolsPort(null);
    if (initialPort) {
      try {
        const endpoint = await PostmanSession.endpoint(initialPort, cdp);
        return { ...endpoint, launched: false, launchProcessPid: null };
      } catch {}
    }

    const launchPort = options.port || 9222;
    const args = PostmanSession.launchArgs(launchPort);
    const { execPath } = options.paths || getPostmanPaths();

    if (!options.port) {
      try { fs.unlinkSync(PostmanSession.getDevToolsFile()); } catch {}
    }

    let child;
    if (execPath && fs.existsSync(execPath)) {
      child = spawn(execPath, args, { detached: true, stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      child = spawn('open', ['-a', 'Postman', '--args', ...args], { detached: true, stdio: 'ignore' });
    } else {
      child = spawn('postman', args, { detached: true, stdio: 'ignore' });
    }
    child.unref();

    const resolvePort = typeof options.port === 'number'
      ? () => options.port
      : () => PostmanSession.getDevToolsPort(null) || launchPort;

    const endpoint = await PostmanSession.waitUntilReady(resolvePort, { ...options, cdp });
    return { ...endpoint, launched: true, launchProcessPid: child.pid || null };
  }
}

module.exports = { PostmanSession, browserIdentity };
