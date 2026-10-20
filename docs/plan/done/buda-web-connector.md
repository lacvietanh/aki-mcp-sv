# Plan — Buda AI Web Connector

Status: done 2026-10-20 (live check against the real client not run)

## 1. Outcome and boundary

Add a first-class **Buda** connector tab to the AkiMCP Web Panel (Section 1: Connectors → Web · needs ingress), providing copy-paste configuration and step-by-step onboarding tailored to Buda AI's native MCP integration modal.

### Boundaries
- **UI & snippet guidance only:** Buda AI (`buda.im`) connects to external MCP servers using standard HTTP transport with Bearer token authentication. AkiMCP's server engine already natively supports this via `scripts/streamable-bridge.js` (Streamable HTTP JSON-RPC over `/mcp` with `Authorization: Bearer <token>`). No backend protocol changes or custom routes are required.
- **Zero credential leaks:** This plan and the repository codebase are public. No private hostnames, tokens, passphrases, or machine-local paths may be hardcoded. Snippets must always use runtime template variables (`${url}`, `${accessToken}`).

---

## 2. Buda AI connector discovery (verified from UI)

From Buda AI's live agent runtime interface (`Account Settings > Agent Settings > [Agent] > Integrations` → `Edit MCP server` / `Add MCP server`):

| UI Field in Buda | Required Setting | Source in AkiMCP |
|---|---|---|
| **Name** | `AkiMCP` (or user preference) | `MCP_NAME` (`AkiMCP`) |
| **Connection type** | **Remote HTTP** ("Connect to a hosted HTTPS endpoint") | Radio/toggle option in Buda modal |
| **HTTPS endpoint** | `https://<public-origin>/mcp` | Server public MCP URL (`${url}`) |
| **Authentication headers** | Key: `Authorization` · Value: `Bearer <access_token>` | Shared access token (`${accessToken}`) via `+ Add header` |

---

## 3. Implementation details

### 3.1. Web Panel UI (`scripts/config-page.js`)

1. **Tab Navigation:**
   In Section 1 (`#s1`), within the `<nav class="tabs" role="tablist">` under the `Web · needs ingress` group, add a new tab button alongside Claude, Grok, ChatGPT, Gemini, and Notion:
   ```html
   <button class="tab" data-tab="buda"><img src="/img/providers/buda.png" class="provider-icon" alt="" onerror="this.style.display='none'">Buda</button>
   ```

2. **Tabpane Content (`#tab-buda`):**
   Render a dedicated pane reflecting Buda's exact modal fields and actions:
   ```html
   <div class="tabpane" id="tab-buda">
     <p class="helptext">Connect Buda AI agents to AkiMCP via Buda's native Remote HTTP integration.</p>
     <ol class="steps">
       <li>In Buda, open <strong>Agent Settings</strong> → select your Agent → <strong>Integrations</strong> (or Workspace <strong>Company Layout</strong> → <strong>MCP</strong>).</li>
       <li>Click <strong>Add MCP server</strong> (or edit an existing entry).</li>
       <li>Set <strong>Name</strong> = <strong>${esc(MCP_NAME)}</strong>.</li>
       <li>Choose <strong>Connection type</strong> = <strong>Remote HTTP</strong>.</li>
       <li>Set <strong>HTTPS endpoint</strong> = ${copyEl(url)}.</li>
       <li>Under <strong>Authentication headers</strong>, click <strong>+ Add header</strong>:
         <div class="substep">Header name: ${copyEl('Authorization')}</div>
         <div class="substep">Header value: ${copyEl(`Bearer ${accessToken}`)}</div>
       </li>
       <li>Click <strong>Save</strong>, verify the runtime connection status, and start a new chat session to load the tools.</li>
     </ol>
     <p class="helptext">Buda communicates over standard JSON-RPC HTTP requests authenticated by your shared access token. No OAuth passphrase or client registration is required.</p>
   </div>
   ```

### 3.2. Provider Icon Asset (`public/img/providers/buda.png`)
- Add `buda.png` into `public/img/providers/` to match the visual style of existing provider icons (`claude.png`, `gpt.png`, `gemini.png`, `notion.png`).
- Add an `onerror="this.style.display='none'"` fallback on the `<img>` tag so the panel renders gracefully if the icon image is absent.

---

## 4. Verification and test plan

1. **Unit & Contract Tests:**
   - In `test/`, add an assertion checking that `renderPanel()` produces `#tab-buda` and includes the correct endpoint and Bearer authorization snippets when rendered with an active origin.
2. **Regression Check:**
   - Run `npm test` across the full suite (51 existing tests) to ensure zero regression.
3. **Manual Panel Inspection:**
   - Open loopback panel URL (`http://127.0.0.1:9998/?t=<token>`).
   - Switch to the Buda tab, verify layout, step clarity, and copy button functionality.
