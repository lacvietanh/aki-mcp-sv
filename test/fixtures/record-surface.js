import '../setup.js';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const fixtures = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.resolve(fixtures, '..', '..', 'scripts');
// The default recording runs first: creating ~/.aki/aiobox/ is what makes the second one differ.
const OUTPUTS = [
  { file: 'surface-3.3.1.json', withAiobox: false },
  { file: 'surface-3.3.1-aiobox.json', withAiobox: true },
];

// The parent imports nothing from scripts/: the provider-to-tool map comes from a second child that mounts them.
const providerMap = () => {
  const href = (name) => JSON.stringify(pathToFileURL(path.join(scripts, name)).href);
  const code = `import { createToolsServer } from ${href('tools-server.js')};
import { listProviders } from ${href('provider-registry.js')};
createToolsServer();
process.stdout.write('PROVIDERS ' + JSON.stringify(listProviders().map(({ id, tools }) => ({ id, tools }))) + '\\n', () => process.exit(0));`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: os.tmpdir(), encoding: 'utf8' });
  const line = run.stdout.split('\n').find((text) => text.startsWith('PROVIDERS '));
  if (!line) throw new Error(`provider map child printed no PROVIDERS line (exit ${run.status}): ${run.stderr}`);
  return JSON.parse(line.slice('PROVIDERS '.length));
};

const servedSurface = async () => {
  const child = spawn(process.execPath, [path.join(scripts, 'stdio.js')], { cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = new Map();
  const exited = new Promise((_, reject) => child.once('exit', (code, signal) => reject(new Error(`stdio.js exited early (code ${code}, signal ${signal})`))));
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    waiting.get(message.id)?.(message.result);
  });
  const send = (message) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const ask = (id, method, params) => Promise.race([new Promise((resolve) => { waiting.set(id, resolve); send({ id, method, params }); }), exited]);
  try {
    const initialize = await ask(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'record-surface', version: '1' } });
    send({ method: 'notifications/initialized' });
    const { tools } = await ask(2, 'tools/list', {});
    return { initialize, tools };
  } finally {
    child.kill();
  }
};

const record = async ({ withAiobox }) => {
  if (withAiobox) fs.mkdirSync(path.join(os.homedir(), '.aki', 'aiobox'), { recursive: true });
  const providers = providerMap();
  const { initialize, tools } = await servedSurface();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const grouped = {};
  for (const { id, tools: names } of providers) {
    const served = names.filter((name) => byName.has(name)).map((name) => byName.get(name));
    if (served.length) grouped[id] = served;
  }
  const groupedCount = Object.values(grouped).flat().length;
  if (groupedCount !== tools.length) throw new Error(`${tools.length - groupedCount} served tools belong to no provider`);
  return { initialize, providers: grouped };
};

const home = os.homedir();
if (!path.basename(path.dirname(home)).startsWith('akimcp-test-')) throw new Error(`HOME ${home} is not a scratch directory made by test/setup.js`);
console.log(`child HOME: ${home}`);
console.log(`child AKI_MCP_DATA_DIR: ${process.env.AKI_MCP_DATA_DIR ?? 'not set'}`);

const recorded = [];
for (const output of OUTPUTS) {
  const surface = await record(output);
  recorded.push({ ...output, text: `${JSON.stringify(surface, null, 2)}\n`, count: Object.values(surface.providers).flat().length });
}
for (const { file, count } of recorded) console.log(`${file}: ${count} tools`);
if (recorded[0].count === recorded[1].count) throw new Error('both recordings list the same tool count: the AIObox directory changed nothing that is served');

if (process.argv.includes('--check')) {
  const differing = recorded.filter(({ file, text }) => fs.readFileSync(path.join(fixtures, file), 'utf8') !== text);
  for (const { file } of differing) console.error(`${file} differs from a new recording`);
  process.exitCode = differing.length ? 1 : 0;
} else {
  for (const { file, text } of recorded) fs.writeFileSync(path.join(fixtures, file), text);
}
