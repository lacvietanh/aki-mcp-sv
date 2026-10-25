// How a program is found and started, per OS: PATH lookup without spawning `which`/`where` (provider detection runs at boot and must stay cheap), plus the Windows differences as data.
import fs from 'node:fs';
import path from 'node:path';

// Executable suffixes per OS as data: win32 resolves a bare name through PATHEXT like cmd.exe does; elsewhere the name is the file.
const SUFFIXES = {
  win32: (env) => ['', ...(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)],
};

export function findOnPath(bin, env = process.env) {
  const suffixes = SUFFIXES[process.platform]?.(env) ?? [''];
  for (const dir of (env.PATH ?? env.Path ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of suffixes) {
      const full = path.join(dir, bin + ext);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        if (fs.statSync(full).isFile()) return full;
      } catch {}
    }
  }
  return null;
}

// PATH folders an installer leaves off, as data: Git for Windows exposes git but not the Unix tools beside it (usr\bin: grep, tail, cat).
const PATH_EXTRAS = {
  win32: (env) => {
    const git = findOnPath('git', env);
    return git ? ['..', '../..'].map((up) => path.resolve(path.dirname(git), up, 'usr', 'bin')) : [];
  },
};

// Appended, never prepended: a name that already resolves keeps resolving to the same program.
export function extendPath(env = process.env, platform = process.platform) {
  const have = (env.PATH ?? env.Path ?? '').split(path.delimiter);
  const extra = (PATH_EXTRAS[platform]?.(env) ?? []).filter((dir) => !have.includes(dir) && fs.existsSync(dir));
  if (extra.length) env.PATH = [...have, ...extra].join(path.delimiter);
  return extra;
}
extendPath();

// Names that are a .cmd shim on win32, which cannot be started without a shell: each runs as node plus the script its shim points at, beside node.exe.
const NODE_CLI = { npm: 'npm-cli.js', npx: 'npx-cli.js' };
const LAUNCH = {
  win32: (bin) => {
    const script = NODE_CLI[bin] && path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', NODE_CLI[bin]);
    return script && fs.existsSync(script) ? [process.execPath, [script]] : null;
  },
};

export function launchOf(bin, args, platform = process.platform) {
  const [file, lead] = LAUNCH[platform]?.(bin) ?? [bin, []];
  return [file, [...lead, ...args]];
}

// An npm-installed CLI on win32 is a .cmd/.bat shim that only cmd.exe starts (execFile refuses it since CVE-2024-27980), so its command line is quoted here and passed verbatim. npm writes the bare name (a sh script), name.cmd and name.ps1 side by side, so the .cmd is asked for by name. Kept apart from launchOf, whose callers pass user text.
const cmdWord = (word) => (/[\s&|<>^()]/.test(word) ? `"${word}"` : word);
const SHIM_LAUNCH = {
  win32: (bin, args, env, find) => {
    const shim = find(`${bin}.cmd`, env) ?? find(`${bin}.bat`, env);
    if (!shim) return null;
    if (args.some((arg) => /["%\r\n]/.test(arg))) throw new Error(`${bin}: an argument holds a character cmd.exe would reinterpret`);
    return { file: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${[`"${shim}"`, ...args.map(cmdWord)].join(' ')}"`], options: { windowsVerbatimArguments: true } };
  },
};

export function launchShim(bin, args, { platform = process.platform, env = process.env, find = findOnPath } = {}) {
  return SHIM_LAUNCH[platform]?.(bin, args, env, find) ?? { file: bin, args, options: {} };
}
