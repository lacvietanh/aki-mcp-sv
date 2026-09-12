# Postman panel Auto controls

## Status

- [x] Inspect the existing uncommitted batch and permission-popup probe evidence.
- [x] Remove the shared flow gate that paused permission automation during agent-setting transitions.
- [x] Restore Auto-inject by removing the temporary hard-disable.
- [x] Preserve explicit Auto checkbox values across daemon reinjection while retaining on-by-default behavior for unset values.
- [x] Move the complete model selector under CHAT AGENT and sync radios from the confirmed live model id.
- [x] Add focused static regression assertions and run narrow checks.
- [ ] Runtime-only: launch Postman manually and verify Approve/Allow, Continue, Run, Try again, folder rejection, auto-inject, Thinking, Auto-run, and all four model switches against the current desktop DOM.

No app launch or external-state mutation was performed in this implementation pass.
