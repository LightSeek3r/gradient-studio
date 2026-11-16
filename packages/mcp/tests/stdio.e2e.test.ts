import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { TOOLS } from "../src/handlers";
import { RGB_CSS } from "./helpers";
import { built, serverBin, StdioClient } from "./rpc";

// These spawn the built executable; they are skipped before `npm run build`.
describe.skipIf(!built)("stdio server (built executable)", () => {
  const clients: StdioClient[] = [];
  const start = (args: string[] = []) => {
    const c = new StdioClient(args);
    clients.push(c);
    return c;
  };
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close()));
  });

  const T = 20_000;

  it("answers server/discover without any initialize, naming revision 2026-07-28", async () => {
    const res = await start().modern("server/discover");
    expect(res.error).toBeUndefined();
    expect(res.result.supportedVersions).toContain("2026-07-28");
    expect(res.result.capabilities.tools).toBeTruthy();
    expect(res.result.instructions).toMatch(/smoothness score/);
    expect(res.result.instructions).toMatch(/not a quality verdict/);
  }, T);

  it("lists the four tools with their schemas and read-only annotations", async () => {
    const res = await start().modern("tools/list");
    const tools = res.result.tools as { name: string; inputSchema: unknown; outputSchema: unknown; annotations: Record<string, unknown> }[];
    expect(tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
    for (const t of tools) {
      expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
      expect(t.inputSchema).toMatchObject({ type: "object" });
      expect(t.outputSchema).toMatchObject({ type: "object" });
    }
    const def = TOOLS.find((t) => t.name === "score_gradient")!;
    expect(tools.find((t) => t.name === "score_gradient")!.inputSchema).toEqual(JSON.parse(JSON.stringify(def.inputSchema)));
  }, T);

  it("calls score_gradient", async () => {
    const res = await start().callTool("score_gradient", { css: RGB_CSS });
    expect(res.result.isError).toBeUndefined();
    expect(res.result.structuredContent.gradients[0].score).toBe(58);
    expect(JSON.parse(res.result.content[0].text).gradients[0].score).toBe(58);
  }, T);

  it("calls refine_gradient", async () => {
    const res = await start().callTool("refine_gradient", { css: RGB_CSS });
    const g = res.result.structuredContent.gradients[0];
    expect(g.refined).toBe(true);
    expect(g.after.score).toBeGreaterThan(g.before.score);
  }, T);

  it("calls complement", async () => {
    const res = await start().callTool("complement", { color: "tomato" });
    expect(res.result.structuredContent).toEqual({ input: "tomato", color: "#ff6347", complement: "#00b0c9" });
  }, T);

  it("calls render_preview and returns a decodable SVG image block", async () => {
    const res = await start().callTool("render_preview", { stops: [{ color: "#ff0000" }, { color: "#0000ff" }], width: 64, height: 32 });
    const [img, txt] = res.result.content;
    expect(img.type).toBe("image");
    expect(img.mimeType).toBe("image/svg+xml");
    expect(Buffer.from(img.data, "base64").toString("utf8")).toBe(txt.text);
    expect(txt.text).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="64" height="32"/);
    expect(res.result.structuredContent.mimeType).toBe("image/svg+xml");
  }, T);

  it("returns isError results, not protocol errors, for bad arguments", async () => {
    const c = start();
    const wrongType = await c.callTool("score_gradient", { css: 5 });
    expect(wrongType.error).toBeUndefined();
    expect(wrongType.result.isError).toBe(true);
    const neither = await c.callTool("score_gradient", {});
    expect(neither.result.isError).toBe(true);
    expect(neither.result.content[0].text).toMatch(/give `css`/);
    const injection = await c.callTool("render_preview", { css: "linear-gradient(red, blue)", width: '480"><script>' });
    expect(injection.result.isError).toBe(true);
    const unknownProp = await c.callTool("complement", { color: "red", extra: true });
    expect(unknownProp.result.isError).toBe(true);
  }, T);

  it("rejects an unknown tool with an invalid-params error", async () => {
    const res = await start().callTool("does_not_exist", {});
    expect(res.error.code).toBe(-32602);
  }, T);

  it("still serves the older initialize handshake", async () => {
    const c = start();
    const init = await c.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "legacy", version: "1" } });
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.serverInfo.name).toBe("opal42-mcp");
    c.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    const list = await c.request("tools/list");
    expect(list.result.tools).toHaveLength(4);
    const call = await c.request("tools/call", { name: "complement", arguments: { color: "red" } });
    expect(call.result.structuredContent.complement).toMatch(/^#[0-9a-f]{6}$/);
  }, T);

  it("answers a bare tools/list with no handshake and no metadata", async () => {
    const res = await start().request("tools/list");
    expect(res.result.tools).toHaveLength(4);
  }, T);

  it("handles a 20,000-character css argument", async () => {
    const css = " ".repeat(20_000 - RGB_CSS.length) + RGB_CSS;
    const res = await start().callTool("score_gradient", { css });
    expect(res.result.structuredContent.gradientCount).toBe(1);
  }, T);

  it("answers many concurrent requests correctly by id", async () => {
    const c = start();
    const colors = ["red", "#00ff00", "blue", "gold", "tomato", "navy", "teal", "plum", "salmon", "orchid"];
    const answers = await Promise.all(colors.map((color) => c.callTool("complement", { color })));
    answers.forEach((a, i) => expect(a.result.structuredContent.input).toBe(colors[i]));
  }, T);

  it("is stateless: two processes and repeated calls give identical results", async () => {
    const a = start();
    const b = start();
    const [r1, r2, r3] = await Promise.all([
      a.callTool("refine_gradient", { css: RGB_CSS }),
      b.callTool("refine_gradient", { css: RGB_CSS }),
      a.callTool("refine_gradient", { css: RGB_CSS }),
    ]);
    const strip = (m: { result: { _meta?: unknown } }) => JSON.stringify({ ...m.result, _meta: undefined });
    expect(strip(r1)).toBe(strip(r2));
    expect(strip(r1)).toBe(strip(r3));
  }, T);

  it("survives a malformed line and keeps answering", async () => {
    const c = start();
    c.sendRaw("this is not json\n");
    const res = await c.callTool("complement", { color: "red" });
    expect(res.result.structuredContent.color).toBe("#ff0000");
  }, T);

  it("writes only JSON-RPC to stdout and nothing to stderr during normal use", async () => {
    const c = start();
    await c.callTool("score_gradient", { css: RGB_CSS });
    await c.callTool("render_preview", { css: RGB_CSS });
    await c.callTool("score_gradient", { css: 5 });
    expect(c.lines.length).toBeGreaterThanOrEqual(3);
    for (const line of c.lines) expect(JSON.parse(line).jsonrpc).toBe("2.0");
    expect(c.stderr.join("")).toBe("");
  }, T);

  it("exits by itself when stdin is closed", async () => {
    const c = start();
    await c.modern("server/discover");
    c.child.stdin.end();
    const code = await Promise.race([c.exited, new Promise<string>((r) => setTimeout(() => r("hung"), 8000))]);
    expect(code).toBe(0);
  }, T);
});

describe.skipIf(!built)("command line (built executable)", () => {
  const run = (args: string[]) => spawnSync(process.execPath, [serverBin, ...args], { encoding: "utf8", timeout: 10_000, input: "" });

  it("--version prints the package version", () => {
    const r = run(["--version"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("--help describes the tools and the privacy stance", () => {
    const r = run(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/score_gradient, refine_gradient, complement, render_preview/);
    expect(r.stdout).toMatch(/no network/);
  });

  it("exits 2 on an unknown argument", () => {
    const r = run(["--bogus"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/unknown argument/);
  });
});
