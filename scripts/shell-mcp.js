// Allowlist-gated shell MCP tool, in-house (npm `shell-mcp` has no real whitelist) — rationale: docs/plan/done/init.md
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { loadAllowlist, loadAllowlistDirs } from './allowlist.js';
import { resolveUnderRoot, containedIn, refuseCredentialArgs } from './roots.js';
import { ok, err, fail } from './mcp-tool.js';
import { shapeForModel } from './output-shape.js';

// Interpreters run a script file passed as an argument, so trust must follow the script's path, not the interpreter binary (which lives on PATH, outside the trusted zones). Shells (sh/bash/zsh) are excluded on purpose — their argument is arbitrary code, not a file to locate under a zone.
const INTERPRETERS = new Set(['node', 'python', 'python3', 'bun', 'deno', 'tsx', 'ruby', 'perl', 'php']);

// ls-remote requires zero extra args — a repository/URL argument lets git's own ext:: transport helper spawn an arbitrary process before anything "read-only" happens; bare invocation only queries the configured remote.
const GIT_NO_ARGS_SUBCOMMANDS = new Set(['ls-remote']);

const COMMAND_TIMEOUT_MS = 10_000;
const MAX_CAPTURE_BYTES = 32 * 1024 * 1024; // what the process may print before it is stopped; what the model reads is bounded separately by shapeForModel

// A listed git subcommand that also has write forms (branch -D, tag -d, remote set-url, diff --output=<file>) is allowed in its read form only.
// Bare `git` on the allowlist skips this: it means everything, the owner's call (docs/feat/security.md § Design stance).
const isListFlag = (a) => a === '-l' || a === '--list';
const GIT_READ_FORMS = {
  branch: (a) => a.every((x) => ['-a', '-r', '-v', '-vv', '-l', '--list', '--all', '--remotes', '--verbose', '--show-current'].includes(x)),
  tag: (a) => a.every((x, i) => ['-l', '--list', '-n'].includes(x) || x.startsWith('--sort=') || (!x.startsWith('-') && a.slice(0, i).some(isListFlag))),
  remote: (a) => a.length === 0 || (a.length === 1 && a[0] === '-v') || (['show', 'get-url'].includes(a[0]) && a.length === 2 && !a[1].startsWith('-')),
};

// A zone that does not exist yet (skills not installed) stays as typed; one that is or sits under a symlink (macOS /var, a linked ~/.claude) must compare in real form, or no script inside it would ever match.
const realOrSelf = (dir) => {
  try {
    return fs.realpathSync(dir);
  } catch {
    return dir;
  }
};

// realpath first so a symlink pointing out of a zone can't masquerade as being inside it; a non-existent path can't be a trusted script, so a throw here is a correct "no".
function underTrusted(p, dirs) {
  try {
    const abs = fs.realpathSync(path.resolve(p));
    return dirs.some((dir) => containedIn(abs, realOrSelf(dir)));
  } catch {
    return false;
  }
}

function preallowedByDir(bin, args) {
  const dirs = loadAllowlistDirs();
  if (!dirs.length) return false;
  if (bin.includes('/') || bin.includes('\\')) {
    if (!underTrusted(bin, dirs)) return false;
    try {
      fs.accessSync(fs.realpathSync(path.resolve(bin)), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  if (INTERPRETERS.has(path.basename(bin))) {
    // The script must be the first argument: a flag before it (`node --eval=<code> zone/x.js`, `node --require ./evil.js zone/x.js`, `python3 -c <code> zone/x.py`) is code the zone never vouched for.
    return Boolean(args[0]) && !args[0].startsWith('-') && underTrusted(args[0], dirs);
  }
  return false;
}

export class Shell {
  // Backslash is escape/chaining on Unix but the normal path separator on Windows — only treat it as dangerous off-Windows.
  // No backslash: `execFile` never spawns a shell, so it is an inert literal everywhere and a path separator on Windows.
  static DANGEROUS_CHARS = /[;&|`$<>\n]/;

  // Only metacharacters OUTSIDE quotes can chain/redirect. execFile never spawns a shell, so a quoted
  // occurrence (grep -E '^(name|description):' , grep -E 'foo$') is an inert argv literal. Validate a
  // quote-stripped view — mirrors tokenize()'s quote model so the two agree — not the raw command.
  static unquotedView(command) {
    let out = '';
    let quote = null;
    for (const char of command) {
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else {
        out += char;
      }
    }
    return out;
  }

  // Quotes group an argument and are then stripped, as a shell would. Splitting on whitespace alone left them in the argv, so `find -name "*.ts"` silently searched for a name containing quote marks.
  static tokenize(command) {
    const tokens = [];
    let current = '';
    let started = false;
    let quote = null;
    for (const char of command.trim()) {
      if (quote) {
        if (char === quote) quote = null;
        else current += char;
      } else if (char === '"' || char === "'") {
        quote = char;
        started = true;
      } else if (/\s/.test(char)) {
        if (started) tokens.push(current);
        current = '';
        started = false;
      } else {
        current += char;
        started = true;
      }
    }
    if (quote) throw new Error('unterminated quote');
    if (started) tokens.push(current);
    return tokens;
  }

  parse(command) {
    if (typeof command !== 'string' || command.trim() === '') {
      throw new Error('empty command');
    }
    if (Shell.DANGEROUS_CHARS.test(Shell.unquotedView(command))) {
      throw new Error('command chaining/redirection is not allowed');
    }
    const [bin, ...args] = Shell.tokenize(command);
    if (!bin) throw new Error('empty command');
    return { bin, args };
  }

  checkPermission(bin, args) {
    const allowlist = loadAllowlist();
    if (Object.hasOwn(allowlist, bin)) {
      const allowedSubcommands = allowlist[bin];
      if (!Array.isArray(allowedSubcommands) || allowedSubcommands.includes(args[0])) {
        if (bin === 'git' && Array.isArray(allowedSubcommands)) {
          if (GIT_NO_ARGS_SUBCOMMANDS.has(args[0]) && args.length > 1) {
            throw new Error(`"git ${args[0]}" only allowed with no further arguments — a repository/URL argument can smuggle code execution via git's transport helpers (ext::, --upload-pack=). To list a remote's tags use the git tool: op=tags, remote=<configured remote name>.`);
          }
          if (args.some((a) => a.startsWith('--output')) || (Object.hasOwn(GIT_READ_FORMS, args[0]) && !GIT_READ_FORMS[args[0]](args.slice(1)))) {
            throw new Error(`"git ${args.join(' ')}" is a write form: only the read forms of "git ${args[0]}" are allowed (e.g. git branch -a, git tag -l 'v*', git remote -v). To allow every git command, add bare "git" in the control panel (section 6).`);
          }
        }
        return;
      }
    }
    if (preallowedByDir(bin, args)) return; // not named (or the named subcommand is blocked), but it targets a script under a trusted zone
    const listed = Object.hasOwn(allowlist, bin) ? ` — "${bin}" is limited to: ${allowlist[bin].join(', ')}` : ' is not in the allowlist';
    throw new Error(`"${bin}${args[0] ? ` ${args[0]}` : ''}"${listed}. The owner can add it in the control panel, section 6 (Allowed shell commands).`);
  }

  run(bin, args, cwd) {
    return new Promise((resolve) => {
      execFile(bin, args, { cwd, timeout: COMMAND_TIMEOUT_MS, maxBuffer: MAX_CAPTURE_BYTES, windowsHide: true }, (error, stdout, stderr) => {
        if (!error) return resolve(ok(shapeForModel(stdout) || '(no output)'));
        // A failing command's stdout is often the useful part (test failures, grep's partial hits), so it is returned with stderr and the reason.
        const reason = error.killed ? `timed out after ${COMMAND_TIMEOUT_MS / 1000}s` : typeof error.code === 'number' ? `exit code ${error.code}` : error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'output exceeded the capture limit, the rest was dropped' : error.code === 'ENOENT' ? `"${bin}" is not an executable on PATH (on Windows a .cmd shim such as npm, or a PowerShell cmdlet, cannot be run by this tool)` : error.message;
        resolve(err(`[${reason}]\n${shapeForModel([stdout, stderr].filter(Boolean).map((s) => s.replace(/\n+$/, '')).join('\n'))}`.trimEnd()));
      });
    });
  }

  async execute(command, cwd) {
    let bin, args, dir;
    try {
      ({ bin, args } = this.parse(command));
      this.checkPermission(bin, args);
      dir = resolveUnderRoot(cwd);
      refuseCredentialArgs(args, dir);
    } catch (e) {
      return fail(e);
    }
    return this.run(bin, args, dir);
  }
}

const shell = new Shell();

export const provider = { id: 'shell', title: 'Shell (allowlisted commands)', required: true, register };

export function register(server) {
  server.registerTool(
    'run_cmd',
    {
      title: 'Run Command',
      // destructive: the owner's allowlist can hold write commands (git commit/push).
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      description: 'Run one allowlisted shell command. Default set is inspection-first (ls, cat, grep, head, tail, stat, git status/log/diff/show, …); the owner extends it in the panel. Output is cleaned (ANSI, progress redraws and repeats removed); past ~20k chars only start and end are shown, the full text saved to a file the output names. A failure returns stdout, stderr and exit code. Commands stop after 10s; a dev server or watch fits aki__task_start. Dedicated tools are cheaper: find_path/search_content, read_text_file, git (find is not allowlisted: its flags escape read-only). cwd: absolute path under an allowed root, or relative to the first root. One command per call, no chaining/redirection.',
      inputSchema: { command: z.string(), cwd: z.string().optional() },
    },
    ({ command, cwd }) => shell.execute(command, cwd),
  );
}
