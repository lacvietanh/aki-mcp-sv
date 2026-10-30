import '../setup.js';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const start = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'start.js');

// Ports 19998/19999 and a cwd with no .env: a walkthrough of the panel never reaches the instance serving this machine.
const child = spawn(process.execPath, [start, '--no-browser', '--dev', '--port', '19999', '--panel-port', '19998'], { cwd: os.tmpdir(), stdio: 'inherit' });

// setup.js turns SIGINT and SIGTERM into process.exit, which fires this and takes the server down with it.
process.on('exit', () => child.kill());
child.on('exit', (code) => process.exit(code ?? 1));
