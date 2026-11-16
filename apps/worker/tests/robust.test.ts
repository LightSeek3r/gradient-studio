import { afterEach, describe, expect, it, vi } from "vitest";
import { REQUEST_TIMEOUT_MS } from "../src/limits";
import worker, { handleRequest } from "../src/worker";
import { JSON_HEADERS, RGB_CSS, callTool, modernInit, postJson, req, send, type Json } from "./helpers";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("never throws", () => {
  it("answers a body stream that errors", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error(`boom with request content <script>`);
      },
    });
    const res = await send("/mcp", { method: "POST", headers: JSON_HEADERS, body: stream, duplex: "half" } as RequestInit);
    expect(res.status).toBeGreaterThanOrEqual(400);
    const text = await res.text();
    expect(text).not.toContain("boom");
    expect(text).not.toContain("<script>");
  });

  it("times out a request whose body never arrives, with a JSON-RPC error", async () => {
    vi.useFakeTimers();
    const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => undefined) });
    const pending = handleRequest(req("/mcp", { method: "POST", headers: JSON_HEADERS, body: stream, duplex: "half" } as RequestInit));
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 10);
    const res = await pending;
    expect(res.status).toBe(504);
    expect(((await res.json()) as Json).error.code).toBe(-32603);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("turns an unexpected internal failure into a generic 500", async () => {
    const hostile = {
      get url(): string {
        throw new Error("secret internal detail");
      },
      method: "GET",
      headers: new Headers(),
    } as unknown as Request;
    const res = await handleRequest(hostile);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain("Internal error");
    expect(text).not.toContain("secret");
  });

  it("the default export is a fetch handler that survives a missing env", async () => {
    const res = await worker.fetch(req("/healthz"), undefined as never);
    expect(res.status).toBe(200);
  });

  it("clears its timer when the request finishes", async () => {
    vi.useFakeTimers();
    const res = await handleRequest(req("/healthz"));
    expect(res.status).toBe(200);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not write to the console (no request content in logs)", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    await postJson({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "complement", arguments: { color: "<secret>" } } });
    await send("/mcp", { method: "POST", headers: JSON_HEADERS, body: "{<secret>" });
    await callTool("score_gradient", { css: RGB_CSS });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});

describe("pre-checks of echoed fields", () => {
  it("rejects an overlong string id", async () => {
    const res = await postJson({ jsonrpc: "2.0", id: "i".repeat(5000), method: "tools/list" });
    expect(res.status).toBe(400);
    expect((await res.text()).length).toBeLessThan(300);
  });

  it.each([null, true, { a: 1 }, [1], Infinity])("rejects the id %j", async (id) => {
    const res = await postJson({ jsonrpc: "2.0", id, method: "tools/list" });
    expect(res.status).toBe(400);
  });

  it("rejects an overlong method", async () => {
    const res = await postJson({ jsonrpc: "2.0", id: 1, method: "m".repeat(500) });
    expect(res.status).toBe(400);
  });

  it("answers an unknown tool with a fixed, short message that lists the tools", async () => {
    const res = await postJson({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "x".repeat(2000), arguments: {} } });
    const body = (await res.json()) as Json;
    expect(body.id).toBe(7);
    expect(body.error.code).toBe(-32602);
    expect(body.error.message).toMatch(/^Unknown tool; available: score_gradient, refine_gradient, complement, render_preview$/);
  });

  it.each([undefined, 5, null, ["complement"], {}])("answers a tool name of %j with the same error", async (name) => {
    const res = await postJson({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } });
    expect(((await res.json()) as Json).error.code).toBe(-32602);
  });

  it("does not let tools/call reach inherited properties", async () => {
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      const res = await postJson({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } });
      expect(((await res.json()) as Json).error.code, name).toBe(-32602);
    }
  });
});

describe("determinism and statelessness", () => {
  it("returns byte-identical bodies for identical requests", async () => {
    for (const [name, args] of [
      ["score_gradient", { css: RGB_CSS }],
      ["refine_gradient", { css: RGB_CSS }],
      ["complement", { color: "tomato" }],
      ["render_preview", { stops: [{ color: "#f00" }, { color: "#00f" }] }],
    ] as const) {
      const a = await (await send("/mcp", modernInit("tools/call", { name, arguments: args }))).text();
      const b = await (await send("/mcp", modernInit("tools/call", { name, arguments: args }))).text();
      expect(b, name).toBe(a);
    }
  });

  it("is unaffected by other requests in between", async () => {
    const init = () => modernInit("tools/call", { name: "score_gradient", arguments: { css: RGB_CSS } });
    const before = await (await send("/mcp", init())).text();
    await callTool("refine_gradient", { css: "linear-gradient(red, lime, blue)" });
    await callTool("complement", { color: "#123456" });
    await send("/mcp", { method: "POST", headers: JSON_HEADERS, body: "garbage" });
    expect(await (await send("/mcp", init())).text()).toBe(before);
  });

  it("gives concurrent requests independent answers", async () => {
    const colours = ["red", "lime", "blue", "tomato", "#336699", "hsl(200 50% 50%)"];
    const results = await Promise.all(colours.map((c) => callTool("complement", { color: c })));
    const again = await Promise.all(colours.map((c) => callTool("complement", { color: c })));
    expect(results.map((r) => r.body.result.structuredContent)).toEqual(again.map((r) => r.body.result.structuredContent));
    expect(new Set(results.map((r) => r.body.result.structuredContent.complement)).size).toBe(colours.length);
  });

  it("issues no session id and ignores a supplied one", async () => {
    const init = modernInit("tools/list", {}, 1, { "mcp-session-id": "abc" });
    const res = await send("/mcp", init);
    expect(res.headers.get("mcp-session-id")).toBeNull();
    expect(res.status).toBeLessThan(500);
  });
});
