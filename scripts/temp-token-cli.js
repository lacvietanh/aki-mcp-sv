#!/usr/bin/env node
// `akimcp temp-token <list|mint|extend|revoke>`: local CLI client for the running gateway's loopback panel API.
import { runTempTokenOp } from './temp-token-proxy.js';

const HELP_TEXT = `Usage:
  akimcp temp-token list [--json]
  akimcp temp-token mint [<name> | --name <name>] [--json | --token-only]
  akimcp temp-token extend (<name|id> | --name <name> | --id <id>) [--json]
  akimcp temp-token revoke (<name|id> | --name <name> | --id <id> | --all) [--json]

Options:
  --name <name>    Temporary token name (optional on mint, or target selector on extend/revoke)
  --id <id>        Temporary token id or >=8-char hex prefix (for extend/revoke)
  --all            Revoke all active temporary tokens
  --token-only     Print only the raw 64-hex bearer token on mint
  --json           Print single-line JSON response
  --dev            Target the development-mode instance (~/.aki/mcpsv-dev)
  -h, --help       Show this help`;

function parseArgs(argv) {
  const args = argv.filter((a) => a !== '--dev');
  const subIdx = args.indexOf('temp-token');
  const rest = subIdx >= 0 ? args.slice(subIdx + 1) : args;
  let json = false;
  let tokenOnly = false;
  let all = false;
  let name;
  let id;
  let help = false;
  const positionals = [];

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '-h' || arg === '--help') {
      help = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--token-only') {
      tokenOnly = true;
    } else if (arg === '--all') {
      all = true;
    } else if (arg === '--name') {
      if (i + 1 >= rest.length) throw new Error('--name requires a value');
      name = rest[++i];
    } else if (arg.startsWith('--name=')) {
      name = arg.slice('--name='.length);
    } else if (arg === '--id') {
      if (i + 1 >= rest.length) throw new Error('--id requires a value');
      id = rest[++i];
    } else if (arg.startsWith('--id=')) {
      id = arg.slice('--id='.length);
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option "${arg}"`);
    } else {
      positionals.push(arg);
    }
  }
  return { help, json, tokenOnly, all, name, id, positionals };
}

async function main() {
  const { help, json, tokenOnly, all, name, id, positionals } = parseArgs(process.argv.slice(2));
  const [action, posTarget, extraPos] = positionals;
  if (help || !action) {
    console.log(HELP_TEXT);
    process.exit(0);
  }
  if (extraPos !== undefined) {
    throw new Error(`unexpected argument "${extraPos}"`);
  }

  if (action === 'list') {
    if (posTarget !== undefined || name !== undefined || id !== undefined || all) {
      throw new Error('`akimcp temp-token list` takes only [--json]');
    }
    const data = await runTempTokenOp({ op: 'list', mode: 'proxy' });
    if (json) {
      console.log(JSON.stringify(data));
      return;
    }
    if (!data.tokens.length) {
      console.log('No active temporary tokens.');
      return;
    }
    for (const t of data.tokens) {
      const used = t.lastSeen
        ? `last used ${new Date(t.lastSeen).toISOString()} (${[t.lastAddress, t.lastAgent].filter(Boolean).join(' · ')})`
        : 'not used yet';
      console.log(`${t.id.slice(0, 12)}  ${(t.name ?? '—').padEnd(20)}  expires ${new Date(t.expires).toISOString()}  ${used}`);
    }
    return;
  }

  if (action === 'mint') {
    if (id !== undefined || all) throw new Error('`akimcp temp-token mint` does not take --id or --all');
    if (name !== undefined && posTarget !== undefined) {
      throw new Error('specify token name either via --name or positional argument, not both');
    }
    const chosenName = name ?? posTarget;
    const data = await runTempTokenOp({ op: 'mint', ...(chosenName !== undefined ? { name: chosenName } : {}), mode: 'proxy' });
    if (json) console.log(JSON.stringify(data));
    else if (tokenOnly) console.log(data.token);
    else console.log(data.kickoff);
    return;
  }

  if (action === 'extend') {
    if (all) throw new Error('`akimcp temp-token extend` does not take --all');
    if (posTarget !== undefined && (name !== undefined || id !== undefined)) {
      throw new Error('specify either a positional target or --name/--id, not both');
    }
    if (posTarget === undefined && name === undefined && id === undefined) {
      throw new Error('specify a token name or id to extend');
    }
    const data = await runTempTokenOp({ op: 'extend', name, id, target: posTarget, mode: 'proxy' });
    if (json) console.log(JSON.stringify(data));
    else console.log(`${data.message}: ${data.id.slice(0, 12)}${data.name ? ` (${data.name})` : ''} -> ${new Date(data.expires).toISOString()}`);
    return;
  }

  if (action === 'revoke') {
    if (posTarget !== undefined && (name !== undefined || id !== undefined)) {
      throw new Error('specify either a positional target or --name/--id, not both');
    }
    const data = await runTempTokenOp({ op: 'revoke', name, id, target: posTarget, all, mode: 'proxy' });
    if (json) console.log(JSON.stringify(data));
    else console.log(data.message);
    return;
  }

  throw new Error(`unknown temp-token subcommand "${action}" (expected: list, mint, extend, revoke)`);
}

try {
  await main();
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
