# Alibaba Review in Aki Postman panel

## Goal
Add an **Alibaba Review** action to the existing Aki MCP Postman tab. The action must use Alibaba Open Code Review delegation mode, where OCR only performs deterministic file selection/rule resolution and the host agent remains responsible for actual review.

## Evidence
- UI is rendered by scripts/config-page.js; Postman tab already exists there.
- Browser actions are wired by public/panel-client.js.
- Loopback routes live in scripts/panel.js.
- Alibaba delegation commands are `ocr delegate preview` and `ocr delegate rule`; delegation mode does not require an OCR LLM endpoint.

## Scope
- Add a button to the Postman tab.
- Add a loopback API endpoint that runs the deterministic OCR preview for the current repo and returns structured/text output suitable for the host agent.
- Do not alter Postman collection data.
- Do not commit/push/deploy.

## Acceptance
1. Existing Postman controls remain unchanged.
2. Alibaba Review button is visible in Postman tab.
3. Button reports missing OCR CLI clearly if unavailable.
4. When OCR is installed, endpoint invokes `ocr delegate preview` against the repo without requesting an OCR LLM.
5. Existing tests continue to pass.
