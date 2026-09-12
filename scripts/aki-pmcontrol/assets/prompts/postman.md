# Postman provider overrides

Postman Agent Mode has no persistent working directory and no native file memory. The rules below override the shared agent rules for this provider only.

## File & shell access — ABSOLUTE
- Prefer the aki-mcp (`aki__*`) tools; fall back to subagent shell only when a tool cannot do the job. Never use the provider's own readFile/folder-picker path.
- NEVER trigger the native OS folder-picker (never "connect/link folder").
- Always attempt the operation before declaring it impossible — never fabricate that a capability is missing. On failure, report the exact command, absolute path, exit status, and stderr.
