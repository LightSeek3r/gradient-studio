// Zero network, zero telemetry, no remote or dynamic code: checked statically on
// the extension's own source. (The built bundles contain React, whose strings
// mention URLs; the built manifest's permissions and CSP are checked in
// manifest.test.ts, and e2e/ loads the real build under that CSP.)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else if (/\.(ts|tsx|html|css)$/.test(name)) out.push(path);
  }
  return out;
}

/** Comments may describe what the code does not do; only code is checked. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

const sources = files(join(root, "src")).map((path) => ({ path: relative(root, path), text: stripComments(readFileSync(path, "utf8")) }));
const code = sources.filter((s) => /\.(ts|tsx)$/.test(s.path));

describe("extension source: no network, no telemetry, no remote or dynamic code", () => {
  it("has sources to check", () => {
    expect(sources.length).toBeGreaterThan(15);
  });

  it.each([
    ["fetch", /\bfetch\s*\(/],
    ["XMLHttpRequest", /XMLHttpRequest/],
    ["WebSocket", /\bWebSocket\b/],
    ["EventSource", /\bEventSource\b/],
    ["sendBeacon", /sendBeacon/],
    ["importScripts", /importScripts/],
    ["dynamic import()", /\bimport\s*\(/],
    ["new Function", /new\s+Function\b/],
    ["eval()", /(^|[^.\w])eval\s*\(/],
    ["setTimeout with a string", /setTimeout\s*\(\s*["'`]/],
    ["innerHTML", /\.(inner|outer)HTML\s*=/],
    ["dangerouslySetInnerHTML", /dangerouslySetInnerHTML/],
    ["document.write", /document\.write/],
    ["chrome.tabs / runtime messaging", /chrome\.(tabs|runtime|storage|scripting|webRequest|cookies|history|downloads)\b/],
    ["browser.* extension APIs", /\bbrowser\.(tabs|runtime|storage|scripting)\b/],
  ])("does not use %s", (_name, re) => {
    for (const s of code) {
      // The one wrapper around inspectedWindow.eval declares an `eval` method in its API type.
      if (s.path === "src/lib/devtools-api.ts" && _name === "eval()") continue;
      expect(s.text, `${s.path}: ${re}`).not.toMatch(re);
    }
  });

  it("only uses eval through chrome.devtools.inspectedWindow (the one place page code is evaluated)", () => {
    const users = code.filter((s) => /\beval\s*\(/.test(s.text)).map((s) => s.path);
    expect(users).toEqual(["src/lib/devtools-api.ts"]);
  });

  it("loads no remote resources: no http(s) URL in HTML or CSS, and none in code except the studio default", () => {
    for (const s of sources.filter((x) => /\.(html|css)$/.test(x.path))) expect(s.text, s.path).not.toMatch(/https?:\/\//);
    const allowed = [/gradient-studio-al4\.pages\.dev/];
    for (const s of code) {
      for (const m of s.text.matchAll(/https?:\/\/[^\s"'`)]+/g)) {
        const url = m[0];
        const ok = allowed.some((re) => re.test(url)) || /^https?:\/\/(example\.|localhost|127\.0\.0\.1)/.test(url);
        expect(ok, `${s.path}: ${url}`).toBe(true);
      }
    }
  });

  it("html entry pages load only their own module script", () => {
    for (const s of sources.filter((x) => x.path.endsWith(".html"))) {
      const scripts = [...s.text.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
      expect(scripts.length, s.path).toBe(1);
      expect(scripts[0], s.path).toMatch(/type="module"/);
      expect(scripts[0], s.path).toMatch(/src="\.\/main\.tsx?"/);
      expect(s.text, s.path).not.toMatch(/<(link|img|iframe|object|embed)\b/i);
      expect(s.text, s.path).not.toMatch(/\son[a-z]+=/i);
    }
  });
});
