# Ingress drop-rate benchmark

Puts a number on the deferred reliability question in [`docs/plan/done/cloudflare-tunnel-ingress.md`](../docs/plan/done/cloudflare-tunnel-ingress.md):

> Does a Cloudflare Tunnel actually remove the intermittent per-request drops that
> Tailscale Funnel introduces?

The plan shipped the two ingress escape hatches (`PUBLIC_ORIGIN` + `cloudflared` named tunnel) but left the reliability claim **unproven** — no benchmark was run.
This folder is that benchmark. It is **not** shipped (the npm `files` whitelist is `bin/scripts/public`, so `bench/` never lands in the package).

`bench/out/` (raw results) is git-ignored.

---

## 1. The authoritative benchmark (manual, from the plan)

The truest signal is a real connector session, because the drop is specific to long-lived streaming `POST /mcp` traffic — simple probes stay green while connector requests fail. Steps, straight from the plan's `## Test`:

1. Stand up the ingress you want to measure so it terminates at `127.0.0.1:9999` (Funnel = default; Cloudflare = `npm start -- --tunnel <cred.json> --origin https://your-host`, or `PUBLIC_ORIGIN=https://your-host` with your own edge).
2. Connect a fresh Claude connector through that public hostname.
3. Drive a long tool-call session (many `Read Multiple Files`, including a large file) and watch for the `"…hostname doesn't resolve or isn't reachable…"` catch-all over **≥30 min** — the same usage that reproduces the Funnel drop.
4. Compare drop frequency against a Funnel baseline over a comparable window.
5. Cross-check the gatekeeper log (`[gatekeeper] … -> <status> <ms>ms`): a failing request that **arrives** is our bug; one that **never arrives** is an edge bug.

**Success:** materially fewer (ideally zero) per-request drops than Funnel, with no change to OAuth/gatekeeper/bridge code.

**Stop:** if drops persist at a similar rate, the edge is not the cause — keep Funnel for its zero-config advantage, and look upstream (Anthropic↔edge hop, or the bridge under load).

---

## 2. The automated harness (`drop-rate.mjs`)

A dependency-free, black-box HTTP client that hammers the **public edge** at a fixed rate with keep-alive connections, classifies every request, and writes per-request JSONL + a summary. It never touches OAuth/gatekeeper/bridge code — it only exercises the edge, exactly like a connector.

### What counts as a "drop"
A drop = the request did **not** get a clean HTTP answer from the origin:
- network error: `ECONNRESET`, `ETIMEDOUT`, `ECONNREFUSED`, DNS/TLS failure, socket hang up, our timeout;
- edge error status: `502/503/504` or Cloudflare's `520–527/530` origin-error family;
- a body matching `isn't reachable` / `doesn't resolve` / `bad gateway` / `error code: 52…`.

`ok` = the expected status for the mode. `unexpected` = a clean HTTP answer with a different status (recorded, not a drop) — useful for catching routing mistakes (see §4).

### Modes
| mode | request | expected | notes |
|------|---------|----------|-------|
| `preflight` (default) | `POST /mcp`, no token | `401` | auth-free per-request edge proxy. No SSE, so it under-tests stream-specific drops, but needs no secret. |
| `wellknown` | `GET /.well-known/oauth-protected-resource/mcp` | `200` | pure edge-liveness control (the probe the plan notes "always returns 200"). |
| `mcp` | `POST /mcp` + `--token`, real JSON-RPC `initialize`, `Accept: text/event-stream` | `200` | closest automated reproduction — a mid-stream reset counts as a drop. Grab the bearer from a live connector session. Use `--payload-kb` to push bytes. |

Redirects (`3xx`) are followed by default (`--max-redirects 3`, method+body preserved), because a real connector follows them too.

### Run
```bash
# Funnel baseline (default ingress) — 30 min
node bench/drop-rate.mjs run --origin https://<your-funnel-host> --label funnel --minutes 30

# Cloudflare candidate — same window & workload
node bench/drop-rate.mjs run --origin https://<your-cf-host> --label cloudflare --minutes 30

# Closest reproduction (needs a bearer from a live session)
node bench/drop-rate.mjs run --origin https://<host> --label cf-mcp --mode mcp \
  --token "<BEARER>" --payload-kb 64 --minutes 30
```
Ctrl-C finalizes early and still writes the summary.

### Options
`--origin` (required) · `--label` · `--mode preflight|wellknown|mcp` · `--minutes 30` · `--concurrency 4` · `--gap-ms 500` · `--timeout-ms 15000` · `--token` · `--payload-kb 0` · `--max-redirects 3` · `--report-sec 30` · `--out <file>`

The label defaults to the origin hostname, and output defaults to `bench/out/<label>-<mode>-<timestamp>.jsonl`. Set `--max-redirects 0` to disable redirects. `--payload-kb` pads the MCP `initialize` body; `--gap-ms` is the delay between each worker's requests.

### Compare
```bash
node bench/drop-rate.mjs compare bench/out/funnel-*.summary.json bench/out/cloudflare-*.summary.json
```
Prints both drop rates, the delta, and a verdict against the plan's success/stop criteria.

---

## 3. Getting a bearer token for `--mode mcp`
The connector obtains it via the OAuth flow (`/authorize` → passphrase → `/token`).
The simplest path is to copy the `Authorization: Bearer …` from an active connector session (or from `~/.aki/mcpsv/tokens.json`) and pass it with `--token`.

---

## 4. Precondition — the origin must actually reach the gatekeeper
Before trusting any numbers, sanity-check the target host:

```bash
node bench/drop-rate.mjs run --origin https://<host> --mode wellknown --minutes 0.1 --concurrency 1
```

Expect `status 200` (the gatekeeper's OAuth metadata). If you instead see `404`, a `3xx` into an HTML page, or any non-gatekeeper response, the edge is **not** routing to `127.0.0.1:9999` and the benchmark is measuring the wrong server.

> Observed 2026-09: with `PUBLIC_ORIGIN=https://oakgatekeeper.uk`, the apex host is fronted by the Vercel dashboard — `GET /.well-known/oauth-protected-resource/mcp` → `404`, `POST /mcp` → `308` into the dashboard SPA (`200` HTML). The public edge does not reach the local gatekeeper, so the correct MCP hostname (or a working `cloudflared` route to `:9999`) must be established first.
