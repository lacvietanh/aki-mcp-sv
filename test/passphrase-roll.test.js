#!/usr/bin/env node
import './setup.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AKI_MCP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aki-pass-'));
const { loadOrCreatePassphrase, rotatePassphrase } = await import('../scripts/oauth.js');
const { renderPanel } = await import('../scripts/config-page.js');

const before = loadOrCreatePassphrase();
const after = rotatePassphrase();
assert.notEqual(after, before, 'a roll must issue a different passphrase');
assert.equal(loadOrCreatePassphrase(), after, 'the rolled passphrase must be the one read next');
for (const p of [before, after]) assert.match(p, /^[abcdefghjkmnpqrstuvwxyz23456789]{10}$/, 'first-load and rolled passphrases use the unambiguous alphabet');

const html = renderPanel({ origin: null, client: {}, passphrase: after, token: 't', accessToken: 'SECRETTOK', repoRoot: '/', rulesDir: '/', userDir: '/' });
assert.ok(!html.includes(`>${after}<`), 'passphrase must not be visible in the rendered text');
assert.ok(!html.includes('>SECRETTOK<'), 'access token must not be visible in the rendered text');
assert.ok(html.includes(`data-v="${after}"`) && html.includes('data-v="SECRETTOK"'), 'copy must still carry the real values');
assert.ok(html.includes('data-eye') && html.includes('data-act="rollPassphrase"'));

const live = renderPanel({ origin: 'https://example.test', client: {}, passphrase: after, token: 't', accessToken: 'SECRETTOK', repoRoot: '/', rulesDir: '/', userDir: '/' });
assert.ok(live.includes('data-tab="buda"') && live.includes('id="tab-buda"'), 'Buda tab and pane are rendered');
const budaPane = live.split('id="tab-buda"')[1].split('class="tabpane"')[0];
assert.ok(budaPane.includes('>https://example.test/mcp<'), 'Buda pane carries the public MCP URL');
assert.ok(budaPane.includes('data-v="Bearer SECRETTOK"'), 'Buda pane carries the Bearer header value');
const geminiPane = live.split('id="tab-gemini"')[1].split('class="tabpane"')[0];
assert.ok(geminiPane.includes('<strong>Next</strong>') && geminiPane.includes('<strong>Approve</strong>'), 'Gemini pane walks the Next / Approve account-linking flow');
assert.ok(!geminiPane.includes('Client secret'), 'Gemini pane no longer asks for a pasted Client ID/Secret as a step');

const secretPage = renderPanel({ origin: 'https://example.test', client: {}, passphrase: after, token: 't', accessToken: 'SECRETTOK', repoRoot: '/', rulesDir: '/', userDir: '/' });
const outsideCopyAttr = secretPage.replace(/data-v="[^"]*"/g, '');
for (const [name, secret] of [['passphrase', after], ['access token', 'SECRETTOK']]) {
  assert.ok(!outsideCopyAttr.includes(secret), `the ${name} appears only inside the copy attribute`);
}
for (const id of ['postmanJson', 'cursorJson', 'claudeCodeCmd', 'codexToml']) {
  const snippet = secretPage.split(`id="${id}"`)[1].split('</code>')[0];
  assert.ok(snippet.includes('data-v="') && snippet.includes('SECRETTOK'), `${id} copies the real token`);
  assert.ok(snippet.split('</span>')[0].split('>').pop().includes('•'.repeat(12)), `${id} shows the mask`);
}

const maskedSpans = [...secretPage.matchAll(/<span class="txt" data-v="[^"]*" data-mask="([^"]*)">([^<]*)<\/span>/g)];
assert.equal(maskedSpans.length, 10, 'passphrase, access token, Buda header, the four snippets and the three from-another-computer snippets carry a data-mask');
for (const [, mask, shown] of maskedSpans) {
  assert.equal(shown, mask, 'the visible text is the data-mask, so hiding again restores it');
  assert.ok(!mask.includes('SECRETTOK') && !mask.includes(after), 'the masked text holds no secret');
}
assert.ok(secretPage.split('id="postmanJson"')[1].split('</code>')[0].includes(`Bearer ${'•'.repeat(12)}`), 'a hidden snippet keeps its structure around the mask');

const emptyToken = renderPanel({ origin: null, client: {}, passphrase: after, token: 't', accessToken: '', repoRoot: '/', rulesDir: '/', userDir: '/' });
const emptyPostman = emptyToken.split('id="postmanJson"')[1].split('</code>')[0];
assert.ok(emptyPostman.includes('127.0.0.1') && !emptyPostman.includes('•') && !emptyPostman.includes('data-v'), 'an empty secret leaves the snippet untouched');

for (const [name, page] of [['no ingress', html], ['live ingress', live]]) {
  const sectionIds = [...page.matchAll(/<section id="(s\d+)"/g)].map((m) => m[1]);
  assert.deepEqual(sectionIds, ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'], `${name}: sections in order`);
  for (const [, id] of page.matchAll(/href="#(s\d+)"/g)) assert.ok(sectionIds.includes(id), `${name}: href="#${id}" resolves to a section`);
  for (const id of sectionIds) {
    const heading = page.split(`<section id="${id}"`)[1].match(/(\d+) · /)[1];
    assert.equal(`s${heading}`, id, `${name}: ${id} heading number`);
  }
  for (const [, id, label] of page.matchAll(/<a href="#(s\d+)"><span class="step-n">(\d+)<\/span>/g)) assert.equal(`s${label}`, id, `${name}: stepper number for ${id}`);
}
assert.ok(!html.includes('Browser utilities') && !html.includes('chromewebstore.google.com'), 'the extension section is gone');

const ecoLinks = [...html.matchAll(/<a class="eco-link" href="([^"]*)" target="_blank" rel="([^"]*)"><img class="eco-icon" src="([^"]*)"/g)];
assert.equal(ecoLinks.length, 25, 'the footer lists the 25 canonical products');
for (const [, , , icon] of ecoLinks) assert.match(icon, /^https:\/\/akitao\.com\/pj\/icon-[^/]+-96\.png$/, 'every footer icon carries scheme and host');
assert.ok(ecoLinks.every(([, href]) => href.endsWith('utm_source=akimcp-panel&amp;utm_medium=footer')), 'every product link carries the panel UTM');
assert.ok(ecoLinks.some(([, href, rel]) => href.startsWith('https://aiobox.app') && rel === 'noopener'), 'an Aki-owned domain keeps its referrer');
assert.ok(ecoLinks.some(([, href, rel]) => href.startsWith('https://vstshop.com') && rel === 'noopener noreferrer'), 'a third-party domain drops it');
const socials = [...html.matchAll(/<a class="social" href="([^"]*)"/g)].map((m) => m[1]);
assert.equal(socials.length, 6, 'five socials plus the mailto');
assert.ok(socials.every((href) => !href.includes('utm_')) && socials.includes('https://m.me/akinet?t=fromakimcp'), 'social links carry no UTM');

const aioboxSection = (page) => page.split('<section id="s8">')[1].split('</section>')[0];
const pitch = aioboxSection(html);
assert.ok(pitch.includes('All your AI. Working together.') && pitch.includes('href="https://aiobox.app/?from=akimcp-panel" target="_blank" rel="noopener noreferrer"'), 'AIObox pitch and its link-button');
assert.ok(!/<img|<script|src=|\b(Mac|macOS|Windows|Linux)\b/.test(pitch), 'the pitch loads no remote asset and names no OS');
assert.ok(os.homedir().startsWith(fs.realpathSync(os.tmpdir())), 'HOME is the suite preload temp dir, never the real one');
const aioboxHome = path.join(os.homedir(), '.aki', 'aiobox');
fs.mkdirSync(aioboxHome, { recursive: true });
const installed = aioboxSection(renderPanel({ origin: null, client: {}, passphrase: after, token: 't', accessToken: 'SECRETTOK', repoRoot: '/', rulesDir: '/', userDir: '/' }));
assert.ok(installed.includes('AIObox is installed on this computer') && !installed.includes('aiobox.app') && !installed.includes('<a '), 'the installed variant is one line with no link');
fs.rmSync(aioboxHome, { recursive: true, force: true });

fs.rmSync(process.env.AKI_MCP_DATA_DIR, { recursive: true, force: true });
console.log('passphrase-roll.test.js: ok');
