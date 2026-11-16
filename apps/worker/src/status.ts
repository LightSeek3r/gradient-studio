// The human-readable status page served at GET /. Fully static: no request
// data is interpolated into it, so it cannot reflect anything.

import { MAX_BODY_BYTES } from "./limits";

export const PRIVACY_STATEMENT =
  "Stateless: no storage, no request-body logging, no cookies. Cloudflare, as processor, still sees IP addresses (personal data under the GDPR).";

const KB = MAX_BODY_BYTES / 1024;

export function statusPage(tools: readonly string[], version: string): string {
  const items = tools.map((t) => `<li><code>${t}</code></li>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>opal42 MCP (hosted)</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1a1a1a;--muted:#555;--line:#d6d6d6;--code:#f2f2f2}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--fg:#ececec;--muted:#a8a8a8;--line:#333;--code:#1f1f1f}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,sans-serif}
main{max-width:42rem;margin:0 auto;padding:2rem 16px 3rem}
h1{font-size:1.4rem;margin:0 0 .25rem}h2{font-size:1.05rem;margin:1.8rem 0 .4rem}
p,li{margin:.4rem 0}.muted{color:var(--muted)}
code{background:var(--code);padding:.1em .35em;border-radius:4px;font-size:.92em}
.box{border:1px solid var(--line);border-radius:8px;padding:.7rem 1rem}
</style>
</head>
<body>
<main>
<h1>opal42 MCP, hosted</h1>
<p class="muted">Status: running &middot; version ${version} &middot; MCP revision 2026-07-28 (2025 clients are served statelessly)</p>

<h2>What this is</h2>
<p>A remote <a href="https://modelcontextprotocol.io">Model Context Protocol</a> endpoint at <code>POST /mcp</code> (Streamable HTTP). It scores CSS gradients for smoothness, proposes refinements, returns a colour's complement and draws an SVG preview. It is meant for MCP clients, not browsers, and there is no REST API.</p>
<ul>${items}</ul>
<p class="muted">The number is a smoothness score by a published definition (scoring model v1). It is not a quality verdict and has no pass threshold.</p>

<h2>Privacy</h2>
<p class="box">${PRIVACY_STATEMENT}</p>
<p>The gradients you send are processed in memory to build the answer and are then gone. This is a hosted service: your requests do leave your device. For fully local use, run the stdio server, the CLI or the web app instead.</p>

<h2>Limits</h2>
<ul>
<li>Request body up to ${KB} KB, JSON only, POST only.</li>
<li>CORS is off: browser pages cannot call it unless the operator allow-lists their origin.</li>
<li>The operator may rate limit requests per IP address.</li>
</ul>

<h2>Endpoints</h2>
<ul>
<li><code>POST /mcp</code>: MCP over Streamable HTTP (JSON-RPC)</li>
<li><code>GET /healthz</code>: liveness</li>
<li><code>GET /</code>: this page</li>
</ul>
<p class="muted"><a href="https://github.com/LightSeek3r/gradient-studio/blob/master/docs/worker.md">Documentation</a></p>
</main>
</body>
</html>
`;
}
