// The running package version, read once from the repo-root package.json: the one source for serverInfo, `--version`, the instance lock and the call log.
import { readFileSync } from 'node:fs';

export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
