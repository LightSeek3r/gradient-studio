// A small suite against the REAL workerd runtime, through `wrangler dev --local`
// (miniflare/workerd from the installed wrangler). Nothing is deployed and no
// Cloudflare account or network access is used. Opt-in because it starts a
// process and takes several seconds:
//
//   npm run test:workerd -w opal42-mcp-worker

import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let child: ChildProcess | undefined;
let base = "";

const META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "workerd-tests", version: "0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function mcp(method: string, params: Record<string, unknown> = {}, extra: Record<string, string> = {}): Promise<{ res: Response; body: Json }> {
  const name: Record<string, string> = typeof params.name === "string" ? { "mcp-name": params.name } : {};
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2026-07-28", "mcp-method": method, ...name, ...extra },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: META } }),
  });
  return { res, body: await res.json() };
}

beforeAll(async () => {
  child = spawn("npx", ["wrangler", "dev", "--local", "--port", "0", "--ip", "127.0.0.1", "--inspector-port", "0"], {
    cwd: root,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1", NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // own process group, so the whole npx > wrangler > workerd tree can be stopped
  });
  base = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("wrangler dev did not become ready in 60 s")), 60_000);
    let log = "";
    const onData = (d: Buffer) => {
      log += d.toString();
      const m = /Ready on (http:\/\/[^\s]+)/.exec(log);
      if (m) {
        clearTimeout(timer);
        resolve((m[1] as string).replace(/\/$/, ""));
      }
    };
    child?.stdout?.on("data", onData);
    child?.stderr?.on("data", onData);
    child?.on("exit", (code) => reject(new Error(`wrangler dev exited early (${code}):\n${log.slice(-800)}`)));
  });
}, 90_000);

afterAll(async () => {
  if (!child) return;
  const stop = (signal: NodeJS.Signals) => {
    try {
      if (child?.pid) process.kill(-child.pid, signal);
    } catch {
      // already gone
    }
  };
  stop("SIGTERM");
  await new Promise((r) => setTimeout(r, 1000));
  stop("SIGKILL");
});

describe("in workerd", () => {
  it("serves /healthz with the security headers", async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("serves the status page with the D4 privacy wording", async () => {
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain("Cloudflare, as processor, still sees IP addresses (personal data under the GDPR)");
  });

  it("answers server/discover and tools/list with no initialize", async () => {
    const d = await mcp("server/discover");
    expect(d.body.result.supportedVersions).toContain("2026-07-28");
    const l = await mcp("tools/list");
    expect(l.body.result.tools.map((t: Json) => t.name)).toEqual(["score_gradient", "refine_gradient", "complement", "render_preview"]);
  });

  it("scores, refines (within the configured 3-stop cap), complements and previews", async () => {
    const css = "a{background:linear-gradient(90deg,#ff0000,#00ff00,#0000ff)}";
    expect((await mcp("tools/call", { name: "score_gradient", arguments: { css } })).body.result.structuredContent.gradients[0].score).toBe(58);
    const r = await mcp("tools/call", { name: "refine_gradient", arguments: { css } });
    expect(r.body.result.structuredContent.gradients[0].refined).toBe(true);
    expect((await mcp("tools/call", { name: "complement", arguments: { color: "tomato" } })).body.result.structuredContent.complement).toBe("#00b0c9");
    const p = await mcp("tools/call", { name: "render_preview", arguments: { stops: [{ color: "#f00" }, { color: "#00f" }], width: 64, height: 32 } });
    expect(p.body.result.content[1].text).toMatch(/^<svg xmlns=/);
  });

  it("applies the wrangler.jsonc CPU guard", async () => {
    const stops = Array.from({ length: 6 }, (_, i) => ({ color: `#${(i * 40).toString(16).padStart(2, "0")}40c0` }));
    const { body } = await mcp("tools/call", { name: "refine_gradient", arguments: { stops } });
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("at most 3 stops");
  });

  it("serves 2025 clients statelessly", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "old", version: "1" } } }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeNull();
    expect(await res.text()).toContain("opal42-mcp");
  });

  it("rejects bad input as JSON-RPC errors", async () => {
    const bad = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as Json).error.code).toBe(-32700);
    const big = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(40_000) });
    expect(big.status).toBe(413);
    expect((await fetch(`${base}/mcp`)).status).toBe(405);
    expect((await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" })).status).toBe(403);
  });

  it("is deterministic across requests", async () => {
    const a = await (await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": "complement" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "complement", arguments: { color: "#123456" }, _meta: META } }) })).text();
    const b = await (await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": "complement" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "complement", arguments: { color: "#123456" }, _meta: META } }) })).text();
    expect(b).toBe(a);
  });
});
