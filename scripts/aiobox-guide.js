// The AIObox guide for AIs: AIObox owns its text (aiobox shared/guide/aiobox.md, copied to ~/.aki/aiobox/guide.md at each start); AkiMCP only reads it.
// Contract: docs/plan/IMPORTANT-akimcp-aiobox-contract.md (row ~/.aki/aiobox/guide.md). Plan: aiobox docs/plan/ai-guide.md (G3).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Resolved per call: a test (or a changed HOME) is honored.
export const aioboxDir = () => path.join(os.homedir(), '.aki', 'aiobox');
const guideFile = () => path.join(aioboxDir(), 'guide.md');
const GUIDE_HEAD = /^---\nversion: (\d+)\n---\n/;
export const GUIDE_URL = 'https://aiobox.app/guide/aiobox.md';

// Only while the file is missing or malformed (AIObox older than the guide, or not started since an update): the few rules that stop the worst mistakes, and where the full guide is.
// Step 2's eval send is temporary (P3·W6, 2026-10-04): it goes once op=send takes a busy live/queued chat (aiobox docs/plan/aio-loop-automation.md L0).
export const GUIDE_FALLBACK = [
  `AIObox guide (short fallback: ~/.aki/aiobox/guide.md is missing or malformed; start or update AIObox). Full guide: ${GUIDE_URL}`,
  "1. Find yourself: aki__aiobox op=whoami quote=<20+ chars verbatim from the user's latest message>; name every window by its chatId.",
  '2. op=state lists windows (busy, read) and macros. Message another chat: aki__aiobox_write op=send window=<chatId> from=<your chatId>; busy with read=blocked: add wait=<s>. Busy with read=live/queued: op=send refuses, so op=eval there, only if its box is empty: akipanel.live.compose(text), Enter in the textbox, confirm live.chat() user turns grew by one. Never touch a draft or target your own chat.',
  '3. eval is a last resort; it sends only as in step 2. Never chrome_launch or devtools_* on an AIObox profile.',
].join('\n');

// One line for a machine without AIObox (D7, owner 2026-10-04): what it would add, and where to read more. Shown in akidevrule_context and the provider's not-installed reason.
export const AIOBOX_PITCH = `AIObox (not installed here) is a Mac app that keeps many AI chats and accounts open side by side and lets them read and message each other through AkiMCP: ${GUIDE_URL}`;

export const aioboxInstalled = () => fs.existsSync(aioboxDir());

// { guide, guideVersion }: the file verbatim (frontmatter included) when it opens with the contract's head, else the fallback with guideVersion null.
export function readGuide() {
  try {
    const text = fs.readFileSync(guideFile(), 'utf8');
    const head = GUIDE_HEAD.exec(text);
    if (head) return { guide: text, guideVersion: Number(head[1]) };
  } catch {
    // missing or unreadable: fall through
  }
  return { guide: GUIDE_FALLBACK, guideVersion: null };
}
