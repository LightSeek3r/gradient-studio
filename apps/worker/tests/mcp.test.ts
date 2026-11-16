import { describe, expect, it } from "vitest";
import { TOOLS } from "@opal42/mcp/handlers";
import { HOSTED_INSTRUCTIONS } from "../src/worker";
import { JSON_HEADERS, MODERN, RGB_CSS, callTool, modern, postJson, type Json } from "./helpers";

describe("2026-07-28: no initialize", () => {
  it("answers server/discover naming the revision", async () => {
    const { res, body } = await modern("server/discover");
    expect(res.status).toBe(200);
    expect(body.result.supportedVersions).toContain(MODERN);
    expect(body.result.capabilities.tools).toBeTruthy();
  });

  it("describes itself as hosted, not local", async () => {
    const { body } = await modern("server/discover");
    const text: string = body.result.instructions;
    expect(text).toBe(HOSTED_INSTRUCTIONS);
    expect(text).toMatch(/smoothness score/);
    expect(text).toMatch(/not a quality verdict/);
    expect(text).toMatch(/hosted endpoint: requests leave your device/);
    expect(text).toMatch(/Cloudflare, as processor, still sees IP addresses/);
    expect(text).not.toMatch(/stateless and local/);
  });

  it("lists the four tools with read-only annotations", async () => {
    const { res, body } = await modern("tools/list");
    expect(res.status).toBe(200);
    const tools = body.result.tools as { name: string; description: string; inputSchema: unknown; annotations: Record<string, unknown> }[];
    expect(tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
    for (const t of tools) {
      expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
      expect(t.inputSchema).toMatchObject({ type: "object" });
    }
  });

  it("does not describe the hosted tools as local", async () => {
    const { body } = await modern("tools/list");
    for (const t of body.result.tools as { name: string; description: string }[]) {
      expect(t.description, t.name).not.toMatch(/\blocal\b/i);
      expect(t.description, t.name).not.toMatch(/nothing leaves/i);
    }
  });

  it("serves the same schemas as the stdio server", async () => {
    const { body } = await modern("tools/list");
    const def = TOOLS.find((t) => t.name === "score_gradient")!;
    const got = (body.result.tools as Json[]).find((t) => t.name === "score_gradient");
    expect(got.inputSchema).toEqual(JSON.parse(JSON.stringify(def.inputSchema)));
  });
});

describe("tools/call", () => {
  it("score_gradient", async () => {
    const { res, body } = await callTool("score_gradient", { css: RGB_CSS });
    expect(res.status).toBe(200);
    expect(body.result.isError).toBeUndefined();
    expect(body.result.structuredContent.gradients[0].score).toBe(58);
    expect(JSON.parse(body.result.content[0].text).gradients[0].score).toBe(58);
  });

  it("score_gradient with structured stops", async () => {
    const { body } = await callTool("score_gradient", { stops: [{ color: "#1e3a8a" }, { color: "#3b82f6" }, { color: "#bfdbfe" }], angle: 135 });
    expect(body.result.structuredContent.gradients[0].status).toBe("scored");
    expect(body.result.structuredContent.scoringModel).toBe("v1");
  });

  it("refine_gradient", async () => {
    const { body } = await callTool("refine_gradient", { css: RGB_CSS });
    const g = body.result.structuredContent.gradients[0];
    expect(g.refined).toBe(true);
    expect(g.after.score).toBeGreaterThan(g.before.score);
    expect(g.refinedCss).toMatch(/^linear-gradient\(/);
  });

  it("complement", async () => {
    const { body } = await callTool("complement", { color: "tomato" });
    expect(body.result.structuredContent).toEqual({ input: "tomato", color: "#ff6347", complement: "#00b0c9" });
  });

  it("render_preview returns a decodable SVG image block", async () => {
    const { body } = await callTool("render_preview", { stops: [{ color: "#ff0000" }, { color: "#0000ff" }], width: 64, height: 32 });
    const [img, txt] = body.result.content;
    expect(img.type).toBe("image");
    expect(img.mimeType).toBe("image/svg+xml");
    expect(atob(img.data)).toBe(txt.text);
    expect(txt.text).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="64" height="32"/);
  });

  it("render_preview from css with an oklch gradient", async () => {
    const { body } = await callTool("render_preview", { css: "linear-gradient(in oklch, #ff0000, #0000ff)" });
    expect(body.result.structuredContent.interpolation).toBe("oklch");
  });

  it("returns isError results, not protocol errors, for bad arguments", async () => {
    const wrongType = await callTool("score_gradient", { css: 5 });
    expect(wrongType.res.status).toBe(200);
    expect(wrongType.body.result.isError).toBe(true);
    const neither = await callTool("score_gradient", {});
    expect(neither.body.result.isError).toBe(true);
    expect(neither.body.result.content[0].text).toMatch(/give `css`/);
  });

  it("reports an unknown tool without throwing", async () => {
    const { res, body } = await callTool("rm_rf", {});
    expect(res.status).toBeLessThan(500);
    expect(JSON.stringify(body)).toMatch(/unknown|not found/i);
  });

  it("answers a gradient-free css input with a message", async () => {
    const { body } = await callTool("score_gradient", { css: "a{color:red}" });
    expect(body.result.structuredContent.gradientCount).toBe(0);
  });

  it("skips (not guesses) what v1 cannot judge", async () => {
    const { body } = await callTool("score_gradient", { css: "radial-gradient(red, blue)" });
    expect(body.result.structuredContent.gradients[0].status).toBe("skipped");
  });
});

describe("2025 clients (stateless fallback)", () => {
  const init = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "old", version: "1" } },
  };

  it("serves the initialize handshake without a session", async () => {
    const res = await postJson(init);
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeNull();
    const text = await res.text();
    expect(text).toContain('"serverInfo"');
    expect(text).toContain("opal42-mcp");
  });

  it("serves a bare tools/list and tools/call", async () => {
    const list = await (await postJson({ jsonrpc: "2.0", id: 2, method: "tools/list" })).text();
    expect(list).toContain("score_gradient");
    const call = await (
      await postJson({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "complement", arguments: { color: "tomato" } } })
    ).text();
    expect(call).toContain("#00b0c9");
  });

  it("acknowledges notifications with 202", async () => {
    const res = await postJson({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
  });

  it("never issues a session id", async () => {
    for (const m of ["tools/list", "ping"]) {
      const res = await postJson({ jsonrpc: "2.0", id: 9, method: m }, JSON_HEADERS);
      expect(res.headers.get("mcp-session-id")).toBeNull();
    }
  });
});
