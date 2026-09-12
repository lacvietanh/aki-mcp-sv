// Everything this server writes for a user — config and secrets alike — lives in one directory outside the repo, the same way a CLI keeps its settings under the home directory. A clone stays exactly as it was checked out.
// The setup runs at import, not on a call: oauth.js reads its files while loading, so ordering has to come from the dependency graph rather than from someone remembering to call a function first.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const IS_DEV = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
export const USER_DIR = process.env.AKI_MCP_DATA_DIR || path.join(os.homedir(), '.aki', IS_DEV ? 'mcpsv-dev' : 'mcpsv');
process.env.AKI_MCP_DATA_DIR = USER_DIR;
process.env.AKI_DATA_DIR = USER_DIR;

export const SETTINGS_PATH = path.join(USER_DIR, 'setting.json');
export const CLIENT_PATH = path.join(USER_DIR, 'oauth-client.json');
export const DCR_CLIENTS_PATH = path.join(USER_DIR, 'oauth-dcr-clients.json');
export const PASSPHRASE_PATH = path.join(USER_DIR, 'passphrase.txt');
export const TOKENS_PATH = path.join(USER_DIR, 'tokens.json');
export const INGRESS_CONFIG_PATH = path.join(USER_DIR, 'ingress.json');
export const CLOUDFLARED_CRED_PATH = path.join(USER_DIR, 'cloudflared-cred.json');

mkdirSync(USER_DIR, { recursive: true, mode: 0o700 });

// Single reader for the panel-picked ingress (panel.js writes it, start.js reads it as the default when no --tunnel flag/PUBLIC_ORIGIN is set) — one shape, read the same way by both.
export function readIngressConfig() {
  if (!existsSync(INGRESS_CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(INGRESS_CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}
