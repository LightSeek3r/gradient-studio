import { describe, expect, it } from "vitest";
import { send } from "./helpers";

describe("GET /", () => {
  it("serves an HTML status page", async () => {
    const res = await send("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    const html = await res.text();
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain("POST /mcp");
  });

  it("states the D4 privacy wording", async () => {
    const html = await (await send("/")).text();
    expect(html).toContain("Stateless: no storage, no request-body logging, no cookies.");
    expect(html).toContain("Cloudflare, as processor, still sees IP addresses (personal data under the GDPR)");
  });

  it("never claims that nothing leaves the device", async () => {
    const html = await (await send("/")).text();
    expect(html).not.toMatch(/nothing leaves your device/i);
    expect(html).toMatch(/your requests do leave your device/i);
  });

  it("lists the four tools", async () => {
    const html = await (await send("/")).text();
    for (const t of ["score_gradient", "refine_gradient", "complement", "render_preview"]) expect(html).toContain(`<code>${t}</code>`);
  });

  it("reflects nothing from the request", async () => {
    const res = await send("/?x=%3Cscript%3Ealert(1)%3C/script%3E", { headers: { "user-agent": "<b>ua</b>", referer: "https://evil.example/<i>" } });
    const html = await res.text();
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("<b>ua</b>");
    expect(html).not.toContain("evil.example");
  });

  it("answers HEAD without a body", async () => {
    const res = await send("/", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("rejects other methods with 405 and Allow", async () => {
    const res = await send("/", { method: "POST", body: "x" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  });
});

describe("GET /healthz", () => {
  it("returns ok", async () => {
    const res = await send("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("answers HEAD and refuses POST", async () => {
    expect((await send("/healthz", { method: "HEAD" })).status).toBe(200);
    expect((await send("/healthz", { method: "POST", body: "{}" })).status).toBe(405);
  });
});

describe("no REST product (PLAN D4)", () => {
  it.each(["/v1/score", "/v1/refine", "/score", "/api/score", "/openapi.json", "/sse", "/.well-known/anything", "/mcp/extra", "//mcp"])(
    "%s is a 404",
    async (path) => {
      const res = await send(path, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: number } };
      expect(body.error.code).toBe(-32600);
    },
  );

  it("treats /mcp/ like /mcp", async () => {
    const res = await send("/mcp/", { method: "GET" });
    expect(res.status).toBe(405);
  });
});
