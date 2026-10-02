// Native filesystem MCP tools — replaces the third-party @modelcontextprotocol/server-filesystem
// child. Security logic (symlink-safe path validation, atomic write) ported from that package's
// lib.js/path-validation.js, layered on roots.js:resolveRealUnderRoot() instead of a spawn-time-frozen
// allowedDirectories array, so a folder edit in the panel takes effect on the next call like every
// other tool (docs/plan/done/2.0.0-improve.md #7).
//
// Tool surface is trimmed from the original 14 to 7: list_directory/list_directory_with_sizes/
// directory_tree/search_files are dropped — README/the AI instruction prompt already forbid them in
// favor of find_path/search_content (search-mcp.js), which return both files and directories,
// whole-tree, in one call. read_file (deprecated alias), read_multiple_files, and read_media_file are
// dropped as YAGNI; all three are cheap to add back if a real need shows up.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createTwoFilesPatch } from 'diff';
import { z } from 'zod';
import { getRoots, resolveRealUnderRoot, resolveRealWritable, resolveRealWritableDir } from './roots.js';
import { ok, fail } from './mcp-tool.js';

const normalizeLineEndings = (text) => text.replace(/\r\n/g, '\n');

function createUnifiedDiff(original, modified, filepath) {
  return createTwoFilesPatch(filepath, filepath, normalizeLineEndings(original), normalizeLineEndings(modified), 'original', 'modified');
}

// Memory-efficient tail: reads from the end in fixed-size chunks instead of loading the whole file.
async function tailFile(filePath, numLines) {
  const CHUNK_SIZE = 1024;
  const { size: fileSize } = await fs.stat(filePath);
  if (fileSize === 0) return '';
  const handle = await fs.open(filePath, 'r');
  try {
    const lines = [];
    let position = fileSize;
    const chunk = Buffer.alloc(CHUNK_SIZE);
    let remainingText = '';
    while (position > 0 && lines.length < numLines) {
      const size = Math.min(CHUNK_SIZE, position);
      position -= size;
      const { bytesRead } = await handle.read(chunk, 0, size, position);
      if (!bytesRead) break;
      const chunkText = chunk.subarray(0, bytesRead).toString('utf-8') + remainingText;
      const chunkLines = normalizeLineEndings(chunkText).split('\n');
      if (position > 0) remainingText = chunkLines.shift();
      for (let i = chunkLines.length - 1; i >= 0 && lines.length < numLines; i--) lines.unshift(chunkLines[i]);
    }
    return lines.join('\n');
  } finally {
    await handle.close();
  }
}

async function headFile(filePath, numLines) {
  const handle = await fs.open(filePath, 'r');
  try {
    const lines = [];
    let buffer = '';
    let offset = 0;
    const chunk = Buffer.alloc(1024);
    while (lines.length < numLines) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
      if (!bytesRead) break;
      offset += bytesRead;
      buffer += chunk.subarray(0, bytesRead).toString('utf-8');
      const newlineIdx = buffer.lastIndexOf('\n');
      if (newlineIdx !== -1) {
        const complete = buffer.slice(0, newlineIdx).split('\n');
        buffer = buffer.slice(newlineIdx + 1);
        for (const line of complete) {
          lines.push(line);
          if (lines.length >= numLines) break;
        }
      }
    }
    if (buffer.length && lines.length < numLines) lines.push(buffer);
    return lines.join('\n');
  } finally {
    await handle.close();
  }
}

// 'wx' fails if the target already exists (including as a symlink) — no silent follow-through a
// pre-existing symlink. On EEXIST, write to a random temp path and atomically rename over the
// target: rename replaces the destination without following it as a symlink, closing the TOCTOU gap
// between resolveRealUnderRoot()'s check and the actual write.
async function writeFileAtomic(filePath, content) {
  try {
    await fs.writeFile(filePath, content, { encoding: 'utf-8', flag: 'wx' });
    return;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  const tempPath = `${filePath}.${randomBytes(16).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tempPath, content, 'utf-8');
    await fs.rename(tempPath, filePath);
  } catch (e) {
    await fs.unlink(tempPath).catch(() => {});
    throw e;
  }
}

async function applyFileEdits(filePath, edits, dryRun) {
  const original = normalizeLineEndings(await fs.readFile(filePath, 'utf-8'));
  let content = original;
  for (const edit of edits) {
    const oldText = normalizeLineEndings(edit.oldText);
    const newText = normalizeLineEndings(edit.newText);
    if (content.includes(oldText)) {
      content = content.replace(oldText, () => newText);
      continue;
    }
    // Exact match failed — retry line-by-line with whitespace tolerance, preserving indentation.
    const oldLines = oldText.split('\n');
    const contentLines = content.split('\n');
    let matched = false;
    for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
      const window = contentLines.slice(i, i + oldLines.length);
      const isMatch = oldLines.every((oldLine, j) => oldLine.trim() === window[j].trim());
      if (!isMatch) continue;
      const baseIndent = contentLines[i].match(/^\s*/)[0];
      const newLines = newText.split('\n').map((line, j) => {
        if (j === 0) return baseIndent + line.trimStart();
        const oldIndent = (oldLines[j]?.match(/^\s*/) || [''])[0];
        const newIndent = (line.match(/^\s*/) || [''])[0];
        if (oldIndent && newIndent) {
          const relative = Math.max(0, newIndent.length - oldIndent.length);
          return baseIndent + ' '.repeat(relative) + line.trimStart();
        }
        return line;
      });
      contentLines.splice(i, oldLines.length, ...newLines);
      content = contentLines.join('\n');
      matched = true;
      break;
    }
    if (!matched) throw new Error(`could not find exact match for edit:\n${edit.oldText}`);
  }

  const diff = createUnifiedDiff(original, content, filePath);
  let fence = 3;
  while (diff.includes('`'.repeat(fence))) fence++;
  const formatted = `${'`'.repeat(fence)}diff\n${diff}${'`'.repeat(fence)}\n`;

  if (!dryRun) await writeFileAtomic(filePath, content);
  return formatted;
}

export const provider = { id: 'filesystem', title: 'Filesystem', required: true, register };

export function register(server) {

  server.registerTool(
    'read_text_file',
    {
      title: 'Read Text File',
      annotations: { readOnlyHint: true, openWorldHint: false },
      description: 'Read the complete contents of a text file. Use "tail"/"head" to read only the last/first N lines of a large file instead of the whole thing. Only works under the configured roots.',
      inputSchema: {
        path: z.string(),
        tail: z.number().optional().describe('If provided, returns only the last N lines'),
        head: z.number().optional().describe('If provided, returns only the first N lines'),
      },
    },
    async ({ path: p, tail, head }) => {
      try {
        if (tail && head) throw new Error('cannot specify both head and tail');
        const real = await resolveRealUnderRoot(p);
        const text = tail ? await tailFile(real, tail) : head ? await headFile(real, head) : await fs.readFile(real, 'utf-8');
        return ok(text);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'write_file',
    {
      title: 'Write File',
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      description: 'Create a new file or completely overwrite an existing one. Use with caution — overwrites without warning. Only works under the configured roots.',
      inputSchema: { path: z.string(), content: z.string() },
    },
    async ({ path: p, content }) => {
      try {
        const real = await resolveRealWritable(p);
        await writeFileAtomic(real, content);
        return ok(`wrote ${p}`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'edit_file',
    {
      title: 'Edit File',
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      description: 'Make targeted edits to a text file: each edit replaces an exact (or whitespace-tolerant) text match with new text. Returns a git-style diff of what changed. Set dryRun to preview without writing.',
      inputSchema: {
        path: z.string(),
        edits: z.array(z.object({ oldText: z.string().describe('Text to search for — must match'), newText: z.string() })),
        dryRun: z.boolean().optional().default(false),
      },
    },
    async ({ path: p, edits, dryRun }) => {
      try {
        const real = await resolveRealWritable(p);
        return ok(await applyFileEdits(real, edits, dryRun));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'create_directory',
    {
      title: 'Create Directory',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description: 'Create a directory (and any missing parents). Succeeds silently if it already exists.',
      inputSchema: { path: z.string() },
    },
    async ({ path: p }) => {
      try {
        // mkdir -p: the target and any number of missing parents are created. resolveRealWritableDir climbs to the nearest existing ancestor for the symlink-safe containment check, so a deep path whose immediate parent does not exist yet still resolves (resolveRealWritable would reject it).
        const real = await resolveRealWritableDir(p);
        await fs.mkdir(real, { recursive: true });
        return ok(`created ${p}`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'move_file',
    {
      title: 'Move File',
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      description: 'Move or rename a file/directory. Fails if the destination already exists. Both source and destination must be under the configured roots — this is the only sanctioned move/rename path (the shell tool\'s allowlist deliberately excludes mv).',
      inputSchema: { source: z.string(), destination: z.string() },
    },
    async ({ source, destination }) => {
      try {
        const realSource = await resolveRealWritable(source);
        const realDest = await resolveRealWritable(destination);
        await fs.rename(realSource, realDest);
        return ok(`moved ${source} to ${destination}`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'get_file_info',
    {
      title: 'Get File Info',
      annotations: { readOnlyHint: true, openWorldHint: false },
      description: 'Get size, timestamps, permissions, and type for a file or directory, without reading its content.',
      inputSchema: { path: z.string() },
    },
    async ({ path: p }) => {
      try {
        const real = await resolveRealUnderRoot(p);
        const stats = await fs.stat(real);
        const info = {
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
          accessed: stats.atime,
          isDirectory: stats.isDirectory(),
          isFile: stats.isFile(),
          permissions: stats.mode.toString(8).slice(-3),
        };
        return ok(Object.entries(info).map(([k, v]) => `${k}: ${v}`).join('\n'));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'list_allowed_directories',
    {
      title: 'List Allowed Directories',
      annotations: { readOnlyHint: true, openWorldHint: false },
      description: 'List the directories this server can currently read/write. Subdirectories within them are also accessible.',
      inputSchema: {},
    },
    async () => ok(`Allowed directories:\n${getRoots().join('\n')}`),
  );
}
