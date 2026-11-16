// SQLite / Local database inspector tools (sqlite_schema / sqlite_query).
// Uses Node 22 built-in node:sqlite in strict read-only mode with root containment.
// Served names are prefixed aki__ by tools-server.js.
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { ok, err, fail } from './mcp-tool.js';
import { resolveUnderRoot } from './roots.js';

const READ_ONLY_FIRST_WORD = /^(?:SELECT|WITH|EXPLAIN|PRAGMA|VALUES)\b/i;
const SQL_BLANKS = ' \t\n\r\f';

// An allowlist, because VACUUM INTO and ATTACH pass a read-only connection; one linear scan, never a regex over the query (nested quantifiers backtrack exponentially).
function firstStatementWord(sql) {
  let i = 0;
  while (i < sql.length) {
    if (SQL_BLANKS.includes(sql[i])) {
      i += 1;
    } else if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i);
      if (end === -1) return '';
      i = end + 1;
    } else if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) return '';
      i = end + 2;
    } else {
      break;
    }
  }
  return sql.slice(i, i + 8);
}

export const provider = { id: 'sqlite', title: 'SQLite (read-only)', register };

export function register(server) {
  server.registerTool(
    'sqlite_schema',
    {
      title: 'Inspect SQLite database schema',
      annotations: { readOnlyHint: true, openWorldHint: false },
      description:
        'Read schema of a local SQLite database (.sqlite, .db, .sqlite3). Returns all tables, views, columns, and indexes.',
      inputSchema: {
        dbPath: z.string().describe('Absolute or relative path to SQLite database file within allowed roots'),
      },
    },
    async ({ dbPath }) => {
      let db = null;
      try {
        const abs = resolveUnderRoot(dbPath);
        if (!existsSync(abs)) return err(`SQLite file not found: ${dbPath}`);

        db = new DatabaseSync(abs, { readOnly: true });
        const stmt = db.prepare(`
          SELECT type, name, tbl_name, sql 
          FROM sqlite_master 
          WHERE type IN ('table', 'view', 'index') AND name NOT LIKE 'sqlite_%' 
          ORDER BY type, name
        `);
        const schema = stmt.all();
        return ok(JSON.stringify(schema, null, 2));
      } catch (e) {
        return fail(e);
      } finally {
        db?.close();
      }
    },
  );

  server.registerTool(
    'sqlite_query',
    {
      title: 'Execute read-only SQL query on SQLite database',
      annotations: { readOnlyHint: true, openWorldHint: false },
      description:
        'Execute a read-only SQL query (SELECT, PRAGMA, EXPLAIN, WITH) on a local SQLite database. Writes and DDL are strictly rejected. Output capped at 100 rows.',
      inputSchema: {
        dbPath: z.string().describe('Path to SQLite database file within allowed roots'),
        query: z.string().describe('Read-only SQL query to execute'),
        params: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional().describe('Positional SQL query parameters'),
      },
    },
    async ({ dbPath, query, params }) => {
      let db = null;
      try {
        const trimmed = (query || '').trim();
        if (!READ_ONLY_FIRST_WORD.test(firstStatementWord(trimmed))) {
          return err('Only SELECT, WITH, EXPLAIN, PRAGMA and VALUES statements are allowed. sqlite_query is strictly read-only.');
        }

        const abs = resolveUnderRoot(dbPath);
        if (!existsSync(abs)) return err(`SQLite file not found: ${dbPath}`);

        db = new DatabaseSync(abs, { readOnly: true });
        const stmt = db.prepare(trimmed);
        const allRows = stmt.all(...(params || []));
        const MAX_ROWS = 100;
        const truncated = allRows.length > MAX_ROWS;
        const rows = truncated ? allRows.slice(0, MAX_ROWS) : allRows;

        return ok(JSON.stringify({
          totalRows: allRows.length,
          returnedRows: rows.length,
          truncated,
          rows,
        }, null, 2));
      } catch (e) {
        return fail(e);
      } finally {
        db?.close();
      }
    },
  );
}
