#!/usr/bin/env node
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const diagnosticIndex = args.indexOf('--startup-error-file');
const startupErrorFile = diagnosticIndex >= 0 ? args[diagnosticIndex + 1] : null;
if (diagnosticIndex >= 0) args.splice(diagnosticIndex, 2);

try {
  const { main } = await import('../scripts/agy-worker.js');
  await main(args);
} catch (error) {
  const secrets = [process.env.AKI_AGY_WORKER_TOKEN];
  const tokenIndex = args.indexOf('--token');
  if (tokenIndex >= 0) secrets.push(args[tokenIndex + 1]);
  let detail = String(error?.message || error);
  for (const secret of secrets.filter(Boolean)) detail = detail.replaceAll(secret, '[redacted]');
  detail = detail.replace(/[\r\n\t]+/g, ' ').slice(0, 2048);
  if (startupErrorFile) {
    try { writeFileSync(startupErrorFile, detail, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); } catch {}
  }
  console.error(detail);
  process.exitCode = 1;
}
