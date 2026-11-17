# opal42 MCP Worker (hosted MCP endpoint)

`apps/worker` (package `opal42-mcp-worker`, private, working name) is a
stateless [Cloudflare Worker](https://developers.cloudflare.com/workers/) that
serves the four tools of [`@opal42/mcp`](mcp.md) (`score_gradient`,
`refine_gradient`, `complement`, `render_preview`) to remote MCP clients over
Streamable HTTP. It is the "remote MCP" row of the Phase 3 plan
([`PLAN.md`](PLAN.md) §6) and follows decision **D4**: no public REST product,
one stateless endpoint for MCP only.

**Status: built and tested locally, not deployed.** No Cloudflare account,
domain or resource has been created or touched. The owner's checklist is at the
end of this page.

## Privacy (hosted: different from every other surface)

> Stateless: no storage, no request-body logging, no cookies. Cloudflare, as
> processor, still sees IP addresses (personal data under the GDPR).

- The Worker has **no bindings** (no KV, D1, R2, Durable Objects, queues,
  services) and **no secrets**. Each request is answered from memory and
  forgotten. It never writes to the console, so request content cannot reach a
  log (a test asserts this).
- `wrangler.jsonc` sets `observability: { enabled: false }` (Workers Logs is on
  by default for new Workers, so it is switched off explicitly) and
  `logpush: false`. There is no Tail Worker.
- No cookies: the Worker never sets one and strips any `Set-Cookie` it sees.
  Every response carries `Cache-Control: no-store`.
- **This is a hosted service: requests do leave your device.** "Nothing leaves
  your device" is reserved for the web app, library, CLI and extensions
  ([`PRIVACY.md`](../PRIVACY.md)). The status page at `/` and the server's MCP
  `instructions` say so. For fully local use run the stdio server
  ([`mcp.md`](mcp.md)).
- What Cloudflare itself records is outside the Worker's control: IP addresses
  and request metadata (method, URL path, status, timing) in its network, and,
  if the owner turns them on, zone analytics, WAF and rate-limit event logs.
  Request *bodies* are not part of those. The owner must keep Workers Logs,
  Logpush jobs that include Workers trace events, and Tail Workers off for this
  Worker, and publish a privacy statement before launch (`PRIVACY.md` already
  requires one).

## Routes

| Route | Behaviour |
|---|---|
| `POST /mcp` | MCP over Streamable HTTP. JSON in, one JSON body out (a single SSE `message` event for 2025 clients that accept it). |
| `GET /` | Static status page: what it is, the privacy text above, limits. Reflects nothing from the request. |
| `GET /healthz` | `{"status":"ok"}` |
| anything else | 404 JSON-RPC error. **No REST score endpoints and no `/openapi.json`** (D4). |

`GET`/`DELETE` on `/mcp` are 405 (`Allow: POST, OPTIONS`): there is no
server-initiated stream and no session.

## Protocol: the official SDK's fetch handler

`@modelcontextprotocol/server` **2.4.0** (already used by the stdio server)
exports `createMcpHandler(factory, options)`, a web-standard
`{ fetch(request) }` handler. It serves MCP revision **2026-07-28** (stateless,
no `initialize`; each request names the version in `_meta` and in the
`MCP-Protocol-Version` header) and, with `legacy: "stateless"`, answers 2025
clients (`initialize`, bare `tools/list`) without a session. The Worker uses it
rather than a hand-written JSON-RPC layer, so protocol conformance is the
SDK's, not ours. Cloudflare's own documentation recommends the same pattern
(a stateless `createMcpHandler` at `/mcp`; its `agents/mcp/server` wrapper is
not needed and not used here). Verified in this repository: the bundle runs in
real workerd (see "Verified") and answers `server/discover`, `tools/list` and
all four `tools/call`s with no handshake, plus the 2025 `initialize` path.

Everything around the SDK is the Worker's own (`apps/worker/src`):

- routing, method and `Content-Type` gating (415 unless `application/json`;
  `Content-Encoding` other than identity is refused, so there are no compressed
  bodies to inflate);
- the body cap (below), JSON parsing with fixed error messages, rejection of
  batches (2026-07-28 has none) and of ids/methods/tool names that would be
  echoed back at length (the SDK echoes an unknown tool name verbatim; the
  Worker answers that case itself with a fixed message);
- Origin check and CORS, security headers, the request timeout, the CPU guard;
- a top-level `catch`: nothing throws, every failure is a JSON-RPC error.

The scoring logic is not here: the Worker imports `@opal42/mcp/handlers`
(`TOOLS`, `callTool`), which import `@opal42/gradient`. A spoke contains
adapters, never scoring logic ([`SCOPE.md`](../SCOPE.md)).

The handlers describe themselves for the local server ("stateless and local",
"Read-only and local"). The Worker rewrites those phrases (hosted instructions
state that requests leave the device); a cleaner fix is to make the handlers'
wording transport-neutral, noted as a follow-up.

## Limits and hardening

| What | Value |
|---|---|
| Request body | 32 KiB (`MAX_BODY_BYTES`). Over it: 413, checked on `Content-Length` and again while streaming, so an oversized stream is cancelled at the cap. Bytes, not characters. |
| Tool input caps | the handlers' own: `css` 20,000 chars, 32 gradients, 2-32 stops, preview 16-2048 px |
| CPU guard | at most **128 stops in total** per `score_gradient`/`render_preview` request; at most `REFINE_MAX_STOPS` (default 16, **8 in `wrangler.jsonc`**, 0 disables) for `refine_gradient`. Over it: a tool result with `isError`, before any scoring runs. See "CPU". |
| Wall-clock timeout | 8 s per request (504 JSON-RPC error). A guard against hung streams, not a CPU limit. |
| JSON-RPC id / method | at most 128 characters |
| Methods | `POST /mcp` only; `OPTIONS` only for allow-listed origins |
| CORS | **off**. `CORS_ALLOWED_ORIGINS` (comma-separated exact origins; `*`, paths and non-http(s) values are ignored; at most 16) is the only way in. A request with an `Origin` header that is not listed gets 403 (MCP asks servers to validate Origin against DNS rebinding); requests without `Origin`, i.e. every non-browser MCP client, are unaffected. |
| Headers on every response | `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, a `default-src 'none'` CSP with `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Cross-Origin-Resource-Policy` and `-Opener-Policy: same-origin`, `Permissions-Policy`, `Strict-Transport-Security: max-age=31536000`, `X-Robots-Tag: noindex` |
| Cookies | never set |
| Errors | fixed messages; request content is never echoed beyond the tools' own escaped, truncated excerpts (`render_preview` builds its SVG from a fixed template of validated colours and numbers) |

## CPU (measured in Node, not workerd)

`npm run bench -w opal42-mcp-worker` times the tools on the largest allowed
inputs with `process.hrtime.bigint()` (wall time of synchronous, I/O-free code,
a fair upper bound of CPU time). Node 22, 500 runs after 30 warm-up runs, on a
shared cloud VM; times in ms. Workers Free plan limit: **10 ms CPU per request**
(Cloudflare limits page, checked 2026-11; Workers Paid: 30 s default).
`first` is the first call of that path in the process, nearest to a cold isolate.

| Case | first | p50 | p95 |
|---|---:|---:|---:|
| handlers: `score_gradient`, 1 gradient, 32 stops | 0.2 | 0.1 | 0.2 |
| handlers: `score_gradient`, 16.5 KB css, 32 gradients x 32 stops (handler maximum) | 40 | 5.7 | **9.4** |
| handlers: `refine_gradient`, 3 stops | 8.8 | 1.3 | 2.2 |
| handlers: `refine_gradient`, 8 stops | 3.8 | 3.0 | 4.7 |
| handlers: `refine_gradient`, 16 stops | 6.2 | 5.1 | 7.3 |
| handlers: `refine_gradient`, 32 stops | 10 | 9.2 | 11.6 |
| handlers: `refine_gradient`, 32 gradients x 32 stops (handler maximum) | 357 | **267** | 271 |
| handlers: `render_preview`, 32 stops, oklch, 2048 x 2048 | 2.1 | 0.15 | 0.2 |
| handlers: `complement` | 0.8 | 0.01 | 0.01 |
| handlers: 20 KB hostile nested / junk css | 15 / 0.5 | 1.5 / 0.4 | 2.5 / 0.6 |
| **Worker** (whole request path incl. SDK): `score_gradient` at the guard maximum, 128 stops | 3.8 | 1.8 | 3.3 |
| Worker: `refine_gradient`, 3 stops (`REFINE_MAX_STOPS=3`) | 2.4 | 1.8 | 3.2 |
| Worker: `refine_gradient`, 8 stops (`REFINE_MAX_STOPS=8`, the `wrangler.jsonc` setting) | 3.8 | 3.1 | 4.8 |
| Worker: `refine_gradient`, 16 stops (the code default) | 5.0 | 5.1 | 7.3 |
| Worker: `render_preview`, 32 stops / css at the guard maximum | 0.7-1.0 | 0.6-0.8 | 0.9-1.1 |
| Worker: `complement` (SDK and routing overhead only) | 0.4 | 0.3 | 0.5 |
| Worker: a refused over-budget request | 0.4-0.5 | 0.2-0.45 | 0.4-0.7 |

Maximums in the raw output are occasionally 5-30 ms outliers (GC and VM
scheduling) and are not shown; this is wall time, not isolated CPU time.

**Reading it:**

- `score_gradient`, `render_preview` and `complement` are cheap. Only the
  handlers' absolute maximum for scoring (32 x 32 stops, p95 9.4 ms) is near the
  10 ms Free-plan limit, so the Worker caps the **total stops per request at
  128** (about 2-3 ms).
- **`refine_gradient` was the problem and is now cheap.** Before the core's
  fix search was made exact-but-pruned (see "Fix search cost" below) it cost
  4.4 ms for 3 stops, 26 ms for 8, 65 ms for 16, 274 ms for 32 and **7 seconds**
  for the handlers' maximum input (32 x 32 stops); only about 3 stops fit under
  the Free plan's 10 ms, so `wrangler.jsonc` set `REFINE_MAX_STOPS` to `"3"`.
  Now it is 1.3 / 3.0 / 5.1 / 9.2 ms and **0.27 s** for the maximum input. The
  shipped `wrangler.jsonc` therefore sets `REFINE_MAX_STOPS` to `"8"`: the
  Worker's 8-stop request (p50 3.1 ms, p95 4.8 ms) now costs less than the old
  3-stop one did (3.7 / 5.5 ms), which was the accepted setting. 16 stops (the
  code default, p50 5.1 ms, p95 7.3 ms) leaves too little margin for a cold
  workerd isolate on Free, so it stays a Workers Paid setting; set `0` to turn
  `refine_gradient` off on a deployment that must stay on Free. Re-check after
  the first deploy (next bullet).
- Nothing here was measured inside workerd: **CPU time in the real runtime is
  unverified** (the sandbox gives no isolate CPU counter). Re-measure after the
  first deploy with the dashboard's CPU-time metrics before trusting the Free
  plan.
- Cold start: module evaluation is small (the bundle is about 120 KiB gzipped
  minified; the startup limit is 1 s).

### Fix search cost

`proposeFixes` (inside `refine_gradient`) used to dominate: it re-scored every
candidate edit for every finding (about 2,000 full scores for 32 random stops).
`npm run bench:perf -w @opal42/gradient` (seeded random colours, even positions;
median / p95 ms, Node 22 on a shared VM) measures the core directly:

| `proposeFixes` | 3 stops | 8 | 16 | 32 |
|---|---:|---:|---:|---:|
| before | 2.5 / 4.9 | 24 / 36 | 69 / 90 | 259 / 279 |
| after | 0.6 / 1.4 | 2.3 / 7.1 | 3.8 / 10 | 9.7 / 33 |
| candidate re-scores, before / after | 122 / 69 | 512 / 54 | 1,025 / 45 | 2,003 / 38 |

`scoreGradient` and `refineGradient` themselves were never the cost (0.10 and
0.18 ms at 32 stops before, 0.03 and 0.10 after). What changed, with outputs
byte-identical (the vectors, export goldens and a differential test against a
frozen copy of the old code on thousands of inputs, `packages/core/tests/perf-equivalence.test.ts`):
colour conversions are done once per colour, a candidate's score is derived from the
unedited gradient's prepared data instead of from scratch, candidates are
scored once however many findings generate them, and a candidate is not scored
at all when it provably cannot remove the finding it was generated for
(`packages/core/src/api/fix-persistence.ts` states the argument per rule; the
test audits every skip against a real score). Not every gradient is as
favourable as the benchmark's: a candidate that might remove a finding is still
scored, and findings about the whole gradient (low contrast, uneven speed) are
not pruned; across the test families the worst 32-stop median was about 10 ms.

## Bundle size

`npm run build -w opal42-mcp-worker` runs `wrangler deploy --dry-run --outdir
apps/worker/dist` (works offline, no credentials, uploads nothing):

| | Uncompressed | gzip |
|---|---:|---:|
| as `wrangler deploy` bundles it | 808.8 KiB | 171.6 KiB |
| `--minify` | 418.0 KiB | 120.5 KiB |

The old Free-plan limit of 3 MB compressed was **removed on 2026-09-04**
(Cloudflare changelog); the limit is now 64 MiB uncompressed on all plans. Either
way the Worker is far below it (about 6% of the old 3 MB figure, about 1% of the new
limit).

## Configuration (`apps/worker/wrangler.jsonc`)

This is a Worker project config, not the Pages config of `apps/web`.

- `name: "opal42-mcp"`: placeholder. No `routes`, no `workers_dev` setting: the
  owner decides the domain.
- `compatibility_date: "2026-11-01"`. The installed wrangler (4.163.0) bundles
  workerd 2026-11-16, the newest date it accepts; 2026-11-01 was accepted by
  `wrangler deploy --dry-run` and ran under `wrangler dev` (real workerd). No
  compatibility flags: the Worker uses only web-standard APIs, so `nodejs_compat`
  is off.
- `observability.enabled: false`, `logpush: false` (privacy, above).
- `vars`: `CORS_ALLOWED_ORIGINS` (empty: CORS off) and `REFINE_MAX_STOPS`.
  Vars are not secrets and are readable in the dashboard; there are no secrets.
- `alias` maps `@opal42/mcp/handlers` and `@opal42/gradient` to the workspace
  TypeScript sources, so `wrangler dev` and `deploy` need no prior
  `npm run build:packages`.
- Deliberately absent: every binding.

## Run it locally (no account, no network)

```sh
npm ci
npm run dev -w opal42-mcp-worker          # wrangler dev, http://localhost:8787
```

```sh
META='"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"curl","version":"0"},"io.modelcontextprotocol/clientCapabilities":{}}'
curl -s localhost:8787/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -H 'mcp-protocol-version: 2026-07-28' -H 'mcp-method: tools/call' -H 'mcp-name: complement' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"complement\",\"arguments\":{\"color\":\"tomato\"},$META}}"
```

A 2026-07-28 request must carry the version in both `_meta` and the
`MCP-Protocol-Version` header (the SDK answers `-32020` if the header is
missing). Real clients do this for you. Wrangler may print a `Request.cf`
warning when offline; it is harmless.

Tests:

```sh
npm test -w opal42-mcp-worker              # Node, handler called with Request objects
npm run test:workerd -w opal42-mcp-worker  # same endpoints in real workerd via wrangler dev --local (opt-in)
```

## Rate limiting: a Cloudflare rule, not Worker code

The Worker has no storage, so it cannot count requests and does not try. Rate
limiting is done by Cloudflare **rate limiting rules** (WAF, zone level, phase
`http_ratelimit`), which run before the Worker and cost it no CPU.
**This needs a zone**: a `*.workers.dev` URL has none, so deploy on a custom
domain (see the checklist) before relying on it.

Suggested rule for the **Free plan** (Free counts by IP only, with a
10 s period, action *Block* for 10 s; custom block responses need Pro):

```json
{
  "description": "opal42 MCP: 10 requests per 10 s per IP",
  "expression": "(http.host eq \"mcp.example.com\" and http.request.uri.path eq \"/mcp\")",
  "action": "block",
  "ratelimit": {
    "characteristics": ["cf.colo.id", "ip.src"],
    "period": 10,
    "requests_per_period": 10,
    "mitigation_timeout": 10
  }
}
```

On Pro and above use a longer window instead, for example `period: 60`,
`requests_per_period: 60`, `mitigation_timeout: 600`, and a custom 429 JSON body
(`action_parameters.response`: status 429, `application/json`). Do not use a
challenge action: MCP clients cannot solve one. If `refine_gradient` is enabled
at higher stop counts, lower the rate accordingly (a 16-stop refine is about
50-70 ms of CPU).

Applying it (owner, with a token that has *Zone WAF Write*): add the rule to the
zone's `http_ratelimit` entry-point ruleset with the Rulesets API
(`POST /zones/{zone_id}/rulesets/{ruleset_id}/rules`, or create the entry point
if it does not exist), the dashboard (Security > Security rules > Rate limiting
rules), or Terraform (`cloudflare_ruleset`, `phase = "http_ratelimit"`). Rule
fields were checked against Cloudflare's documentation; **the rule itself was not
created or tested**. The rule's own event logs record IPs and paths; keep that in
the privacy statement.

## Owner deploy checklist (NOT done: nothing below has been run)

- [ ] Cloudflare account; decide Free vs Paid (see "CPU": Free means
      `REFINE_MAX_STOPS=8` (the shipped value) or lower, or `0`).
- [ ] Choose a domain on a zone you control (for example `mcp.<your-domain>`).
      Add `routes: [{ "pattern": "mcp.<domain>", "custom_domain": true }]` to
      `wrangler.jsonc`; decide whether to keep or disable `workers_dev` /
      `preview_urls`.
- [ ] Rename the Worker if `opal42-mcp` is not wanted (name changes the
      workers.dev subdomain). Names are working names ([`PLAN.md`](PLAN.md) D1).
- [ ] Create and attach the rate limiting rule above.
- [ ] Privacy: confirm in the dashboard that Workers Logs, traces and Logpush are
      off for the Worker, no Tail Worker, no Web Analytics beacon; publish the
      privacy statement ([`PRIVACY.md`](../PRIVACY.md) promises it first).
- [ ] `CORS_ALLOWED_ORIGINS`: leave empty unless a browser client needs it.
- [ ] `npm run build -w opal42-mcp-worker`, then `npx wrangler deploy` (first
      deploy only after the above; use a scoped API token, not a login on a
      shared machine).
- [ ] Smoke test the deployed URL (curl above, `GET /healthz`), then look at the
      dashboard's CPU time metrics and revisit `REFINE_MAX_STOPS`.
- [ ] Try it from two real MCP clients (the PLAN exit criterion is still open for
      the stdio server too).
- [ ] MCP Registry: add a `remotes` entry to `packages/mcp/server.json`
      (**not added**; the draft there has only `packages`). Shape per the
      registry's server schema, not validated with `mcp-publisher`:

      ```json
      "remotes": [{ "type": "streamable-http", "url": "https://mcp.<your-domain>/mcp" }]
      ```

      Publishing needs the name/namespace decisions of PLAN D1 and a real URL.
- [ ] Update `docs/mcp.md` and `PRIVACY.md` to point at the live endpoint and
      state its privacy text.

## What was verified, what was not

Verified here (Node 22, wrangler 4.163.0 / workerd 2026-11-16, MCP SDK 2.4.0):

- The Node suite (`npm test -w opal42-mcp-worker`) drives the fetch handler
  directly with `Request` objects: routes, `tools/list`, every tool, the 2025
  handshake, invalid JSON, wrong methods, oversized bodies (declared and
  streamed), hostile SVG and css inputs, headers on every response kind, CORS,
  CPU guard, determinism, no console output, no echo of request content.
- The opt-in workerd suite runs 8 end-to-end checks in the real workerd runtime
  through `wrangler dev --local`. It is **not** part of `npm test`/CI (it starts
  a process).
- `wrangler deploy --dry-run` works offline and reports the bundle size above.

Not verified:

- CPU time and memory in the Workers runtime (Node numbers only), and behaviour
  on the real edge (limits, cold starts, the `Request.cf` object).
- Anything against a live Cloudflare account: rate limit rule, custom domain,
  routes, dashboard settings, Free-plan behaviour of the 10 ms limit.
- Conformance with the normative MCP 2026-07-28 text beyond what the SDK does
  (the same gap as the stdio server), and use from a real MCP client.
- The registry `remotes` entry (see above).
- `@cloudflare/vitest-pool-workers` was not used: its current release requires
  vitest 4 and pins its own wrangler/miniflare, while this repo is on vitest 5.

Known gaps: the shared handlers' "local" wording is patched in the Worker rather
than fixed at the source; the SDK advertises `tools.listChanged` although the
list never changes; `render_preview` returns an SVG image block that some clients
cannot display (the SVG source is also returned as text).
