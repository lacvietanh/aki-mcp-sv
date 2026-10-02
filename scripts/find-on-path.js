// PATH lookup without spawning `which`/`where`: provider detection runs at boot and must stay cheap.
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
