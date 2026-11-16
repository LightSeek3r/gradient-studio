# @opal42/mcp

MCP server (stdio) for CSS gradient smoothness scoring: `score_gradient`,
`refine_gradient`, `complement`, `render_preview`. Working package name; **not
published**, `"private": true`. Local and stateless: no network, no files
written, no telemetry. Node 22 or newer.

```sh
npm run build:packages            # from the repository root
node packages/mcp/dist/cli.js     # serves stdin/stdout; point an MCP client at it
```

Configuration for Claude Desktop, Claude Code and generic clients, the tool
reference and the privacy statement: [docs/mcp.md](https://github.com/LightSeek3r/gradient-studio/blob/master/docs/mcp.md).

The score is a smoothness score under scoring model v1, not a quality verdict.

## Protocol and SDK

| | |
|---|---|
| MCP spec revision served | **2026-07-28** (stateless, no `initialize` needed) |
| Older revisions | 2025-11-25 down to 2024-10-07 through the `initialize` handshake, served by the SDK |
| SDK | `@modelcontextprotocol/server` **2.4.0** (v2 line, depends on `@modelcontextprotocol/core` and `zod` only), via `serveStdio` |
| Tool schemas | Plain JSON Schema (`fromJsonSchema`), written once in `src/schemas.ts`, validated by the SDK and again by the handlers |
| Audit | `npm audit`: 0 vulnerabilities |

Verified in this repository (built executable, own JSON-RPC client): initialize-less
`server/discover`, `tools/list` and `tools/call` carrying the 2026-07-28 `_meta`;
a bare `tools/list` without any handshake; the 2025-06-18 `initialize`
handshake; stdout carrying only JSON-RPC; exit when stdin closes.

### Gaps, stated plainly

- The 2026-07-28 behaviour above is what **SDK 2.4.0 does**, observed on the
  wire. The normative spec text was not read side by side with it, so
  conformance beyond the SDK's own is not claimed.
- Only stdio is shipped. There is no HTTP or Worker transport yet; the
  transport-independent handlers (`@opal42/mcp/handlers`: `TOOLS`, `callTool`)
  exist so that one can be added.
- Not yet tried in a real client (Claude Desktop, Claude Code, others); the PLAN
  exit criterion "works in two different clients" is open.
- No resources, prompts, tasks or elicitation: tools only. The SDK advertises
  `tools.listChanged` although the tool list never changes.
- `render_preview` returns an `image/svg+xml` block; some clients cannot render
  SVG images, so the SVG source is also returned as text.
- `server.json` is a draft against the registry schema of 2025-12-11 (validated
  with a JSON Schema validator, not with `mcp-publisher`); nothing is submitted.
- The older single-package SDK (`@modelcontextprotocol/sdk` 1.x, 17 dependencies
  including express) was not used.

## Layout

| File | Role |
|---|---|
| `src/handlers.ts` | Pure, SDK-free tool handlers: `TOOLS`, `callTool(name, args)` (never throws) |
| `src/schemas.ts`, `src/validate.ts` | Input/output JSON Schemas and the validator that enforces them |
| `src/input.ts`, `src/limits.ts` | Turning `css`/`stops` into gradients; size caps |
| `src/svg.ts` | The allow-listed SVG template |
| `src/server.ts`, `src/cli.ts` | SDK wiring and the `opal42-mcp` executable |
| `server.json` | MCP Registry metadata, **DRAFT** |
