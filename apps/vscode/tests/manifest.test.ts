import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, LANGUAGE_IDS } from "../src/analyze";
import { DEFAULT_STUDIO_URL } from "../src/studio";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const props = pkg.contributes.configuration.properties;
const srcFiles = readdirSync(join(root, "src")).filter((f) => f.endsWith(".ts"));
const read = (f: string) => readFileSync(join(root, "src", f), "utf8");

describe("manifest", () => {
  it("activates only on the supported language ids, never on *", () => {
    const events: string[] = pkg.activationEvents;
    expect(events.sort()).toEqual(LANGUAGE_IDS.map((l) => `onLanguage:${l}`).sort());
    expect(events).not.toContain("*");
    expect(events.some((e) => e.startsWith("onStartupFinished"))).toBe(false);
  });

  it("targets VS Code 1.90 and uses no newer types", () => {
    expect(pkg.engines.vscode).toBe("^1.90.0");
    expect(pkg.devDependencies["@types/vscode"]).toBe("1.90.0");
  });

  it("has the working extension id opal42.gradient-score", () => {
    expect(`${pkg.publisher}.${pkg.name}`).toBe("opal42.gradient-score");
  });

  it("is private to the workspace and ships one bundle", () => {
    expect(pkg.private).toBe(true);
    expect(pkg.main).toBe("./dist/extension.js");
    expect(pkg.dependencies).toBeUndefined();
  });

  it("contributes the two documented commands", () => {
    expect(pkg.contributes.commands.map((c: { command: string; category: string; title: string }) => `${c.category}: ${c.title}`)).toEqual([
      "Opal42: Score current file",
      "Opal42: Open in Gradient Studio",
    ]);
  });

  it("gives minScore no default", () => {
    expect(props["opal42.minScore"]).toBeDefined();
    expect("default" in props["opal42.minScore"]).toBe(false);
    expect(DEFAULT_SETTINGS.minScore).toBeUndefined();
  });

  it("matches the documented defaults", () => {
    expect(props["opal42.showSkipped"].default).toBe(false);
    expect(props["opal42.maxFileSizeKB"].default).toBe(500);
    expect(props["opal42.studioUrl"].default).toBe(DEFAULT_STUDIO_URL);
    expect(props["opal42.codeLens.enabled"].default).toBe(true);
    expect(props["opal42.diagnostics.enabled"].default).toBe(true);
  });

  it("keeps every setting under the opal42. prefix", () => {
    for (const key of Object.keys(props)) expect(key.startsWith("opal42.")).toBe(true);
  });

  it("supports untrusted and virtual workspaces (it only reads text)", () => {
    expect(pkg.capabilities.untrustedWorkspaces.supported).toBe(true);
    expect(pkg.capabilities.virtualWorkspaces).toBe(true);
  });

  it("states local-only operation in the description", () => {
    expect(pkg.description).toMatch(/no network, no telemetry/i);
  });
});

describe("source rules", () => {
  it("imports vscode only in extension.ts", () => {
    for (const f of srcFiles) {
      const imports = /from\s+["']vscode["']/.test(read(f));
      expect(imports, f).toBe(f === "extension.ts");
    }
  });

  it("uses no network, process or telemetry API anywhere in src", () => {
    const banned = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|createTelemetryLogger|isTelemetryEnabled|onDidChangeTelemetryEnabled)\b|from\s+["'](node:)?(https?|net|tls|dgram|dns|child_process|worker_threads)["']/;
    for (const f of srcFiles) expect(read(f), f).not.toMatch(banned);
  });

  it("opens an external URL in exactly one place", () => {
    const uses = srcFiles.flatMap((f) => (read(f).match(/openExternal\(/g) ?? []).map(() => f));
    expect(uses).toEqual(["extension.ts"]);
  });

  it("reads no files and writes no files from src", () => {
    for (const f of srcFiles) expect(read(f), f).not.toMatch(/from\s+["'](node:)?fs/);
  });

  it("ships only the allow-listed files", () => {
    const ignore = readFileSync(join(root, ".vscodeignore"), "utf8")
      .split("\n")
      .filter((l) => l && !l.startsWith("#"));
    expect(ignore).toEqual(["**", "!package.json", "!README.md", "!CHANGELOG.md", "!LICENSE", "!images/icon.png", "!dist/extension.js"]);
  });
});
