const assert = require('node:assert/strict');

(async () => {
const { browserIdentity, PostmanSession } = require('../scripts/aki-pmcontrol/scripts/postman-session');
const { attachmentTargets, deterministicOwnerTargetId, createdTarget, waitForCreatedTarget, openOwnedWindow } = require('../scripts/aki-pmcontrol/scripts/postman-ownership');

const eligible = (url) => url.startsWith('https://desktop.postman.com');
const pages = [
  { id: 'b', type: 'page', url: 'https://desktop.postman.com/b' },
  { id: 'a', type: 'page', url: 'https://desktop.postman.com/a' },
  { id: 'x', type: 'page', url: 'https://example.com' },
];
assert.deepEqual(attachmentTargets(pages, eligible).map((target) => target.id), ['a', 'b']);
assert.equal(deterministicOwnerTargetId(pages, eligible), 'a');
assert.deepEqual(attachmentTargets([...pages, { id: 'c', type: 'page', url: 'https://desktop.postman.com/c' }], eligible).map((target) => target.id), ['a', 'b', 'c']);
assert.equal(deterministicOwnerTargetId([...pages, { id: 'c', type: 'page', url: 'https://desktop.postman.com/c' }], eligible), 'a');
assert.deepEqual(attachmentTargets([...pages, { id: 'invalid', type: 'page', url: 'https://example.com/new' }], eligible).map((target) => target.id), ['a', 'b']);
assert.equal(createdTarget(new Set(['a']), pages, eligible).id, 'b');
assert.equal(createdTarget(new Set(['a', 'b']), [...pages, { id: 'c', type: 'page', url: 'https://desktop.postman.com/c' }], eligible).id, 'c');
assert.deepEqual(browserIdentity({ webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/browser-1' }, 9222), { kind: 'browser-websocket', browserId: 'browser-1' });
assert.deepEqual(browserIdentity(null, 9222), { kind: 'endpoint-fallback', endpoint: 'http://127.0.0.1:9222' });

let attempts = 0;
const endpoint = await PostmanSession.waitUntilReady(9333, {
  cdp: {
    List: async () => { attempts += 1; if (attempts < 3) throw new Error('not ready'); return pages; },
    Version: async () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1:9333/devtools/browser/pinned' }),
  },
  sleep: async () => {},
});
assert.equal(attempts, 3);
assert.equal(endpoint.port, 9333);
assert.equal(endpoint.browserIdentity.browserId, 'pinned');

let dynamicAttempts = 0;
let currentPort = 60001;
const dynamicEndpoint = await PostmanSession.waitUntilReady(() => currentPort, {
  cdp: {
    List: async ({ port }) => {
      dynamicAttempts += 1;
      if (port === 60001) {
        currentPort = 60002;
        throw new Error('connect ECONNREFUSED 127.0.0.1:60001');
      }
      return pages;
    },
    Version: async () => ({ webSocketDebuggerUrl: `ws://127.0.0.1:${currentPort}/devtools/browser/dynamic` }),
  },
  sleep: async () => {},
});
assert.equal(dynamicAttempts, 2);
assert.equal(dynamicEndpoint.port, 60002);
assert.equal(dynamicEndpoint.browserIdentity.browserId, 'dynamic');

let lists = 0;
const newTarget = await waitForCreatedTarget({
  beforeIds: new Set(['a', 'b']),
  listTargets: async () => { lists += 1; return lists === 1 ? pages : [...pages, { id: 'c', type: 'page', url: 'https://desktop.postman.com/c' }]; },
  isEligible: eligible,
  sleep: async () => {},
});
assert.equal(newTarget.id, 'c');
assert.equal(lists, 2);

let evaluateCount = 0;
let windowLists = 0;
const opened = await openOwnedWindow({
  ownerClient: { Runtime: { evaluate: async () => { evaluateCount += 1; } } },
  listTargets: async () => { windowLists += 1; return windowLists < 3 ? pages : [...pages, { id: 'c', type: 'page', url: 'https://desktop.postman.com/c' }]; },
  isEligible: eligible,
  sleep: async () => {},
});
assert.equal(evaluateCount, 1);
assert.equal(opened.id, 'c');
console.log('postman-ownership.test.cjs: ok');
})().catch((error) => { console.error(error); process.exitCode = 1; });
