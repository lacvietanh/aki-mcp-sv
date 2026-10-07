#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { register } from '../scripts/sqlite-mcp.js';

function createDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT);
    INSERT INTO users (name, email) VALUES ('Aki', 'aki@example.com'), ('Dev', 'dev@example.com');
    CREATE INDEX idx_users_name ON users(name);
  `);
  db.close();
}

async function testSqliteMcp() {
  const insideDir = mkdtempSync(path.join(os.homedir(), 'aki-sqlite-test-'));
  const outsideDir = mkdtempSync(path.join(os.tmpdir(), 'aki-sqlite-outside-'));
  const dbPath = path.join(insideDir, 'test.db');
  const outsidePath = path.join(outsideDir, 'outside.db');

  try {
    createDb(dbPath);
    createDb(outsidePath);

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    register(server);
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientSide);
    const call = async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      return { isError: !!result.isError, text: result.content[0].text };
    };

    const schema = await call('sqlite_schema', { dbPath });
    assert.equal(schema.isError, false);
    assert.deepEqual(JSON.parse(schema.text).map((o) => [o.type, o.name, o.tbl_name]), [
      ['index', 'idx_users_name', 'users'],
      ['table', 'users', 'users'],
    ]);

    const select = await call('sqlite_query', { dbPath, query: 'SELECT id, name, email FROM users ORDER BY id' });
    assert.equal(select.isError, false);
    const result = JSON.parse(select.text);
    assert.deepEqual([result.totalRows, result.returnedRows, result.truncated], [2, 2, false]);
    assert.deepEqual(result.rows.map((r) => r.name), ['Aki', 'Dev']);

    const withParam = await call('sqlite_query', { dbPath, query: 'SELECT name FROM users WHERE email = ?', params: ['dev@example.com'] });
    assert.deepEqual(JSON.parse(withParam.text).rows, [{ name: 'Dev' }]);

    for (const query of ['DELETE FROM users', 'DROP TABLE users', 'INSERT INTO users (name) VALUES (\'x\')', 'CREATE TABLE t (a)']) {
      const refused = await call('sqlite_query', { dbPath, query });
      assert.ok(refused.isError && /strictly read-only/.test(refused.text), query);
    }
    const afterRefusals = await call('sqlite_query', { dbPath, query: 'SELECT count(*) AS n FROM users' });
    assert.deepEqual(JSON.parse(afterRefusals.text).rows, [{ n: 2 }], 'the refused statements changed nothing');

    for (const [tool, args] of [['sqlite_schema', { dbPath: outsidePath }], ['sqlite_query', { dbPath: outsidePath, query: 'SELECT 1' }]]) {
      const refused = await call(tool, args);
      assert.ok(refused.isError && /outside the allowed roots/.test(refused.text), `${tool} refuses a database outside the roots`);
    }

    await client.close();
    console.log('sqlite-mcp.test.js: ok');
  } finally {
    rmSync(insideDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
}

await testSqliteMcp();
