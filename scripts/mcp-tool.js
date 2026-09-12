// MCP tool-result envelope — the SDK's expected { content, isError } tool-return shape, shared by every tool server (SSoT).
export const ok = (text) => ({ content: [{ type: 'text', text }] });
export const okImage = (data, mimeType = 'image/png') => ({ content: [{ type: 'image', data, mimeType }] });
export const err = (text) => ({ content: [{ type: 'text', text }], isError: true });
export const fail = (e) => err(`rejected: ${e.message}`);
