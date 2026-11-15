#!/usr/bin/env node
import './setup.js';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

// userdata.js reads AKI_MCP_DATA_DIR at import, so the env is set before oauth.js loads; the real ~/.aki/mcpsv is never touched.
const dir = mkdtempSync(path.join(os.tmpdir(), 'aki-callbacks-test-'));
process.env.AKI_MCP_DATA_DIR = dir;
const settingsFile = path.join(dir, 'setting.json');
const { matchCallback, readUserCallbacks, noteRefused, listRefused } = await import('../scripts/oauth-callbacks.js');
const { handleRegister, handleAuthorize, loadOrCreateClient } = await import('../scripts/oauth.js');
const { startPanel } = await import('../scripts/panel.js');

const writeSettings = (settings) => writeFileSync(settingsFile, typeof settings === 'string' ? settings : JSON.stringify(settings));
const saved = () => JSON.parse(readFileSync(settingsFile, 'utf8'));

const oauthServer = http.createServer((req, res) => (req.url.startsWith('/register') ? handleRegister(req, res) : handleAuthorize(req, res, 'pass', 'http://origin')));
oauthServer.listen(0, '127.0.0.1');
await once(oauthServer, 'listening');
const oauthBase = `http://127.0.0.1:${oauthServer.address().port}`;
const register = (body) => fetch(`${oauthBase}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const authorizePage = (clientId, redirectUri) => fetch(`${oauthBase}/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, code_challenge: 'x', code_challenge_method: 'S256' })}`);

const panelToken = 'panel-test-token';
const panel = startPanel({ port: 0, token: panelToken, origin: 'https://example.test', ingress: 'funnel', client: { clientId: 'test', clientSecret: 'test' }, passphrase: 'pass', updateInfo: { mcp: {}, rule: {} } });
if (!panel.listening) await once(panel, 'listening');
const panelBase = `http://127.0.0.1:${panel.address().port}`;
const panelApi = (method, route, body, token = panelToken) => fetch(panelBase + route, { method, headers: { 'Content-Type': 'application/json', 'x-panel-token': token }, body: body && JSON.stringify(body) });

after(async () => {
  oauthServer.close();
  panel.close();
  await once(panel, 'close');
  rmSync(dir, { recursive: true, force: true });
});

const builtInName = (uri) => {
  const found = matchCallback(uri);
  return found?.builtIn ? found.entry.name : null;
};

test('every built-in callback is accepted under its name', () => {
  writeSettings({});
  const expected = {
    'https://claude.ai/api/mcp/auth_callback': 'Claude',
    'https://chatgpt.com/connector_platform_oauth_redirect': 'ChatGPT',
    'https://chatgpt.com/connector/oauth/abc123': 'ChatGPT',
    'https://grok.com/connectors-oauth-exchange-code/': 'Grok',
    'https://search.clickup-prod.com/connect/mcp': 'ClickUp',
    'https://oauth-redirect.googleusercontent.com/r/x': 'Gemini',
    'https://oauth-redirect-sandbox.googleusercontent.com/': 'Gemini',
    'https://oauth-redirect-test.googleusercontent.com/': 'Gemini',
  };
  for (const host of ['notion.so', 'www.notion.so', 'app.notion.so', 'notion.com', 'www.notion.com', 'app.notion.com', 'mcp.notion.com']) expected[`https://${host}/mcp/oauth/callback`] = 'Notion';
  for (const [uri, name] of Object.entries(expected)) assert.equal(builtInName(uri), name, uri);
});

test('a callback matches its parsed entry: no trailing slash, :443, uppercase scheme or host', () => {
  writeSettings({});
  assert.equal(builtInName('https://oauth-redirect.googleusercontent.com'), 'Gemini');
  assert.equal(builtInName('https://claude.ai:443/api/mcp/auth_callback'), 'Claude');
  assert.equal(builtInName('HTTPS://CLAUDE.AI/api/mcp/auth_callback'), 'Claude');
  assert.equal(builtInName('https://GROK.com/connectors-oauth-exchange-code/x'), 'Grok');
});

test('user entries: each invalid one is skipped with its reason, valid ones apply, duplicates collapse', () => {
  const long = 'https://a.example/' + 'x'.repeat(2048);
  writeSettings({ folders: ['/kept'], oauth: { callbacks: [
    'nope',
    { match: 'host', value: 'https://a.example/' },
    { match: 'exact' },
    { match: 'exact', value: long },
    { match: 'exact', value: 'https://a.example/cb#x' },
    { match: 'exact', value: 'a.example/cb' },
    { match: 'exact', value: 'http://a.example/cb' },
    { match: 'exact', value: 'https://u:p@a.example/cb' },
    { match: 'exact', value: 'https://127.0.0.1/cb' },
    { match: 'exact', value: 'https://[::1]/cb' },
    { match: 'exact', value: 'https://a.example./cb' },
    { match: 'exact', value: 'https://localhost/cb' },
    { match: 'prefix', value: 'https://a.example/' },
    { match: 'prefix', value: 'https://a.example/cb' },
    { match: 'exact', value: 'https://ok.example/cb?x=1' },
    { match: 'exact', value: 'HTTPS://OK.EXAMPLE:443/cb?x=1' },
    { match: 'prefix', value: 'https://ok.example/oauth/?dropped=1' },
    { match: 'exact', value: 'https://bücher.example/cb' },
  ] } });
  const { entries, skipped, readError } = readUserCallbacks();
  assert.equal(readError, null);
  assert.deepEqual(skipped.map((s) => s.reason), [
    'an entry needs a match and an address',
    'match must be "exact" or "prefix"',
    'the address is missing',
    'the address is longer than 2,048 characters',
    'the address must not contain #',
    'the address is not a full URL, like https://example.com/callback',
    'the address must start with https://',
    'the address must not contain a user name or password',
    'the address must use a domain name, not an IP address',
    'the address must use a domain name, not an IP address',
    'the domain name must not end with a dot',
    'the domain name needs a dot, like example.com',
    'a prefix needs a path that ends with /, like https://example.com/oauth/',
    'a prefix needs a path that ends with /, like https://example.com/oauth/',
  ]);
  assert.equal(skipped[0].entry, '"nope"');
  assert.deepEqual(entries, [
    { match: 'exact', value: 'https://ok.example/cb?x=1', host: 'ok.example' },
    { match: 'prefix', value: 'https://ok.example/oauth/', host: 'ok.example' },
    { match: 'exact', value: 'https://xn--bcher-kva.example/cb', host: 'xn--bcher-kva.example' },
  ]);
  const own = (uri) => matchCallback(uri)?.builtIn === false;
  assert.ok(own('https://ok.example/cb?x=1'), 'a query-bearing callback added as exact matches');
  assert.ok(!own('https://ok.example/cb'), 'exact needs the query too');
  assert.ok(own('https://ok.example/oauth/any/path?q=1'));
  assert.ok(!own('https://ok.example/oauth/%2e%2e/cb'));
  assert.ok(own('https://bücher.example/cb'), 'an IDN host matches its parsed entry');
  assert.equal(builtInName('https://claude.ai/api/mcp/auth_callback'), 'Claude', 'built-ins still apply');
});

test('an unreadable or non-object setting.json means built-ins only with the read error; a misshapen oauth or oauth.callbacks is reported as skipped', () => {
  writeSettings('{ not json');
  const unreadable = readUserCallbacks();
  assert.deepEqual(unreadable.entries, []);
  assert.match(unreadable.readError, /JSON/);
  assert.equal(builtInName('https://claude.ai/api/mcp/auth_callback'), 'Claude');
  writeSettings('[]');
  assert.deepEqual(readUserCallbacks(), { entries: [], skipped: [], readError: 'setting.json is not a JSON object' });
  writeSettings({ oauth: { callbacks: { match: 'exact', value: 'https://ok.example/cb' } } });
  assert.deepEqual(readUserCallbacks(), { entries: [], skipped: [{ entry: '{"match":"exact","value":"https://ok.example/cb"}', reason: 'oauth.callbacks must be a list in [ ], so it is ignored' }], readError: null });
  assert.equal(matchCallback('https://ok.example/cb'), null);
  writeSettings({ oauth: 'x' });
  assert.deepEqual(readUserCallbacks().skipped, [{ entry: '"x"', reason: 'oauth must be an object in { }, so it is ignored' }]);
});

test('the refused list keeps the newest 20 rows, groups one registration\'s callbacks, and gives the reason a callback cannot be added', () => {
  writeSettings({});
  for (let i = 0; i < 21; i++) noteRefused([`https://flood${i}.example/cb`], `flood ${i}`);
  let rows = listRefused();
  assert.equal(rows.length, 20);
  assert.equal(rows[0].clientName, 'flood 20');
  assert.ok(!rows.some((row) => row.clientName === 'flood 0'), 'the oldest row is dropped');
  noteRefused(['https://group.example/a/b', 'https://group.example/c'], 'Grouped');
  noteRefused(['https://group.example/c', 'https://group.example/a/b']);
  rows = listRefused();
  assert.equal(rows.length, 20);
  assert.deepEqual(rows[0].callbacks, [
    { href: 'https://group.example/a/b', shown: 'https://group.example/a/b', host: 'group.example', prefix: 'https://group.example/a/', reason: null },
    { href: 'https://group.example/c', shown: 'https://group.example/c', host: 'group.example', prefix: null, reason: null },
  ]);
  assert.equal(rows[0].count, 2);
  assert.equal(rows[0].clientName, 'Grouped');
  noteRefused(['http://localhost/a/cb']);
  assert.deepEqual(listRefused()[0].callbacks, [{ href: 'http://localhost/a/cb', shown: 'http://localhost/a/cb', host: 'localhost', prefix: null, reason: 'the address must start with https://' }]);
});

test('/register refuses an unknown callback with a hint and a refused row; after Add the same registration passes, and Remove stops /authorize', async () => {
  writeSettings({ folders: ['/kept'] });
  const callback = 'https://new-ai.example/oauth/cb?tenant=1';
  const refused = await register({ redirect_uris: [callback], client_name: 'New AI' });
  assert.equal(refused.status, 400);
  assert.deepEqual(await refused.json(), { error: 'invalid_redirect_uri', error_description: 'This AI\'s sign-in address is not allowed yet. On the computer running AkiMCP, open the control panel, section 1 → Web → Other AI (sign-in), click Add, then connect again.' });
  const [row] = listRefused();
  assert.deepEqual([row.callbacks[0].href, row.callbacks[0].shown, row.clientName], [callback, 'https://new-ai.example/oauth/cb', 'New AI']);

  assert.equal((await panelApi('POST', '/api/oauth-callbacks/add', { match: 'exact', value: row.callbacks[0].href })).status, 200);
  assert.ok(!listRefused().some((r) => r.callbacks[0].href === callback), 'a row whose callbacks are all allowed now leaves the list');
  const accepted = await register({ redirect_uris: [callback], client_name: 'New AI' });
  assert.equal(accepted.status, 201);
  const { client_id: clientId } = await accepted.json();

  const page = await authorizePage(clientId, callback);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /the sign-in returns to <strong>https:\/\/new-ai\.example\/oauth\/cb<\/strong> \(added in your AkiMCP panel\)/);
  assert.equal(html.match(/name="passphrase"/g).length, 1);
  assert.deepEqual(html.match(/<button[^>]*>[^<]*<\/button>/g), ['<button type="submit" name="btn">Approve</button>']);

  const claude = await (await register({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] })).json();
  assert.match(await (await authorizePage(claude.client_id, 'https://claude.ai/api/mcp/auth_callback')).text(), /returns to <strong>https:\/\/claude\.ai\/api\/mcp\/auth_callback<\/strong> \(built in: Claude\)/);
  const gemini = await (await register({ redirect_uris: ['https://oauth-redirect.googleusercontent.com/r/x'] })).json();
  assert.match(await (await authorizePage(gemini.client_id, 'https://oauth-redirect.googleusercontent.com/r/x')).text(), /\(built in: Gemini, through Google's shared sign-in relay\)/);

  assert.equal((await panelApi('POST', '/api/oauth-callbacks/remove', { match: 'exact', value: callback })).status, 200);
  assert.equal((await authorizePage(clientId, callback)).status, 400, 'a registered client whose address was removed cannot sign in again');
});

test('/register without a usable callback says why instead of pointing to Add', async () => {
  writeSettings({});
  const descriptions = {};
  for (const uris of [[], ['http://localhost:3000/cb'], ['https://mixed.example/cb', 'https://localhost/cb']]) {
    const res = await register({ redirect_uris: uris });
    assert.equal(res.status, 400);
    descriptions[uris.join(' ')] = (await res.json()).error_description;
  }
  assert.deepEqual(descriptions, {
    '': 'This AI sent no sign-in address (redirect_uris), so AkiMCP cannot sign it in.',
    'http://localhost:3000/cb': 'This AI\'s sign-in address cannot be used with AkiMCP (the address must start with https://).',
    'https://mixed.example/cb https://localhost/cb': 'This AI\'s sign-in address cannot be used with AkiMCP (the domain name needs a dot, like example.com).',
  });
});

test('/authorize feeds the refused list for the static client and a reclaimed client id', async () => {
  writeSettings({});
  const { clientId: staticId } = loadOrCreateClient();
  assert.equal((await authorizePage(staticId, 'https://static-ai.example/cb')).status, 400);
  assert.equal(listRefused()[0].callbacks[0].href, 'https://static-ai.example/cb');
  assert.equal((await authorizePage('a'.repeat(32), 'https://reclaim-ai.example/cb')).status, 400);
  assert.equal(listRefused()[0].callbacks[0].href, 'https://reclaim-ai.example/cb');
  assert.equal(listRefused()[0].clientName, null);
});

test('panel routes: four fields, add validates, remove, every other setting kept, panel token required', async () => {
  writeSettings({ folders: ['/kept'], shell: { allowlistDirs: ['/zone'] }, oauth: { other: 1, callbacks: [{ match: 'host', value: 'x' }, { match: 'exact', value: 'HTTPS://Norm.Example:443/cb' }] } });
  assert.equal((await panelApi('POST', '/api/oauth-callbacks/remove', { match: 'exact', value: 'https://norm.example/cb' })).status, 200, 'an entry stored in another form of the same address is removed');
  assert.match(readFileSync(path.join(dir, 'security.log'), 'utf8'), /oauth callback removed: exact https:\/\/norm\.example\/cb/);
  const listed = await (await panelApi('GET', '/api/oauth-callbacks')).json();
  assert.deepEqual(Object.keys(listed).sort(), ['entries', 'readError', 'refused', 'skipped']);
  assert.deepEqual(listed.skipped, [{ entry: '{"match":"host","value":"x"}', reason: 'match must be "exact" or "prefix"' }]);

  const invalid = await panelApi('POST', '/api/oauth-callbacks/add', { match: 'prefix', value: 'https://p.example/cb' });
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: 'a prefix needs a path that ends with /, like https://example.com/oauth/' });

  assert.equal((await panelApi('POST', '/api/oauth-callbacks/add', { match: 'prefix', value: 'https://p.example/oauth/' })).status, 200);
  assert.deepEqual(saved(), { folders: ['/kept'], shell: { allowlistDirs: ['/zone'] }, oauth: { other: 1, callbacks: [{ match: 'host', value: 'x' }, { match: 'prefix', value: 'https://p.example/oauth/' }] } });
  assert.deepEqual((await (await panelApi('GET', '/api/oauth-callbacks')).json()).entries, [{ match: 'prefix', value: 'https://p.example/oauth/', host: 'p.example' }]);
  assert.match(readFileSync(path.join(dir, 'security.log'), 'utf8'), /oauth callback added: prefix https:\/\/p\.example\/oauth\//);

  assert.equal((await panelApi('POST', '/api/oauth-callbacks/remove', { match: 'prefix', value: 'https://p.example/oauth/' })).status, 200);
  assert.deepEqual(saved(), { folders: ['/kept'], shell: { allowlistDirs: ['/zone'] }, oauth: { other: 1, callbacks: [{ match: 'host', value: 'x' }] } });

  for (const [method, route] of [['GET', '/api/oauth-callbacks'], ['POST', '/api/oauth-callbacks/add'], ['POST', '/api/oauth-callbacks/remove']]) {
    assert.equal((await panelApi(method, route, method === 'POST' ? { match: 'exact', value: 'https://p.example/cb' } : undefined, 'wrong')).status, 403, route);
  }
  assert.deepEqual(saved().oauth.callbacks, [{ match: 'host', value: 'x' }], 'a refused call writes nothing');
});

test('add and remove refuse to overwrite a setting.json they cannot keep intact', async () => {
  const cases = {
    '{ not json': /^setting\.json cannot be read \(.*JSON.*\): fix or remove it, then try again$/,
    '[]': /^setting\.json cannot be read \(setting\.json is not a JSON object\): fix or remove it, then try again$/,
    '{"folders":["/kept"],"oauth":{"callbacks":"x"}}': /^setting\.json: oauth\.callbacks must be a list in \[ \], so AkiMCP will not overwrite it\. Fix or remove it, then try again\.$/,
  };
  for (const [raw, expected] of Object.entries(cases)) {
    writeSettings(raw);
    for (const route of ['/api/oauth-callbacks/add', '/api/oauth-callbacks/remove']) {
      const res = await panelApi('POST', route, { match: 'exact', value: 'https://p.example/cb' });
      assert.equal(res.status, 400, `${route} ${raw}`);
      assert.match((await res.json()).error, expected, `${route} ${raw}`);
      assert.equal(readFileSync(settingsFile, 'utf8'), raw, 'the file is left exactly as it was');
    }
  }
});
