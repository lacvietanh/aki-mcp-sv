// Preloaded by `npm test` (node --test --import): every test process, and every child it spawns, gets its own HOME and temp dir, removed on exit even when the test fails or calls process.exit — so no test reads or writes the owner's real ~/.aki, ~/.claude, ~/.gitconfig or /tmp. One file the same way: node --import ./test/setup.js test/<name>.test.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'akimcp-test-')));
const home = path.join(root, 'home');
fs.mkdirSync(home);
Object.assign(process.env, { HOME: home, USERPROFILE: home, TMPDIR: root, TMP: root, TEMP: root });
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));
