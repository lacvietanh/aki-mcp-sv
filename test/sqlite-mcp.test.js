#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { register } from '../scripts/sqlite-mcp.js';

async function testSqliteMcp() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'aki-sqlite-test-'));
  const dbPath = path.join(tempDir, 'test.db');

  try {
    // Setup temporary sqlite db
    const initDb = new DatabaseSync(dbPath);
    initDb.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT);
      INSERT INTO users (name, email) VALUES ('Aki', 'aki@example.com'), ('Dev', 'dev@example.com');
      CREATE INDEX idx_users_name ON users(name);
    `);
    initDb.close();

    // Test tool registration
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    register(server);

    // Test schema inspection
    const readDb = new DatabaseSync(dbPath, { readOnly: true });
    const schema = readDb.prepare(`
      SELECT type, name, tbl_name, sql 
      FROM sqlite_master 
      WHERE type IN ('table', 'view', 'index') AND name NOT LIKE 'sqlite_%' 
      ORDER BY type, name
    `).all();
    assert.equal(schema.length, 2);
    assert.equal(schema[0].name, 'idx_users_name');
    assert.equal(schema[1].name, 'users');

    // Test read query
    const rows = readDb.prepare('SELECT id, name, email FROM users ORDER BY id').all();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].name, 'Aki');
    assert.equal(rows[1].name, 'Dev');

    readDb.close();

    console.log('sqlite-mcp.test.js: ok');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

await testSqliteMcp();
