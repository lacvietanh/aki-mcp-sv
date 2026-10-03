// The running package version, read once from the repo-root package.json, so serverInfo and the call log never carry a hand-copied number (tools-server.js said 2.0.2 through 3.0.0).
import { readFileSync } from 'node:fs';

export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
