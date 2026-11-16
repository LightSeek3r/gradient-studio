import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS } from "../src/http";
import { JSON_HEADERS, ORIGIN, modernInit, postJson, postRaw, send, type Json } from "./helpers";

const ALLOWED = "https://app.example";
const env = { CORS_ALLOWED_ORIGINS: `${ALLOWED}, https://other.example` };

/** One request per kind of response the Worker can produce. */
const cases: [string, () => Promise<Response>][] = [
  ["status page", () => send("/")],
  ["status page HEAD", () => send("/", { method: "HEAD" })],
  ["healthz", () => send("/healthz")],
  ["404", () => send("/nope")],
  ["405 on /mcp", () => send("/mcp")],
  ["405 on /", () => send("/", { method: "DELETE" })],
  ["415", () => postRaw("{}", { "content-type": "text/plain" })],
  ["parse error", () => postRaw("{")],
  ["413", () => postRaw("x".repeat(40_000))],
  ["invalid request", () => postJson({})],
  ["unknown tool", () => postJson({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "x" } })],
  ["tools/list (modern)", () => send("/mcp", modernInit("tools/list"))],
  ["tools/call (modern)", () => send("/mcp", modernInit("tools/call", { name: "complement", arguments: { color: "red" } }))],
  ["initialize (legacy)", () => postJson({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "a", version: "1" } } })],
  ["notification 202", () => postJson({ jsonrpc: "2.0", method: "notifications/initialized" })],
  ["forbidden origin", () => send("/mcp", { method: "POST", headers: { ...JSON_HEADERS, origin: "https://evil.example" }, body: "{}" })],
  ["preflight", () => send("/mcp", { method: "OPTIONS", headers: { origin: ALLOWED } }, env)],
];

describe("security headers on every response", () => {
  it.each(cases)("%s", async (_name, make) => {
    const res = await make();
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(k), k).toBe(v);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("includes a locked-down CSP and no framing", () => {
    expect(SECURITY_HEADERS["content-security-policy"]).toMatch(/default-src 'none'/);
    expect(SECURITY_HEADERS["content-security-policy"]).toMatch(/frame-ancestors 'none'/);
    expect(SECURITY_HEADERS["content-security-policy"]).not.toMatch(/script-src|unsafe-eval/);
    expect(SECURITY_HEADERS["x-content-type-options"]).toBe("nosniff");
  });

  it("never sets a cookie, even when the request sends one", async () => {
    for (const make of cases) {
      const res = await make[1]();
      expect([...res.headers.keys()].filter((k) => k.startsWith("set-cookie"))).toEqual([]);
    }
    const res = await send("/", { headers: { cookie: "session=abc" } });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("gives every JSON response a JSON content type", async () => {
    for (const [name, make] of cases) {
      const res = await make();
      if (res.status === 202 || res.status === 204 || name.startsWith("status page")) continue;
      expect(res.headers.get("content-type"), name).toMatch(/^(application\/json|text\/event-stream)/);
    }
  });

  it("does not leak server details", async () => {
    const res = await send("/");
    expect(res.headers.get("server")).toBeNull();
    expect(res.headers.get("x-powered-by")).toBeNull();
  });
});

describe("CORS is off by default", () => {
  it("sends no CORS headers without an Origin", async () => {
    const res = await send("/mcp", modernInit("tools/list"));
    expect([...res.headers.keys()].filter((k) => k.startsWith("access-control"))).toEqual([]);
  });

  it("rejects any browser Origin when no allow-list is set", async () => {
    const res = await send("/mcp", { method: "POST", headers: { ...JSON_HEADERS, origin: ALLOWED }, body: "{}" });
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(((await res.json()) as Json).error.message).toBe("Origin not allowed");
  });

  it("answers a preflight with 405 and no CORS headers when off", async () => {
    const res = await send("/mcp", { method: "OPTIONS", headers: { origin: ALLOWED, "access-control-request-method": "POST" } });
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("OPTIONS without an Origin is a 405", async () => {
    const res = await send("/mcp", { method: "OPTIONS" });
    expect(res.status).toBe(405);
  });

  it.each(["", "   ", ",,,", "*", "null", "https://*.example", "ftp://x.example", "https://x.example/path", "https://x.example/", "not a url"])(
    "ignores the unusable allow-list %j",
    async (value) => {
      const res = await send("/mcp", { method: "POST", headers: { ...JSON_HEADERS, origin: ALLOWED }, body: "{}" }, { CORS_ALLOWED_ORIGINS: value });
      expect(res.status).toBe(403);
    },
  );

  it("ignores a non-string var", async () => {
    const res = await send("/mcp", { method: "POST", headers: { ...JSON_HEADERS, origin: ALLOWED }, body: "{}" }, { CORS_ALLOWED_ORIGINS: 5 as unknown as string });
    expect(res.status).toBe(403);
  });
});

describe("CORS with an explicit allow-list", () => {
  it("answers a preflight for an allowed origin", async () => {
    const res = await send("/mcp", { method: "OPTIONS", headers: { origin: ALLOWED, "access-control-request-method": "POST" } }, env);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    expect(res.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(res.headers.get("access-control-allow-headers")).toMatch(/mcp-protocol-version/);
    expect(res.headers.get("vary")).toBe("Origin");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("adds CORS headers to the real response for an allowed origin only", async () => {
    const init = modernInit("tools/list");
    const ok = await send("/mcp", { ...init, headers: { ...(init.headers as Record<string, string>), origin: ALLOWED } }, env);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    const bad = await send("/mcp", { ...init, headers: { ...(init.headers as Record<string, string>), origin: "https://evil.example" } }, env);
    expect(bad.status).toBe(403);
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("matches origins exactly (no substring or suffix match)", async () => {
    for (const origin of [`${ALLOWED}.evil.example`, `http://app.example`, `https://app.example:8443`, `https://sub.app.example`]) {
      const res = await send("/mcp", { method: "POST", headers: { ...JSON_HEADERS, origin }, body: "{}" }, env);
      expect(res.status, origin).toBe(403);
    }
  });

  it("allows the second listed origin", async () => {
    const res = await send("/mcp", { method: "OPTIONS", headers: { origin: "https://other.example" } }, env);
    expect(res.status).toBe(204);
  });

  it("puts CORS headers on error responses for allowed origins too", async () => {
    const res = await send("/mcp", { method: "POST", headers: { ...JSON_HEADERS, origin: ALLOWED, "content-type": "text/plain" }, body: "x" }, env);
    expect(res.status).toBe(415);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
  });

  it("does not apply the Origin check to the status page or healthz", async () => {
    expect((await send("/", { headers: { origin: "https://evil.example" } })).status).toBe(200);
    expect((await send("/healthz", { headers: { origin: "https://evil.example" } })).status).toBe(200);
    expect(ORIGIN).toMatch(/^https:/);
  });
});
