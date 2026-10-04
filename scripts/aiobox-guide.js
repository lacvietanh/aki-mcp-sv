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
// Step 2: op=send itself takes a busy live/queued chat (owner, 2026-10-04: those providers have no busy), so no eval send is left.
export const GUIDE_FALLBACK = [
  `AIObox guide (short fallback: ~/.aki/aiobox/guide.md is missing; start or update AIObox). Full guide: ${GUIDE_URL}`,
  "1. Find yourself: aki__aiobox op=whoami quote=<20+ chars verbatim from the user's latest message>; name windows by handle P#·W# (lasting).",
  '2. op=state lists windows, macros and flags: skip what it flags. Message a chat: aki__aiobox_write op=send window=<handle> from=<your chatId>; read=live/queued has no busy: op=send sends at once, even mid-answer; delivered:true = it shows there; a draft or read=blocked and busy: add wait=<s>. Never touch a draft or target your own chat.',
  '3. eval is a last resort and never sends. Never chrome_launch or devtools_* on an AIObox profile; close a window only with op=close_window (successor=<your handle> after a handoff).',
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
