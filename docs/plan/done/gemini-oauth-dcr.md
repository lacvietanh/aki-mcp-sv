# Plan — Gemini Web Connector Dynamic Client Registration (DCR)

Status: done 2026-10-20 (live check against the real client not run)

## 1. Outcome and boundary

Fix the Gemini Web (`gemini.google.com`) custom connected apps integration so users can connect AkiMCP via standard OAuth 2.0 Account Linking by entering only the MCP Server URL and Passphrase, resolving the `"Account linking is required to use this custom app. Try again."` error.

### Boundaries
- **Public repo safety:** No private domain names, production tokens, passphrases, or local file paths may appear in this plan or repo commits. All URLs and credentials must use template variables (`${url}`, `${accessToken}`, `${passphrase}`) and generic placeholders.
- **Protocol conformance:** Align Gemini with the existing DCR flow already used by Claude and ChatGPT (RFC 7591 dynamic client registration + PKCE S256 + passphrase authorization at `/authorize`).

---

## 2. Root cause analysis (verified from live traffic)

When a user pastes the MCP Server URL into Gemini's "Connect to an MCP server" popup and clicks **Next**, Gemini executes the following discovery and registration handshake:

1. **Probe `/mcp`:** Gemini calls `/mcp` with no bearer token. AkiMCP correctly responds with `401 Unauthorized` and `WWW-Authenticate: Bearer realm="aki-mcp-sv", ...`.
2. **Metadata discovery:** Gemini requests `/.well-known/oauth-authorization-server` and discovers `registration_endpoint` (`${origin}/register`) and `authorization_endpoint` (`${origin}/authorize`).
3. **Dynamic Client Registration (`POST /register`):** Gemini automatically submits an RFC 7591 registration request with an array of Google OAuth redirect URIs:
   ```json
   {
     "redirect_uris": [
       "https://oauth-redirect.googleusercontent.com",
       "https://oauth-redirect-sandbox.googleusercontent.com",
       "https://oauth-redirect-test.googleusercontent.com"
     ]
   }
   ```
4. **Current failure in `scripts/oauth.js`:**
   - AkiMCP currently checks redirects using a rigid string-prefix rule:
     ```javascript
     const GEMINI_CALLBACK_PREFIX = 'https://oauth-redirect.googleusercontent.com/r/';
     ```
   - Because Gemini's DCR payload omits the `/r/` subpath and includes sandbox and test domains, `isAllowedRedirect` returns `false`.
   - The server rejects the registration with `400 {"error": "invalid_redirect_uri"}` and logs:
     ```text
     [oauth] register REJECTED (redirect_uri not allowlisted)
     ```
5. **Client symptom:**
   Gemini fails the OAuth discovery handshake and aborts with the red error message:
   `Account linking is required to use this custom app. Try again.`

---

## 3. Implementation specification

### 3.1. Allowlist Google OAuth Redirect Hostnames (`scripts/oauth.js`)

Replace the prefix check with a secure parsed-hostname validator matching the established pattern of `isNotionCallback`:

```javascript
const GEMINI_CALLBACK_HOSTS = new Set([
  'oauth-redirect.googleusercontent.com',
  'oauth-redirect-sandbox.googleusercontent.com',
  'oauth-redirect-test.googleusercontent.com',
]);

function isGeminiCallback(uri) {
  try {
    const url = new URL(uri);
    return url.protocol === 'https:'
      && !uri.includes('#')
      && !url.username
      && !url.password
      && GEMINI_CALLBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}
```

Update `isAllowedRedirect(uri)`:
```javascript
function isAllowedRedirect(uri) {
  if (typeof uri !== 'string' || !uri) return false;
  if (uri === CLAUDE_CALLBACK || uri === CHATGPT_LEGACY_CALLBACK) return true;
  return uri.startsWith(CHATGPT_CALLBACK_PREFIX)
    || uri.startsWith(GROK_CALLBACK_PREFIX)
    || isGeminiCallback(uri)
    || isNotionCallback(uri);
}
```

### 3.2. Update Web Panel Instructions (`scripts/config-page.js`)

In Section 1 (`#s1`), update `<div class="tabpane" id="tab-gemini">` to guide the user through the streamlined DCR flow:

1. Open **Gemini** (Settings → Extensions / Connected apps → Add custom connected app).
2. Paste **MCP Server URL** = `${copyEl(url)}`.
3. Click **Next** (Gemini automatically performs Account Linking).
4. Enter the **Passphrase** (${secretField('Passphrase', passphrase)}) when the authorization page opens.
5. Click **Approve** to complete the connection.

*(Optional)* Retain a collapsed note explaining that Advanced / Additional Settings with static Client ID / Secret is only a legacy fallback and no longer required.

### 3.3. Update Security Documentation (`docs/feat/security.md`)

Update line 48–49 in `docs/feat/security.md` to document that Gemini web connects via standard DCR under `oauth-redirect*.googleusercontent.com` in addition to the pre-issued static client.

---

## 4. Test and verification plan

### 4.1. Automated Tests (`test/oauth.test.js`)
Add regression assertions verifying:
1. `POST /register` accepts Google OAuth redirect URIs (`oauth-redirect.googleusercontent.com`, `oauth-redirect-sandbox.googleusercontent.com`, `oauth-redirect-test.googleusercontent.com`) and returns `201 Created` with a valid `client_id`.
2. Spoofed or malformed domains (e.g. `https://oauth-redirect.googleusercontent.com.attacker.com` or `http://` variants) are rejected with `400 invalid_redirect_uri`.
3. Existing Claude, ChatGPT, Grok, and Notion redirect validation continues to pass without regression.

### 4.2. Verification Checklist
- Run `npm test` across the full test suite (must pass 100%).
- In Gemini Web, paste the public MCP URL into "Connect to an MCP server" and click **Next**.
- Verify that the authorization popup opens cleanly with no `"Account linking is required..."` error.
- Enter the passphrase, click Approve, and confirm Gemini successfully discovers tools.
