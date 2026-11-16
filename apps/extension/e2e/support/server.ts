// Two tiny HTTP servers for the fixture pages. They are different origins
// (127.0.0.1 vs localhost), so a stylesheet served by the second one is
// cross-origin for a page served by the first: its rules are unreadable, as on
// real sites with a CDN.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const SAME_CSS = `
:root { --brand: linear-gradient(135deg, #101b45 0%, #3f1d63 50%, #9333ea 100%); }
.hero { background: var(--brand); height: 80px; }
.rough { background-image: linear-gradient(90deg, #ff0000, #00ff00 50%, #0000ff); height: 40px; }
.smooth { background-image: linear-gradient(90deg, #1e3a8a, #3b82f6); height: 40px; }
.fade { background-image: linear-gradient(to right, rgba(0, 0, 0, 0), #ff0000); height: 40px; }
.glow { background-image: radial-gradient(circle at center, #ff0000, #0000ff); height: 40px; }
.cone { background-image: conic-gradient(from 90deg, #ff0000, #00ff00, #0000ff, #ff0000); height: 40px; }
.stripes { background-image: repeating-linear-gradient(45deg, #ffffff 0%, #000000 10%); height: 40px; }
.masked { background: #123; mask-image: linear-gradient(#000, transparent); height: 40px; }
.bordered { border: 6px solid; border-image-source: linear-gradient(90deg, #ff0080, #7928ca); border-image-slice: 1; height: 40px; }
.pseudo::after { content: ""; display: block; height: 20px; background-image: linear-gradient(#0f2027, #2c5364); }
li.mark { list-style-image: linear-gradient(#f00, #00f); }
@layer base { .layered { background-image: linear-gradient(90deg, #134e5e, #71b280); height: 40px; } }
@media (min-width: 1px) { .media { background-image: linear-gradient(90deg, #232526, #414345); height: 40px; } }
.card { color: #111; & .inner { background-image: linear-gradient(#614385, #516395); height: 40px; } }
@keyframes pulse { from { background-image: linear-gradient(#000, #111); } to { background-image: linear-gradient(#222, #333); } }
.custom { --accent: linear-gradient(90deg, #ee0979, #ff6a00); height: 10px; }
.custom-use { background-image: var(--accent); height: 10px; }
.legacy { background-image: -webkit-linear-gradient(left, #f00, #00f); height: 10px; }
`;

const CROSS_CSS = `.xo { background-image: linear-gradient(to right, #ff00ff, #00ffff); height: 40px; }`;

function page(crossOrigin: string, body: string, head = ""): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>fixture</title>
<link rel="stylesheet" href="/same.css">
<link rel="stylesheet" href="${crossOrigin}/cross.css">
<style>.inline { background-image: linear-gradient(90deg, #0f0c29, #302b63, #24243e); height: 40px; }</style>
${head}</head><body>${body}</body></html>`;
}

export const FIXTURE_BODY = `
<div class="hero" id="hero">hero</div>
<div class="rough" id="rough">rough</div>
<div class="smooth smooth-a">a</div><div class="smooth smooth-b">b</div>
<div class="fade">fade</div>
<div class="glow">glow</div>
<div class="cone">cone</div>
<div class="stripes">stripes</div>
<div class="masked">masked</div>
<div class="bordered">bordered</div>
<div class="pseudo">pseudo</div>
<ul><li class="mark">item</li></ul>
<div class="layered">layered</div>
<div class="media">media</div>
<div class="card"><div class="inner">inner</div></div>
<div class="custom"><div class="custom-use">uses custom</div></div>
<div class="legacy">legacy</div>
<div class="xo">cross-origin sheet</div>
<div class="inline">inline style sheet</div>
<div style="background-image: linear-gradient(45deg, #fc466b, #3f5efb); height: 20px" id="inline-attr">inline attribute</div>
<script>
  const sheet = new CSSStyleSheet();
  sheet.replaceSync('.adopted { background-image: linear-gradient(90deg, #4568dc, #b06ab3); height: 20px; }');
  document.adoptedStyleSheets = [sheet];
  const d = document.createElement('div'); d.className = 'adopted'; d.textContent = 'adopted'; document.body.appendChild(d);
</script>`;

export interface Fixture {
  origin: string;
  crossOrigin: string;
  close(): Promise<void>;
}

function listen(server: Server, host: string): Promise<number> {
  return new Promise((resolve) => server.listen(0, host, () => resolve((server.address() as AddressInfo).port)));
}

export async function startFixture(): Promise<Fixture> {
  const cross = createServer((req, res) => {
    if (req.url?.startsWith("/cross.css")) {
      res.writeHead(200, { "content-type": "text/css" }).end(CROSS_CSS);
    } else res.writeHead(404).end();
  });
  const crossPort = await listen(cross, "127.0.0.1");
  // "localhost" and "127.0.0.1" are different origins: serve the page on 127.0.0.1 and the
  // stylesheet from "localhost" (same listener address family, different host name).
  const crossOrigin = `http://localhost:${crossPort}`;

  const main = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/same.css") return void res.writeHead(200, { "content-type": "text/css" }).end(SAME_CSS);
    if (url.pathname === "/") return void res.writeHead(200, { "content-type": "text/html" }).end(page(crossOrigin, FIXTURE_BODY));
    if (url.pathname === "/big") {
      const n = Math.min(100_000, Number(url.searchParams.get("n") ?? 20000));
      // Every 40th element carries a gradient class; the gradient sits late in the document too.
      const cells = Array.from({ length: n }, (_, i) => `<div class="cell${i % 40 === 0 ? " smooth" : ""}"></div>`).join("");
      return void res.writeHead(200, { "content-type": "text/html" }).end(page(crossOrigin, cells));
    }
    if (url.pathname === "/empty") return void res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>e</title><p>no gradients here</p>");
    res.writeHead(404).end();
  });
  const mainPort = await listen(main, "127.0.0.1");

  return {
    origin: `http://127.0.0.1:${mainPort}`,
    crossOrigin,
    close: () =>
      new Promise((resolve) => {
        main.close(() => cross.close(() => resolve()));
        main.closeAllConnections();
        cross.closeAllConnections();
      }),
  };
}
