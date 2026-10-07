#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';

// userdata.js reads AKI_MCP_DATA_DIR at import, so the env is set before oauth.js loads; the real ~/.aki/mcpsv is never touched.
const dir = mkdtempSync(path.join(os.tmpdir(), 'aki-oauth-test-'));
process.env.AKI_MCP_DATA_DIR = dir;
const { TOKENS_PATH } = await import('../scripts/userdata.js');
const { getOrIssueAccessToken, verifyBearer } = await import('../scripts/oauth.js');
const { startPanel } = await import('../scripts/panel.js');

const removeDataDir = () => rmSync(dir, { recursive: true, force: true });

async function run() {
  try {
    const first = getOrIssueAccessToken();
    const second = getOrIssueAccessToken();
    assert.match(first, /^[0-9a-f]{64}$/);
    assert.equal(second, first, 'a still-valid access token must be reused, not minted again');
    assert.equal(verifyBearer('Bearer ' + first), true);
    assert.equal(verifyBearer('Bearer ' + '0'.repeat(64)), false, 'unknown hex must not pass verifyBearer');
    const saved = JSON.parse(readFileSync(TOKENS_PATH, 'utf8'));
    assert.ok(saved.access[first]);
    assert.ok(saved.access[first].expires > Date.now());

    const panelToken = 'panel-loopback-token-not-an-mcp-bearer';
    const panel = startPanel({
      port: 0,
      token: panelToken,
      origin: 'https://example.test',
      ingress: 'funnel',
      client: { clientId: 'test', clientSecret: 'test' },
      passphrase: 'test-pass',
      updateInfo: { mcp: {}, rule: {} },
    });
    if (!panel.listening) await once(panel, 'listening');
    const base = `http://127.0.0.1:${panel.address().port}`;
    try {
      const page = await fetch(base + '/?t=' + panelToken);
      assert.equal(page.status, 200);
      const html = await page.text();
      assert.match(html, /Enable Developer mode/);
      assert.match(html, /#settings\/Security/);
      assert.match(html, /id="postmanJson"/);
      assert.match(html, new RegExp(`Bearer ${first}`));
      assert.doesNotMatch(html, new RegExp(`Bearer ${panelToken}`));
      assert.doesNotMatch(html, /data-act="generatePostman"/);
      assert.doesNotMatch(html, /Generate first/);
      assert.match(html, /<span class="txt">[^<]*public\/favicon\/icon-48\.png<\/span>/);
      assert.doesNotMatch(html, /tokens\.json/);
      assert.doesNotMatch(html, /Registration URL/);
      assert.doesNotMatch(html, /Advanced OAuth/);
      assert.equal(verifyBearer('Bearer ' + first), true);
      assert.equal(verifyBearer('Bearer ' + panelToken), false, 'panel loopback token must not pass verifyBearer');

      const withoutToken = await fetch(base + '/api/access-token');
      assert.equal(withoutToken.status, 403, 'GET /api/access-token needs the panel token');
      const wrongToken = await fetch(base + '/api/access-token', { headers: { 'x-panel-token': first } });
      assert.equal(wrongToken.status, 403, 'the access token itself is not the panel token');
      const served = await fetch(base + '/api/access-token', { headers: { 'x-panel-token': panelToken } });
      assert.equal(served.status, 200);
      assert.deepEqual(await served.json(), { accessToken: first });
      assert.equal(served.headers.get('access-control-allow-origin'), null, 'no CORS');

      const gone = await fetch(base + '/api/access-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-panel-token': panelToken },
        body: '{}',
      });
      assert.equal(gone.status, 404);
    } finally {
      panel.close();
      await once(panel, 'close');
    }

    console.log('PASS: getOrIssueAccessToken reuses a valid token, persists it, and GET / prefills Postman JSON with that verifyBearer-accepted token');
  } finally {
    removeDataDir();
  }
}

await run();
