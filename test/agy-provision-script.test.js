#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  console.log('agy-provision-script.test.js: skipped (Windows-only)');
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const provisionScript = path.join(root, 'scripts', 'agy-provision-users.ps1');
const missingCredential = path.join(root, `missing-${randomUUID()}.clixml`);
assert.equal(existsSync(missingCredential), false);
const provisionSource = readFileSync(provisionScript, 'utf8');
const roleProcessSource = readFileSync(path.join(root, 'scripts', 'agy-role-process.ps1'), 'utf8');
assert.match(provisionSource, /Set-LocalUser -Name \$u -Password \$password -AccountNeverExpires -PasswordNeverExpires \$true/);
assert.doesNotMatch(provisionSource, /Set-LocalUser[^\r\n]*-PasswordNeverExpires(?:\s*(?:\r?\n|$))/);
assert.match(roleProcessSource, /ValidateSet\('login','worker','logout'\)/);
assert.match(roleProcessSource, /WindowStyle Normal/);
assert.match(roleProcessSource, /@\('\/d','\/k',\$agyCommand\)/);
assert.doesNotMatch(roleProcessSource, /login-helper|RedirectStandardInput|CodeFile|WriteLine\(\$code\)/);

for (const workspace of [os.homedir(), path.dirname(os.homedir()), root, path.parse(root).root]) {
  const resultFile = path.join(os.tmpdir(), `agy-provision-guard-${randomUUID()}.txt`);
  try {
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
      '-File', provisionScript,
      '-AgyRoot', root,
      '-WorkspaceRoot', workspace,
      '-CredentialFile', missingCredential,
      '-OwnerHome', os.homedir(),
      '-OwnerSid', 'S-1-5-18',
      '-ResultFile', resultFile,
    ], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 1, `unsafe workspace was accepted: ${workspace}`);
    assert.match(readFileSync(resultFile, 'utf8'), /unsafe workspace root:/);
  } finally {
    rmSync(resultFile, { force: true });
  }
}

const safeResultFile = path.join(os.tmpdir(), `agy-provision-guard-${randomUUID()}.txt`);
try {
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', provisionScript,
    '-AgyRoot', root,
    '-WorkspaceRoot', path.join(root, 'test'),
    '-CredentialFile', missingCredential,
    '-OwnerHome', os.homedir(),
    '-OwnerSid', 'S-1-5-18',
    '-ResultFile', safeResultFile,
  ], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1);
  assert.doesNotMatch(readFileSync(safeResultFile, 'utf8'), /unsafe workspace root:/);
} finally {
  rmSync(safeResultFile, { force: true });
}

const metadata = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', [
  "$set=Get-Command Set-LocalUser",
  "$new=Get-Command New-LocalUser",
  "Write-Output ('SET_ACCOUNT=' + $set.Parameters['AccountNeverExpires'].ParameterType.FullName)",
  "Write-Output ('SET_PASSWORD=' + $set.Parameters['PasswordNeverExpires'].ParameterType.FullName)",
  "Write-Output ('NEW_ACCOUNT=' + $new.Parameters['AccountNeverExpires'].ParameterType.FullName)",
  "Write-Output ('NEW_PASSWORD=' + $new.Parameters['PasswordNeverExpires'].ParameterType.FullName)",
].join('; ')], { cwd: root, encoding: 'utf8', windowsHide: true });
assert.equal(metadata.status, 0, metadata.stderr || metadata.stdout || 'LocalAccounts metadata check failed');
assert.match(metadata.stdout, /SET_ACCOUNT=System\.Management\.Automation\.SwitchParameter/);
assert.match(metadata.stdout, /SET_PASSWORD=System\.Boolean/);
assert.match(metadata.stdout, /NEW_ACCOUNT=System\.Management\.Automation\.SwitchParameter/);
assert.match(metadata.stdout, /NEW_PASSWORD=System\.Management\.Automation\.SwitchParameter/);

for (const name of ['agy-provision-users.ps1', 'agy-role-process.ps1']) {
  const script = path.join(root, 'scripts', name);
  const escaped = script.replaceAll("'", "''");
  const command = [
    '$tokens=$null',
    '$errors=$null',
    "[System.Management.Automation.Language.Parser]::ParseFile('" + escaped + "', [ref]$tokens, [ref]$errors) | Out-Null",
    'if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 }',
    "Write-Output 'PASS'",
  ].join('; ');

  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', command], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || name + ' parser failed');
  assert.match(result.stdout, /PASS/);
}
console.log('agy-provision-script.test.js: ok');
