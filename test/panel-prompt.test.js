#!/usr/bin/env node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const panelClient = readFileSync(path.join(root, 'public', 'panel-client.js'), 'utf8');
const configPage = readFileSync(path.join(root, 'scripts', 'config-page.js'), 'utf8');

assert.match(configPage, /METHOD-audit-flow\.md/);
assert.match(configPage, /METHOD-deep-think\.md/);

const start = panelClient.indexOf('function selectedRuleFiles()');
const end = panelClient.indexOf('// Nothing about a folder row');
assert.ok(start >= 0 && end > start, 'prompt builder functions must remain extractable');

const checked = [
  { value: 'index.md', checked: true },
  { value: 'RULE-agent-behavior.md', checked: true },
  { value: 'RULE-coding.md', checked: true },
  { value: 'RULE-pattern-core.md', checked: true },
  { value: 'METHOD-audit-flow.md', checked: true },
  { value: 'METHOD-deep-think.md', checked: true },
];
const elements = {
  loadRules: { checked: true },
  prompt: { value: '' },
  promptCount: { textContent: '', className: '' },
};
const document = {
  querySelectorAll(selector) {
    assert.equal(selector, '#ruleChecks input[type="checkbox"]:checked');
    return checked.filter((item) => item.checked);
  },
  getElementById(id) {
    return elements[id];
  },
};

const context = { document, MCP_VERSION: '2.1.0' };
vm.createContext(context);
vm.runInContext(panelClient.slice(start, end) + '\nthis.runBuildPrompt = buildPrompt;', context);

context.runBuildPrompt();
const initial = elements.prompt.value;
assert.match(initial, /METHOD-audit-flow\.md/);
assert.match(initial, /METHOD-deep-think\.md/);
assert.match(initial, /\/akirule, \/akithink, \/akiflow are unnecessary/);
assert.ok(initial.length < 1500, 'default prompt must fit ChatGPT 1500-char custom-instructions cap');

checked.find((item) => item.value === 'METHOD-deep-think.md').checked = false;
context.runBuildPrompt();
assert.doesNotMatch(elements.prompt.value, /METHOD-deep-think\.md/);
assert.match(elements.prompt.value, /METHOD-audit-flow\.md/);

elements.loadRules.checked = false;
context.runBuildPrompt();
assert.doesNotMatch(elements.prompt.value, /Selected defaults:/);

console.log('panel-prompt.test.js: ok');
