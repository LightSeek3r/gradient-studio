import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TOOLS } from "../src/handlers";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const server = JSON.parse(readFileSync(join(root, "server.json"), "utf8"));

describe("package metadata", () => {
  it("stays private (nothing is published by this repository yet)", () => {
    expect(pkg.private).toBe(true);
  });

  it("is ESM with the opal42-mcp bin and a handlers export free of the SDK", () => {
    expect(pkg.type).toBe("module");
    expect(pkg.bin).toEqual({ "opal42-mcp": "./dist/cli.js" });
    expect(pkg.exports["./handlers"]).toBeTruthy();
    const handlerSources = ["handlers", "input", "schemas", "svg", "validate", "limits"].map((f) => readFileSync(join(root, "src", `${f}.ts`), "utf8")).join("\n");
    expect(handlerSources).not.toMatch(/@modelcontextprotocol|from "node:|process\.|require\(/);
  });

  it("does no network, filesystem writes or telemetry anywhere in src", () => {
    const files = ["handlers", "input", "schemas", "svg", "validate", "limits", "server", "index", "cli"];
    const all = files.map((f) => readFileSync(join(root, "src", `${f}.ts`), "utf8")).join("\n");
    expect(all).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|node:(http|https|net|dgram|dns|child_process)|writeFile|appendFile|createWriteStream|mkdir|navigator\.sendBeacon/);
  });

  it("has a server.json draft that matches the package and is marked DRAFT", () => {
    expect(server.$schema).toBe("https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json");
    expect(server.description).toMatch(/^DRAFT/);
    expect(server.description.length).toBeLessThanOrEqual(100);
    expect(server.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
    expect(server.packages[0]).toMatchObject({ registryType: "npm", identifier: pkg.name, transport: { type: "stdio" } });
    expect(server.repository.subfolder).toBe("packages/mcp");
    expect(JSON.stringify(server._meta)).toMatch(/DRAFT/);
  });

  it("depends on the official SDK and the core only", () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["@modelcontextprotocol/server", "@opal42/gradient"]);
  });

  it("documents each tool in docs/mcp.md", () => {
    const doc = readFileSync(join(root, "..", "..", "docs", "mcp.md"), "utf8");
    for (const t of TOOLS) expect(doc).toContain(`\`${t.name}\``);
  });
});
