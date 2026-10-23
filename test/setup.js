// Preloaded by `npm test` (node --test --import) and imported first by every test file, so a bare `node test/<name>.test.js` is isolated the same way: every test process, and every child it spawns, gets its own HOME and temp dir, removed on exit even when the test fails or calls process.exit, and drops inherited AKI_*/MCP_* overrides (a shell started by a running AkiMCP carries AKI_MCP_DATA_DIR=<the real data dir>) — so no test reads or writes the owner's real ~/.aki, ~/.claude, ~/.gitconfig or /tmp. Under `npm test` a test file whose first import is not this one is refused, so a new file cannot forget it (docs/plan/done/test-bare-run-isolation.md).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'akimcp-test-')));
const home = path.join(root, 'home');
fs.mkdirSync(home);
for (const key of Object.keys(process.env)) if (/^(AKI_|MCP_)/.test(key)) delete process.env[key];
Object.assign(process.env, { HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'), TMPDIR: root, TMP: root, TEMP: root });
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));

const entry = process.argv[1] ?? '';
if (/\.test\.c?js$/.test(entry) && fs.existsSync(entry)) {
  const firstImport = fs.readFileSync(entry, 'utf8').split('\n').find((line) => /^\s*import\b|\brequire\(/.test(line)) ?? '';
  if (!firstImport.includes('setup.js')) throw new Error(`${entry}: its first import must be test/setup.js, so running it alone is isolated too`);
}
