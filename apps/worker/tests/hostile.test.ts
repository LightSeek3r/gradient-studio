import { describe, expect, it } from "vitest";
import { MAX_BODY_BYTES } from "../src/limits";
import { JSON_HEADERS, MODERN, callTool, modernInit, postJson, postRaw, send, type Json } from "./helpers";

/** No response may carry request content beyond a short, escaped snippet. */
const SENTINEL = "ZQX-SENTINEL-8841";

describe("malformed requests are JSON-RPC errors, never exceptions", () => {
  it("invalid JSON is a 400 parse error with a fixed message", async () => {
    const res = await postRaw(`{"jsonrpc":"2.0","id":1,"method":"${SENTINEL}`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as Json;
    expect(body).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  });

  it.each(["", " ", "{", "}", "[", "null", "true", "0", '"x"', "\u0000", "<xml/>", "{'a':1}"])("body %j", async (b) => {
    const res = await postRaw(b);
    expect(res.status).toBe(400);
    expect(((await res.json()) as Json).error.code).toBeLessThan(0);
  });

  it("a missing body is a parse error", async () => {
    const res = await postRaw(null);
    expect(res.status).toBe(400);
  });

  it("rejects batches", async () => {
    const res = await postJson([{ jsonrpc: "2.0", id: 1, method: "tools/list" }]);
    expect(res.status).toBe(400);
    expect(((await res.json()) as Json).error.message).toMatch(/Batch/);
  });

  it("rejects an empty batch and a batch of junk", async () => {
    expect((await postJson([])).status).toBe(400);
    expect((await postJson([1, 2, 3])).status).toBe(400);
  });

  it.each([
    [{}],
    [{ jsonrpc: "1.0", id: 1, method: "tools/list" }],
    [{ jsonrpc: "2.0", id: 1 }],
    [{ jsonrpc: "2.0", id: 1, method: 5 }],
    [{ jsonrpc: "2.0", id: 1, result: {} }],
  ])("rejects %j as an invalid request", async (v) => {
    const res = await postJson(v);
    expect(res.status).toBe(400);
    expect(((await res.json()) as Json).error.code).toBe(-32600);
  });

  it("rejects a wrong content type with 415", async () => {
    for (const ct of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", ""]) {
      const res = await postRaw('{"jsonrpc":"2.0","id":1,"method":"tools/list"}', { ...(ct ? { "content-type": ct } : {}), accept: "application/json, text/event-stream" });
      expect(res.status, ct).toBe(415);
    }
  });

  it("accepts a content type with parameters and different case", async () => {
    const res = await postJson({ jsonrpc: "2.0", id: 1, method: "ping" }, { ...JSON_HEADERS, "content-type": "Application/JSON; charset=utf-8" });
    expect(res.status).toBe(200);
  });

  it("rejects compressed request bodies", async () => {
    const res = await postRaw("{}", { ...JSON_HEADERS, "content-encoding": "gzip" });
    expect(res.status).toBe(415);
  });

  it("rejects invalid UTF-8", async () => {
    const res = await postRaw(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]));
    expect(res.status).toBe(400);
  });

  it.each(["GET", "DELETE", "PUT", "PATCH"])("%s /mcp is a 405 with Allow", async (method) => {
    const res = await send("/mcp", { method });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST, OPTIONS");
    expect(((await res.json()) as Json).error.code).toBe(-32000);
  });

  it("handles deeply nested JSON without throwing", async () => {
    const deep = "[".repeat(5000) + "]".repeat(5000);
    const res = await postRaw(deep);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("handles prototype-pollution keys as plain data", async () => {
    const res = await postRaw('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"complement","arguments":{"__proto__":{"x":1},"color":"red"}}}');
    expect(res.status).toBeLessThan(500);
    expect(({} as Json).x).toBeUndefined();
  });
});

describe("size cap", () => {
  const pad = (n: number) => JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "complement", arguments: { color: "x".repeat(n) } } });

  it("rejects a body over the cap with 413 (declared length)", async () => {
    const body = pad(MAX_BODY_BYTES + 10);
    const res = await postRaw(body, { ...JSON_HEADERS, "content-length": String(new TextEncoder().encode(body).length) });
    expect(res.status).toBe(413);
    expect(((await res.json()) as Json).error.message).toContain(String(MAX_BODY_BYTES));
  });

  it("rejects an oversized streamed body without a length", async () => {
    const chunk = new TextEncoder().encode("a".repeat(8192));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent > 20) return c.close();
        sent++;
        c.enqueue(chunk);
      },
    });
    const res = await send("/mcp", { method: "POST", headers: JSON_HEADERS, body: stream, duplex: "half" } as RequestInit);
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(10); // stopped reading at the cap, did not drain the stream
  });

  it("accepts a body just under the cap (and lets the tool's own cap answer)", async () => {
    const body = pad(MAX_BODY_BYTES - 400);
    expect(new TextEncoder().encode(body).length).toBeLessThan(MAX_BODY_BYTES);
    const res = await postRaw(body);
    expect(res.status).toBe(200);
  });

  it("measures bytes, not characters", async () => {
    const body = pad(0).replace('"color":""', `"color":"${"é".repeat(MAX_BODY_BYTES / 2)}"`);
    const res = await postRaw(body);
    expect(res.status).toBe(413);
  });

  it("applies the tool's own css cap below the body cap", async () => {
    const css = `linear-gradient(red, blue) /*${"x".repeat(20_001)}*/`;
    const { res, body } = await callTool("score_gradient", { css });
    expect(res.status).toBe(200);
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/20000 characters/);
  });

  it("caps the number of stops", async () => {
    const stops = Array.from({ length: 33 }, (_, i) => ({ color: `#${(i * 7).toString(16).padStart(2, "0")}0000` }));
    const { body } = await callTool("score_gradient", { stops });
    expect(body.result.isError).toBe(true);
  });

  it("scores at most 32 gradients from a large css input and counts the rest", async () => {
    const css = Array.from({ length: 60 }, () => "a{background:linear-gradient(red,blue)}").join("\n");
    const { body } = await callTool("score_gradient", { css });
    expect(body.result.structuredContent.gradients).toHaveLength(32);
    expect(body.result.structuredContent.gradientsNotExamined).toBe(28);
  });
});

describe("hostile SVG inputs for render_preview", () => {
  const SAFE = /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="\d+" viewBox="0 0 \d+ \d+" role="img" aria-label="Gradient preview"><defs><linearGradient id="g"(?: [a-zA-Z0-9]+="[^<>"]*")*>(?:<stop [^<>]*\/>)+<\/linearGradient><\/defs><rect [^<>]*\/><\/svg>$/;
  const noRawMarkup = (v: unknown) => {
    const t = JSON.stringify(v);
    expect(t).not.toMatch(/<[a-zA-Z/!?]/); // a validator message like "<= 2048" is fine; markup is not
  };

  const hostile = [
    '"><script>alert(1)</script>',
    '#ff0000" onload="alert(1)',
    "red;}</style><script>x</script>",
    "url(javascript:alert(1))",
    "<svg onload=alert(1)>",
    "&lt;img src=x onerror=alert(1)&gt;",
    "\u0000\u001f#ff0000",
    "#ff0000</stop><script>",
  ];

  it.each(hostile)("colour %j never reaches the SVG", async (color) => {
    const { res, body } = await callTool("render_preview", { stops: [{ color }, { color: "#0000ff" }] });
    expect(res.status).toBe(200);
    expect(body.result.isError).toBe(true);
    noRawMarkup(body); // quoted input is escaped (\u003c), never raw markup
    expect(body.result.content.some((c: Json) => c.type === "image")).toBe(false);
  });

  it.each(hostile)("css %j never reaches the SVG", async (frag) => {
    const { body } = await callTool("render_preview", { css: `linear-gradient(90deg, ${frag}, #0000ff)` });
    if (body.result.isError) noRawMarkup(body);
    else expect(body.result.content[1].text).toMatch(SAFE);
  });

  it("rejects hostile width, height, angle and interpolation values", async () => {
    for (const args of [
      { width: '480"><script>', height: 10 },
      { width: 480, height: "100%" },
      { width: 1e9, height: 100 },
      { angle: "90deg\"><script>" },
      { interpolation: "oklab\"><script>" },
      { width: -1, height: 100 },
    ]) {
      const { body } = await callTool("render_preview", { stops: [{ color: "red" }, { color: "blue" }], ...args });
      expect(body.result.isError, JSON.stringify(args)).toBe(true);
      noRawMarkup(body);
    }
  });

  it("a valid preview matches the fixed template", async () => {
    const { body } = await callTool("render_preview", { stops: [{ color: "red" }, { color: "#00f", position: 60 }], angle: 45, width: 100, height: 50 });
    expect(body.result.content[1].text).toMatch(SAFE);
    expect(body.result.content[1].text).not.toMatch(/<title|<text|<script|<foreignObject|href=/);
  });
});

describe("request content is not echoed beyond a safe snippet", () => {
  const MAX_ECHO = 450;

  it("an invalid colour in complement is quoted, escaped and truncated", async () => {
    const evil = `<img src=x onerror=alert(1)>${SENTINEL}${"y".repeat(500)}`;
    const { body } = await callTool("complement", { color: evil });
    const text = JSON.stringify(body);
    expect(body.result.isError).toBe(true);
    expect(text).not.toContain("<img");
    expect(text).not.toContain("y".repeat(100));
  });

  it("an unknown tool name is escaped and truncated", async () => {
    const res = await postJson({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: `<b>${"n".repeat(300)}`, arguments: {} } });
    const text = await res.text();
    expect(text).not.toContain("<b>");
    expect(text).not.toContain("n".repeat(200));
  });

  it("parse errors never contain the body", async () => {
    const res = await postRaw(`{"secret":"${SENTINEL}",`);
    expect(await res.text()).not.toContain(SENTINEL);
  });

  it("protocol errors do not echo an unknown method", async () => {
    const res = await postJson({ jsonrpc: "2.0", id: 1, method: `no/${SENTINEL}${"m".repeat(500)}` });
    const text = await res.text();
    expect(text.length).toBeLessThan(MAX_ECHO * 3);
    expect(text).not.toContain("m".repeat(200));
  });

  it("a hostile _meta protocol version is not reflected in full", async () => {
    const evil = `<script>${SENTINEL}${"v".repeat(400)}</script>`;
    const res = await send("/mcp", {
      method: "POST",
      headers: { ...JSON_HEADERS, "mcp-protocol-version": evil.slice(0, 20).replace(/[<>]/g, "") },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": evil } } }),
    });
    const text = await res.text();
    expect(text).not.toContain("<script>");
    expect(text).not.toContain("v".repeat(100));
  });

  it("hostile css is not echoed back raw", async () => {
    const css = `a{background:linear-gradient(red, blue)} /* <script>${SENTINEL}</script> */`;
    const { body } = await callTool("score_gradient", { css });
    const text = JSON.stringify(body);
    expect(text).not.toContain("<script>");
  });

  it("an overlong gradient excerpt is cut", async () => {
    const stops = Array.from({ length: 30 }, (_, i) => `#${(i * 8).toString(16).padStart(2, "0")}${(i * 5).toString(16).padStart(2, "0")}ff`).join(", ");
    const { body } = await callTool("score_gradient", { css: `linear-gradient(90deg, ${stops})` });
    expect(body.result.structuredContent.gradients[0].css.length).toBeLessThanOrEqual(405);
  });

  it("modern request with a bad version header is a 400 JSON-RPC error", async () => {
    const init = modernInit("tools/list");
    (init.headers as Record<string, string>)["mcp-protocol-version"] = "1999-01-01";
    const res = await send("/mcp", init);
    expect(res.status).toBe(400);
    const body = (await res.json()) as Json;
    expect(body.jsonrpc).toBe("2.0");
    expect(MODERN).toBe("2026-07-28");
  });
});
