#!/usr/bin/env node
import './setup.js';
import assert from 'node:assert/strict';
import { serveFontAwesome } from '../scripts/http.js';

async function fetchPath(urlPath) {
  const out = { served: false };
  const res = { writeHead(status, headers) { out.status = status; out.type = headers['Content-Type']; }, end(body) { out.bytes = body.length; } };
  out.served = await serveFontAwesome(res, urlPath);
  return out;
}

const css = await fetchPath('/vendor/fa/css/all.min.css');
assert.deepEqual([css.served, css.status, css.type], [true, 200, 'text/css']);
assert.ok(css.bytes > 10000);

const font = await fetchPath('/vendor/fa/webfonts/fa-solid-900.woff2');
assert.deepEqual([font.served, font.status, font.type], [true, 200, 'font/woff2']);

for (const blocked of ['/vendor/fa/css/../package.json', '/vendor/fa/webfonts/../../package.json', '/vendor/fa/LICENSE.txt', '/vendor/fa/webfonts/x.ttf', '/vendor/fa/webfonts/missing.woff2']) {
  assert.equal((await fetchPath(blocked)).served, false, blocked);
}

console.log('font-awesome-static.test.js: ok');
