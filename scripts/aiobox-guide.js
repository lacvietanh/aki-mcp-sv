// Where AIObox lives on disk, the CDP ports its window map names, and the one line shown on a machine without it. The guide itself is AIObox's file (~/.aki/aiobox/guide.md), read verbatim by aiobox-mcp.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Resolved per call: a test (or a changed HOME) is honored.
export const aioboxDir = () => path.join(os.homedir(), '.aki', 'aiobox');
export const GUIDE_URL = 'https://aiobox.app/guide/aiobox.md';

// D7, owner 2026-10-04: shown in akidevrule_context, the provider's not-installed reason and refusal, nowhere else.
// No OS name (AIObox targets Windows, macOS and Linux); from=akimcp counts this line's readers, so every other mention of the guide keeps the bare GUIDE_URL.
export const AIOBOX_PITCH = `AIObox (not installed here) is a desktop app that keeps many AI chats and accounts open side by side and lets them read and message each other through AkiMCP: ${GUIDE_URL}?from=akimcp`;

export const aioboxInstalled = () => fs.existsSync(aioboxDir());
export const windowsFile = () => path.join(aioboxDir(), 'cdp', 'windows.json');

// For the call-log report's bypass count (scripts/tool-calls-report.js), kept here so that CLI loads no MCP code; none when AIObox is off or its map is unreadable.
export function aioboxPorts() {
  try {
    return new Set((JSON.parse(fs.readFileSync(windowsFile(), 'utf8')).profiles || []).map((p) => p.port));
  } catch {
    return new Set();
  }
}
