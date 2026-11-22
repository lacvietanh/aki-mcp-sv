// Shared dispatcher for temporary token operations: in-process (when running inside the live gatekeeper) or loopback HTTP proxy (stdio.js and CLI).
import { readLock, isPidAlive } from './instance-lock.js';

export async function callPanelTempApi(method, apiPath, body) {
  const lock = readLock();
  if (!lock || !isPidAlive(lock.pid) || !lock.panelPort || !lock.token) {
    throw new Error('akimcp gateway is not running; start it with `akimcp` first');
  }
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${lock.panelPort}${apiPath}`, {
      method,
      headers: {
        'x-panel-token': lock.token,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error('failed to reach akimcp control panel on loopback');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error.slice(0, 160) : `panel API returned HTTP ${res.status}`);
  }
  return data;
}

export async function runTempTokenOp({ op, name, id, target, all, mode = 'in-process', getOrigin, by = 'via MCP tool' }) {
  if (mode === 'proxy') {
    if (op === 'list') return callPanelTempApi('GET', '/api/temp-tokens');
    if (op === 'mint') return callPanelTempApi('POST', '/api/temp-token', name !== undefined ? { name } : {});
    if (op === 'extend') {
      return callPanelTempApi('POST', '/api/temp-token/extend', {
        ...(id !== undefined ? { id } : {}),
        ...(name !== undefined ? { name } : {}),
        ...(target !== undefined ? { target } : {}),
      });
    }
    if (op === 'revoke') {
      return callPanelTempApi('POST', '/api/temp-token/revoke', {
        ...(id !== undefined ? { id } : {}),
        ...(name !== undefined ? { name } : {}),
        ...(target !== undefined ? { target } : {}),
        ...(all ? { all: true } : {}),
      });
    }
    throw new Error(`unknown temp token op "${op}"`);
  }

  const [
    { mintTempToken, listTempTokens, extendTempToken, revokeTempTokenTarget, TEMP_EXTEND_MS },
    { tempTokenKickoff, GUIDE_URL },
  ] = await Promise.all([import('./oauth.js'), import('./config-page.js')]);

  if (op === 'list') {
    return { tokens: listTempTokens(), extendMinutes: TEMP_EXTEND_MS / 60_000 };
  }
  if (op === 'mint') {
    const origin = getOrigin?.() ?? readLock()?.origin ?? process.env.PUBLIC_ORIGIN ?? null;
    if (!origin) throw new Error('a web chat needs a public address: set one up in section 0 first');
    const minted = mintTempToken({ name });
    const mcpUrl = `${origin}/mcp`;
    return {
      ok: true,
      ...minted,
      mcpUrl,
      guideUrl: GUIDE_URL,
      kickoff: tempTokenKickoff({ mcpUrl, token: minted.token, expires: minted.expires }),
    };
  }
  if (op === 'extend') {
    const extended = extendTempToken({ id, name, target, by });
    if (!extended) throw new Error('no live temporary token to extend: refresh the list');
    return {
      ok: true,
      ...extended,
      message: `extended by ${TEMP_EXTEND_MS / 60_000} min`,
    };
  }
  if (op === 'revoke') {
    const res = revokeTempTokenTarget({ id, name, target, all: all === true, by });
    return {
      ok: true,
      revoked: res.revoked,
      ...(res.id ? { id: res.id } : {}),
      ...(res.name ? { name: res.name } : {}),
      message: `revoked ${res.revoked} temporary token${res.revoked === 1 ? '' : 's'}`,
    };
  }
  throw new Error(`unknown temp token op "${op}"`);
}
