# opal42-mcp-worker

A stateless Cloudflare Worker that serves the opal42 gradient MCP tools
(`score_gradient`, `refine_gradient`, `complement`, `render_preview`) over
Streamable HTTP at `POST /mcp`. Private workspace package; **not deployed**, no
Cloudflare resource exists for it. Working name.

**Privacy (hosted, PLAN D4):** stateless: no storage, no request-body logging, no
cookies; Cloudflare, as processor, still sees IP addresses (personal data under
the GDPR). Requests to a hosted endpoint do leave your device; for fully local
use run the stdio server (`packages/mcp`), the CLI or the web app.

| Route | |
|---|---|
| `POST /mcp` | MCP revision 2026-07-28 (no `initialize`), plus 2025 clients statelessly |
| `GET /` | human-readable status page with the privacy text |
| `GET /healthz` | `{"status":"ok"}` |

There is no REST API (PLAN D4).

```sh
npm run dev   -w opal42-mcp-worker   # wrangler dev (local workerd, no account needed)
npm test      -w opal42-mcp-worker   # Node tests
npm run test:workerd -w opal42-mcp-worker  # the same endpoints in real workerd (opt-in)
npm run build -w opal42-mcp-worker   # wrangler --dry-run bundle + size; deploys nothing
npm run bench -w opal42-mcp-worker   # CPU benchmark (Node)
```

Everything else (limits, CPU numbers, the owner's deploy checklist, the rate
limit rule): [docs/worker.md](../../docs/worker.md).
