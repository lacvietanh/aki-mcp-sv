#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPanel } from '../scripts/config-page.js';
import { ROUTES } from '../scripts/panel.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const client = readFileSync(path.join(root, 'public', 'panel-client.js'), 'utf8');

const html = renderPanel({
  origin: null,
  ingress: 'funnel',
  client: {},
  passphrase: 'test',
  token: 'panel-token',
  accessToken: 'access-token',
  repoRoot: 'D:\\repo',
  rulesDir: 'C:\\rules',
  userDir: 'C:\\user-data',
  updateInfo: {},
  savedIngress: null,
  isDev: true,
});

assert.match(html, /7 · AGY multi-account pool/);
assert.match(html, /Create role identities/);
for (const role of ['advisor', 'executor', 'experiment', 'reviewer']) {
  assert.match(html, new RegExp(`data-agy-role="${role}"`));
  assert.match(html, new RegExp(`id="agyUser-${role}"`));
  assert.match(html, new RegExp(`id="agyAccount-${role}"`), `${role} must show the AGY account separately from its Windows user`);
  assert.doesNotMatch(html, new RegExp(`<input[^>]+id="agyUser-${role}"`), 'role identities must not be editable');
}
const poolSection = html.split('<section id="s7">')[1].split('</section>')[0];
assert.match(poolSection, /click <strong>Login<\/strong>, sign in directly in the visible AGY CLI, close that window, then click <strong>Start<\/strong>/);
assert.doesNotMatch(poolSection, /OAuth URL|OAuth code|Paste Google OAuth code|Submit code|agyOauth-|agyCode-|<form\b|data-act="submitAgyCode"/);
assert.match(client, /'AGY: ' \+ accountHandle/, 'account label must use the email local part returned by the worker');
assert.match(client, /' · last known'/, 'offline account labels must be marked as last known');
assert.match(client, /account is not eligible for Antigravity/, 'ineligible account state must remain visible');
assert.match(client, /' AGY ' \+ accountHandle/, 'quota accessibility label must name the matching account');
assert.match(client, /clearAgyUsage\(btn\.dataset\.role\)/, 'Login and Logout must discard old account quota labels');
assert.match(client, /markAgyUsageOffline\(btn\.dataset\.role\)/, 'Stop must mark quota values stale');
assert.match(client, /'\/api\/agy-pool\/usage'/, 'panel must load quota and identity snapshots');
const actions = ['initAgyPool','provisionAgyRoles','startAgyPool','stopAgyPool','refreshAgyPool','loginAgyRole','logoutAgyRole','startAgyRole','stopAgyRole'];
for (const action of actions) {
  assert.match(html, new RegExp(`data-act="${action}"`));
  assert.match(client, new RegExp(`\\b${action}:`), `${action} must have a client handler`);
}
assert.doesNotMatch(html, /saveAgyUsers|Save role users/);
assert.doesNotMatch(client, /saveAgyUsers|saveAgyUserInputs|collectAgyUsers/);
assert.match(client, /if \(!result\.ok\) \{[\s\S]*?throw new Error\(result\.message \|\| 'AGY role failed to start'\)/, 'single-role Start must surface readiness/eligibility failures as errors');
assert.match(client, /agyPoolProvision'\)\.hidden = !status\.provisionRequired/, 'Create role identities must stay visible when provisioning is incomplete');
assert.match(client, /role credential missing — click Create role identities/, 'credential-missing state must explain the repair action');
assert.match(client, /startAll\.disabled = Boolean\(status\.provisionRequired\)/, 'Start all must stay disabled until provisioning is complete');
assert.doesNotMatch(client, /submitAgyCode|submit-code|agyCode-|agyOauth-|loginPending|loginActive/);
assert.match(client, /stopped · after Login, close the AGY CLI window, then click Start/);

for (const endpoint of [
  '/api/agy-pool','/api/agy-pool/init','/api/agy-pool/provision',
  '/api/agy-pool/usage',
  '/api/agy-pool/login-role','/api/agy-pool/logout-role',
  '/api/agy-pool/start','/api/agy-pool/stop','/api/agy-pool/start-role','/api/agy-pool/stop-role',
]) {
  assert.match(client, new RegExp(endpoint.replaceAll('/', '\\/')), `${endpoint} must be called by the client`);
}

for (const route of [
  'GET /api/agy-pool','POST /api/agy-pool/init','POST /api/agy-pool/provision',
  'GET /api/agy-pool/usage','POST /api/agy-pool/usage',
  'POST /api/agy-pool/login-role','POST /api/agy-pool/logout-role',
  'POST /api/agy-pool/start','POST /api/agy-pool/stop','POST /api/agy-pool/start-role','POST /api/agy-pool/stop-role',
]) {
  assert.equal(typeof ROUTES[route], 'function', `${route} must be registered`);
}
assert.equal(ROUTES['POST /api/agy-pool/users'], undefined);
assert.equal(ROUTES['POST /api/agy-pool/submit-code'], undefined);

console.log('agy-pool-panel.test.js: ok');
