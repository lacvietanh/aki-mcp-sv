# Chrome remote debugging blocked on the default profile

Status: amended 2026-10-04 · the finding still holds (Chrome 136+ ignores the debugging switches on the default user-data dir), and `scripts/chrome.js` was removed as decided here; Chrome control came back in 3.0.0 on non-default directories only: `aki__chrome_launch` opens or attaches to AIObox's cloned profiles (`docs/plan/IMPORTANT-shared-cdp-profiles.md`), never the default profile.

**Start time:** 2026-08-08

**Initial purpose:** During the Windows/Linux unification plan for this repo, the claim "Chrome stopped allowing CDP after version 131" needed verification before deciding whether `scripts/chrome.js` (the panel's "Connect Chrome" / tab-eval feature, driven via `--remote-debugging-port` against the user's real, default Chrome profile) could simply be ported to Windows, or had to be removed outright. Context at the time: `chrome.js` launches Chrome with `open -a "Google Chrome" --args --remote-debugging-port=9222 --restore-last-session` — no `--user-data-dir` — specifically so it attaches to the user's already-logged-in profile rather than a throwaway one.

## Strategy
Cross-reference the official Chrome source against independent third-party confirmations and real bug reports, rather than trusting a single page, since the initial version number ("131") was a guess that needed either confirming or correcting before it went into a plan doc.

## Checklist
- [x] `web_search`: "Chrome 131 remote debugging port CDP command line disabled localhost" — returned general CDP documentation, no version-specific hit for 131
- [x] `web_search`: "Chrome remote debugging port default profile blocked version custom user-data-dir required" — surfaced the actual version and mechanism
- [x] Cross-checked the finding against `scripts/chrome.js`'s actual launch arguments in this repo (no `--user-data-dir` present) to confirm the feature is in the affected case, not a false alarm

## Result
The version was **136**, not 131, and the change is narrower than "CDP no longer allowed": starting Chrome 136, the `--remote-debugging-port` and `--remote-debugging-pipe` flags are ignored specifically when they would attach to Chrome's **default** user-data directory. A non-default directory, passed via `--user-data-dir`, is now required for either flag to take effect. CDP itself still works — Chrome only refuses to expose it on the profile holding the user's real logins, cookies, and encryption keys.

Since `scripts/chrome.js` never passes `--user-data-dir`, it launches exactly the case Chrome now blocks. `connectChrome()`/`restartChrome()` fail on any current Chrome (136+), regardless of host OS — this was never a Windows-porting problem.

### Verification
Corroborated across one primary source and four independent secondary sources, not just one:
- **Primary** — Chrome for Developers blog, "Changes to remote debugging switches to improve security" (developer.chrome.com/blog/remote-debugging-port): states the switches are no longer respected against the default data directory and now require `--user-data-dir` pointing at a non-standard location.
- **raf.dev** blog post walking through the exact same failure while setting up Chrome DevTools MCP, confirming Chrome 136 blocks debugging the default profile and that `--user-data-dir` is the required fix.
- **Grokipedia**, "DevTools Remote Debugging Requires a Non-Default Data Directory" — describes the same enforcement starting Chrome 136, framed as a hardening measure against cookie/credential exfiltration via remote debugging.
- **GitHub issue** `browser-use/browser-use#1520` — a real automation project hitting the same block starting from Chrome ≥136 while using the default `--user-data-dir`.
- **GitHub issue** `SeleniumHQ/selenium#16274` — a separate real-world report of the identical "DevTools remote debugging requires a non-default data directory" error.

No source contradicted this; all five independently name the same version (136) and the same mechanism (default-profile block, non-default `--user-data-dir` required).

### What would preserve the feature, and why it wasn't chosen
Passing `--user-data-dir` pointing at a throwaway profile would restore a working CDP session, but it would be driving a browser the user isn't logged into — defeating the one reason `chrome.js` exists (control the tab the user already has open, signed in). No variant of the fix preserves the original purpose, so the finding closes toward removal rather than a workaround.

## Decision
**Action** → `docs/plan/done/unify-windows-linux.md`, item 5 (delete `scripts/chrome.js`) and item 6/7 (remove the panel routes and UI section that call it). Cross-references: item 12 of that plan also removes the "Chrome control" section from `README.md`.
