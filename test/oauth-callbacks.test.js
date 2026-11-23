#!/usr/bin/env node
import './setup.js';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import vm from 'node:vm';

// userdata.js reads AKI_MCP_DATA_DIR at import, so the env is set before oauth.js loads; the real ~/.aki/mcpsv is never touched.
const dir = mkdtempSync(path.join(os.tmpdir(), 'aki-callbacks-test-'));
process.env.AKI_MCP_DATA_DIR = dir;
const settingsFile = path.join(dir, 'setting.json');
const { matchCallback, readUserCallbacks, noteRefused, listRefused, addableRefusedHosts, formatRefusedBanner } = await import('../scripts/oauth-callbacks.js');
const { renderPanel } = await import('../scripts/config-page.js');
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

test('addableRefusedHosts deduplicates by parsed host, ignores unaddable and already-allowed callbacks (mixed-row safe), and formats D8 banner', () => {
  const rows = [
    {
      clientName: 'SPOOFED <script>alert(1)</script>',
      callbacks: [
        { href: 'https://newest.example/cb1', host: 'newest.example', reason: null },
        { href: 'http://localhost:3000/bad', host: 'localhost:3000', reason: 'the address must start with https://' },
      ],
    },
    {
      clientName: 'Second Path Same Host',
      callbacks: [{ href: 'https://newest.example/cb2', host: 'newest.example', reason: null }],
    },
    {
      clientName: 'Older Host',
      callbacks: [{ href: 'https://older.example/cb', host: 'older.example', reason: null }],
    },
  ];
  assert.deepEqual(addableRefusedHosts(rows, []), ['newest.example', 'older.example']);
  assert.equal(formatRefusedBanner(['newest.example']), 'An AI tried to sign in through newest.example, which AkiMCP does not allow yet.');
  assert.equal(formatRefusedBanner(['newest.example', 'older.example']), 'An AI tried to sign in through newest.example (+1 more), which AkiMCP does not allow yet.');
  assert.equal(formatRefusedBanner([]), '');

  // Mixed-callback row stays in listRefused() because of http://localhost, yet once https://newest.example/cb1 and /cb2 are allowed, newest.example leaves the banner/badge.
  const entries = [{ match: 'prefix', value: 'https://newest.example/' }];
  assert.deepEqual(addableRefusedHosts(rows, entries), ['older.example']);
  assert.deepEqual(addableRefusedHosts([rows[0]], [{ match: 'exact', value: 'https://newest.example/cb1' }]), []);
  assert.doesNotMatch(formatRefusedBanner(addableRefusedHosts(rows, [])), /SPOOFED|script/);
});

test('SSR panel renders #refusedCallbackBanner and #otherAiBadge accurately and protects [hidden] in panel.css', async () => {
  writeSettings({});
  const panelCss = readFileSync(new URL('../public/panel.css', import.meta.url), 'utf8');
  assert.match(panelCss, /\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/, 'panel.css protects [hidden] from display overrides');
  assert.match(panelCss, /\.tab-badge\s*\{/, 'panel.css styles .tab-badge');

  // Allow every previously refused addable callback in this test process via a clean helper check + live mixed-callback row SSR check.
  const render = () => renderPanel({ origin: 'https://example.test', ingress: 'funnel', client: {}, passphrase: 'pass', token: 'tok', accessToken: 'acc', repoRoot: '/', rulesDir: '/', userDir: '/' });

  // Add a fresh mixed-callback refused row (1 addable + 1 unaddable) with hostile clientName.
  const mixedAddable = 'https://ssr-signal.example/oauth/cb';
  noteRefused([mixedAddable, 'http://127.0.0.1:9999/bad'], 'EVIL_CLIENT_NAME_<img src=x>');
  const htmlBefore = render();
  assert.match(htmlBefore, /<div class="updbar updrow" id="refusedCallbackBanner" role="status" aria-live="polite"><span id="refusedCallbackText">An AI tried to sign in through ssr-signal\.example/, 'visible SSR banner leads with newest addable parsed host and status role');
  assert.doesNotMatch(htmlBefore, /EVIL_CLIENT_NAME_/, 'D8: SSR banner never renders self-declared clientName');
  const expectedCount = addableRefusedHosts().length;
  assert.ok(expectedCount >= 1);
  assert.match(htmlBefore, new RegExp(`<span id="otherAiBadge" class="tab-badge">${expectedCount}</span>`), 'SSR badge count matches unique addable hosts');

  // Allow every currently addable refused callback (including mixedAddable) so addableRefusedHosts() drops to 0 even though the mixed row stays in listRefused().
  const allAddableHrefs = [...new Set(listRefused().flatMap((r) => r.callbacks.filter((c) => !c.reason).map((c) => c.href)))];
  writeSettings({ oauth: { callbacks: allAddableHrefs.map((value) => ({ match: 'exact', value })) } });
  assert.ok(listRefused().some((r) => r.callbacks.some((c) => c.href === mixedAddable)), 'mixed row still lives in listRefused() due to unaddable sibling');
  assert.deepEqual(addableRefusedHosts(), [], 'addableRefusedHosts drops to [] once every addable callback is allowed');
  const htmlAfter = render();
  assert.match(htmlAfter, /<div class="updbar updrow" id="refusedCallbackBanner" role="status" aria-live="polite" hidden><span id="refusedCallbackText"><\/span>/, 'SSR banner is hidden when no addable refused hosts remain');
  const configPageSrc = readFileSync(new URL('../scripts/config-page.js', import.meta.url), 'utf8');
  assert.doesNotMatch(configPageSrc, /<button(?![^>]*\btype="button")/, 'every config-page.js button explicitly declares type="button"');
  assert.match(htmlAfter, /<code class="copy[^"]*"[^>]*\btabindex="0"\s+role="button"/, 'copyEl renders keyboard-focusable role="button" with tabindex="0"');
  assert.match(panelCss, /\.copy:focus-visible,\s*th\[data-sort\]:focus-visible\s*\{\s*outline:\s*2px\s+solid\s+var\(--accent\)/, 'panel.css defines unified :focus-visible outline');
  assert.match(htmlAfter, /<span id="otherAiBadge" class="tab-badge" hidden><\/span>/, 'SSR badge is hidden when addable count is 0');
});

test('panel-client.js callback sync, passive throttle/lock, monotonic seq race guard, and openOtherAi single-fetch', async () => {
  const clientSrc = readFileSync(new URL('../public/panel-client.js', import.meta.url), 'utf8');
  const startIdx = clientSrc.indexOf("const CALLBACK_MATCH_LABEL =");
  const endIdx = clientSrc.indexOf("let limitDefaults = {};");
  assert.ok(startIdx > 0 && endIdx > startIdx, 'callback section exists in panel-client.js');
  const slice = clientSrc.slice(startIdx, endIdx);
  assert.doesNotMatch(slice.replace(/\/\/.*/g, ''), /innerHTML/, 'panel-client callback sync never uses innerHTML');

  const els = {
    refusedCallbackBanner: { hidden: true },
    refusedCallbackText: { textContent: '' },
    otherAiBadge: { hidden: true, textContent: '' },
    callbacksReadError: { hidden: true, textContent: '' },
    skippedCallbacks: { replaceChildren() {} },
  };
  let now = 10_000;
  const pending = [];
  const apiCalls = [];
  const sandbox = {
    URL,
    Date: { now: () => now },
    NOT_SORTABLE: {},
    document: { getElementById: (id) => els[id] || null },
    renderTable: () => {},
    mutedNote: (t) => t,
    timeCell: (t) => String(t),
    refusedAddressCell: () => {},
    removeCallbackButton: () => {},
    api: (method, route) => {
      apiCalls.push({ method, route });
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(slice + '\nthis.__exports = { loadCallbacks, maybeRefreshCallbacks, syncRefusedSignal };', sandbox);
  const { loadCallbacks, maybeRefreshCallbacks, syncRefusedSignal } = sandbox.__exports;

  // 1. Passive refresh triggers once; concurrent and <5s calls are suppressed.
  maybeRefreshCallbacks();
  maybeRefreshCallbacks();
  assert.equal(apiCalls.length, 1, 'in-flight passive lock suppresses duplicate passive fetch');

  // 2. Explicit loadCallbacks() bypasses passive lock and wins race over slower passive req #1.
  const explicit = loadCallbacks();
  assert.equal(apiCalls.length, 2, 'explicit loadCallbacks bypasses passive lock');
  const freshPayload = {
    entries: [{ match: 'exact', value: 'https://a.example/cb', host: 'a.example' }],
    skipped: [],
    readError: null,
    refused: [{ clientName: 'SECRET_NAME', callbacks: [{ href: 'https://a.example/cb', host: 'a.example', reason: null }, { href: 'http://localhost/x', host: 'localhost', reason: 'bad' }] }],
  };
  const stalePayload = {
    entries: [],
    skipped: [],
    readError: null,
    refused: [{ clientName: 'SECRET_NAME', callbacks: [{ href: 'https://a.example/cb', host: 'a.example', reason: null }] }],
  };
  // Req #2 (explicit, newer) resolves first -> hides banner & badge.
  pending[1].resolve(freshPayload);
  await explicit;
  assert.equal(els.refusedCallbackBanner.hidden, true);
  assert.equal(els.otherAiBadge.hidden, true);
  assert.equal(els.otherAiBadge.textContent, '');

  // Req #1 (passive, older) resolves late -> MUST NOT overwrite newer explicit state!
  pending[0].resolve(stalePayload);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(els.refusedCallbackBanner.hidden, true, 'stale passive response cannot re-open banner');
  assert.equal(els.otherAiBadge.hidden, true, 'stale passive response cannot re-open badge');

  // 3. Throttle blocks passive refresh within 5000ms, allows at >= 5000ms.
  now += 4999;
  maybeRefreshCallbacks();
  assert.equal(apiCalls.length, 2, 'passive refresh throttled under 5000ms');
  now += 1;
  maybeRefreshCallbacks();
  assert.equal(apiCalls.length, 3, 'passive refresh allowed at >= 5000ms');
  // Passive error is swallowed silently without advancing lastCallbacksAt.
  pending[2].reject(new Error('restarting'));
  await new Promise((r) => setTimeout(r, 0));
  maybeRefreshCallbacks();
  assert.equal(apiCalls.length, 4, 'failed passive refresh does not lock out next retry');
  pending[3].resolve(stalePayload);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(els.refusedCallbackBanner.hidden, false);
  assert.equal(els.refusedCallbackText.textContent, 'An AI tried to sign in through a.example, which AkiMCP does not allow yet.');
  assert.doesNotMatch(els.refusedCallbackText.textContent, /SECRET_NAME/);
  assert.equal(els.otherAiBadge.hidden, false);
  assert.equal(els.otherAiBadge.textContent, '1');

  // 4. Direct syncRefusedSignal clears when addable count drops to 0.
  syncRefusedSignal([], []);
  assert.equal(els.refusedCallbackBanner.hidden, true);
  assert.equal(els.otherAiBadge.hidden, true);
  assert.equal(els.otherAiBadge.textContent, '');

  // 5. openOtherAi guards against double-clicking otherai when already active.
  assert.match(clientSrc, /openOtherAi:\s*\(\)\s*=>\s*\{[\s\S]*if\s*\(!tab\.classList\.contains\('active'\)\)\s*tab\.click\(\);/);

  // 6. A-M1 & A-N1: copyEl keyboard Enter/Space, clipboard .catch(), addChip/addPath/addTrustedDir remove button aria-label, Enter submit on #tempName/#callbackValue, and non-JSON api() guard.
  assert.match(clientSrc, /document\.addEventListener\('keydown',[\s\S]*e\.key !== 'Enter' && e\.key !== ' '[\s\S]*e\.preventDefault\(\);\s*copyFromEl\(el\);/, 'panel-client handles Enter/Space on .copy');
  assert.match(clientSrc, /x\.type = 'button'; x\.className = 'x'; x\.title = `Remove \$\{bin\}`; x\.setAttribute\('aria-label', `Remove \$\{bin\}`\);/, 'addChip creates a <button type="button" class="x"> with aria-label');
  assert.match(clientSrc, /del\.type = 'button'; del\.title = 'Remove folder'; del\.setAttribute\('aria-label', 'Remove folder'\);/, 'addPath delete button has aria-label');
  assert.match(clientSrc, /del\.type = 'button'; del\.title = 'Remove directory'; del\.setAttribute\('aria-label', 'Remove directory'\);/, 'addTrustedDir delete button has aria-label');
  assert.match(clientSrc, /getElementById\('tempName'\)[\s\S]*mintTemp[\s\S]*getElementById\('callbackValue'\)[\s\S]*addCallback/, '#tempName and #callbackValue submit on Enter');
  assert.match(clientSrc, /res\.json\(\)\.catch\(\(\) => null\)/, 'api() guards against non-JSON error responses');
});
