#!/usr/bin/env node
import './setup.js';
import assert from 'node:assert/strict';

const { renderPanel } = await import('../scripts/config-page.js');
const render = (origin) => renderPanel({ origin, client: {}, passphrase: 'p', token: 't', accessToken: 'SECRETTOK', repoRoot: '/', rulesDir: '/', userDir: '/' });
const pane = (page, tab) => page.split(`id="tab-${tab}"`)[1].split(/class="tabpane|<\/section>/)[0];
const snippet = (html, id) => html.split(`id="${id}"`)[1].split('</code>')[0];

const REMOTE_IDS = { anymcp: 'anyMcpJsonRemote', cursor: 'cursorJsonRemote', claudelocal: 'claudeCodeCmdRemote', codex: 'codexTomlRemote' };
const LOCAL_IDS = { anymcp: 'anyMcpJson', cursor: 'cursorJson', claudelocal: 'claudeCodeCmd', codex: 'codexToml' };

const live = render('https://host.example');
for (const tab of Object.keys(REMOTE_IDS)) {
  const html = pane(live, tab);
  assert.ok(html.includes('From another computer (via the section 0 address)'), `${tab}: the remote block is titled`);
  assert.ok(snippet(html, LOCAL_IDS[tab]).includes('http://127.0.0.1:'), `${tab}: the primary snippet stays on loopback`);
  const remote = snippet(html, REMOTE_IDS[tab]);
  assert.ok(remote.includes('https://host.example/mcp') && remote.includes('SECRETTOK') && !remote.includes('127.0.0.1'), `${tab}: the remote snippet carries the public URL and the token`);
  assert.ok(!html.includes('>Copy<'), `${tab}: snippets copy on click, no extra Copy button`);
  assert.equal(html.split('legacy-hint').length - 1, tab === 'claudelocal' ? 3 : 1, `${tab}: one legacy hint per snippet group, none inside the remote block`);
  assert.equal(html.includes('Apply does this for you'), tab !== 'anymcp', `${tab}: the hint offers Apply only where the tab has one`);
  assert.equal(html.split('data-act=').length - 1, tab === 'anymcp' ? 0 : 1, `${tab}: Apply stays on the primary block only, and the generic tab has none`);
}

const bare = render(null);
for (const tab of Object.keys(REMOTE_IDS)) {
  const html = pane(bare, tab);
  assert.ok(html.includes('Set up a public address in <a href="#s0">section 0</a> first, so another computer can reach this one.'), `${tab}: no origin shows the section 0 notice`);
  assert.ok(!html.includes(REMOTE_IDS[tab]), `${tab}: no remote snippet without an origin`);
}

console.log('remote-snippet.test.js: ok');
