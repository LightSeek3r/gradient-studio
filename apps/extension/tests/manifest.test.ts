// The permission gate. Two parts:
//   1. checkManifest/checkFiles are exercised on synthetic manifests: adding any
//      permission, host permission, content script, background script, remote
//      CSP source, new top-level key or stray file MUST produce a problem.
//   2. A real production build of both targets (WXT, into a temp directory) is
//      read back and diffed against tests/permissions-allowlist.json.
// A build that asks for anything not on the allow-list fails here, in `npm test`.

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "wxt";
import { checkFiles, checkManifest, type Allowlist } from "../scripts/manifest-check";
import { buildManifest, CSP, GECKO_ID } from "../manifest";

const root = fileURLToPath(new URL("..", import.meta.url));
const allow = JSON.parse(readFileSync(join(root, "tests/permissions-allowlist.json"), "utf8")) as Allowlist;

function listFiles(base: string, dir = base, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) listFiles(base, path, out);
    else out.push(relative(base, path).split("\\").join("/"));
  }
  return out;
}

const good = (): Record<string, unknown> => ({
  manifest_version: 3,
  name: "x",
  version: "1.0.0",
  description: "d",
  icons: { "16": "icon/16.png" },
  minimum_chrome_version: "111",
  content_security_policy: { extension_pages: CSP },
  devtools_page: "devtools.html",
});
const firefoxGood = (): Record<string, unknown> => {
  const m = good();
  delete m.minimum_chrome_version;
  m.browser_specific_settings = { gecko: allow.firefox.gecko };
  return m;
};

describe("checkManifest (synthetic manifests)", () => {
  it("accepts the expected Chrome and Firefox manifests", () => {
    expect(checkManifest(good(), allow, "chrome")).toEqual([]);
    expect(checkManifest(firefoxGood(), allow, "firefox")).toEqual([]);
  });

  it.each(["tabs", "activeTab", "storage", "scripting", "clipboardWrite", "webRequest", "cookies", "history", "downloads", "sidePanel", "contextMenus", "unlimitedStorage", "declarativeNetRequest", "debugger"])(
    "fails when permission %s is added",
    (permission) => {
      expect(checkManifest({ ...good(), permissions: [permission] }, allow, "chrome").join("\n")).toContain(`"${permission}"`);
    },
  );

  it("fails on host permissions of any kind", () => {
    for (const hp of [["<all_urls>"], ["*://*/*"], ["https://example.com/*"], ["http://localhost/*"]]) {
      expect(checkManifest({ ...good(), host_permissions: hp }, allow, "chrome").length, String(hp)).toBeGreaterThan(0);
    }
  });

  it("fails on optional permissions and optional host permissions", () => {
    expect(checkManifest({ ...good(), optional_permissions: ["tabs"] }, allow, "chrome").length).toBeGreaterThan(0);
    expect(checkManifest({ ...good(), optional_host_permissions: ["<all_urls>"] }, allow, "chrome").length).toBeGreaterThan(0);
  });

  it.each([
    ["content_scripts", [{ matches: ["<all_urls>"], js: ["c.js"] }]],
    ["background", { service_worker: "b.js" }],
    ["web_accessible_resources", [{ resources: ["*"], matches: ["<all_urls>"] }]],
    ["externally_connectable", { matches: ["*://*/*"] }],
    ["action", { default_popup: "popup.html" }],
    ["side_panel", { default_path: "p.html" }],
    ["commands", {}],
    ["options_ui", { page: "o.html" }],
    ["chrome_url_overrides", { newtab: "n.html" }],
    ["sandbox", { pages: [] }],
    ["oauth2", {}],
    ["key", "abc"],
    ["update_url", "https://example.com/u.xml"],
    ["permissions_policy", {}],
  ])("fails on the top-level key %s", (key, value) => {
    expect(checkManifest({ ...good(), [key]: value }, allow, "chrome").join("\n")).toContain(`"${key}"`);
  });

  it("fails when the CSP loosens", () => {
    const withCsp = (extension_pages: string) => checkManifest({ ...good(), content_security_policy: { extension_pages } }, allow, "chrome");
    expect(withCsp(CSP.replace("connect-src 'none'", "connect-src https://x.example")).length).toBeGreaterThan(0);
    expect(withCsp(CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'")).length).toBeGreaterThan(0);
    expect(withCsp(CSP.replace("script-src 'self'", "script-src 'self' https://cdn.example")).length).toBeGreaterThan(0);
    expect(withCsp("script-src 'self'").length).toBeGreaterThan(0);
    expect(checkManifest({ ...good(), content_security_policy: {} }, allow, "chrome").length).toBeGreaterThan(0);
  });

  it("fails on another manifest version", () => {
    expect(checkManifest({ ...good(), manifest_version: 2 }, allow, "chrome").length).toBeGreaterThan(0);
  });

  it("requires Firefox data collection 'none' and the exact gecko block", () => {
    const m = firefoxGood();
    expect(checkManifest({ ...m, browser_specific_settings: { gecko: { ...allow.firefox.gecko, data_collection_permissions: { required: ["browsingActivity"] } } } }, allow, "firefox").length).toBeGreaterThan(0);
    expect(checkManifest({ ...m, browser_specific_settings: { gecko: { ...allow.firefox.gecko, data_collection_permissions: { required: ["none"], optional: ["technicalAndInteraction"] } } } }, allow, "firefox").length).toBeGreaterThan(0);
    expect(checkManifest({ ...m, browser_specific_settings: { gecko: { id: "x@y" } } }, allow, "firefox").length).toBeGreaterThan(0);
    expect(checkManifest(good(), allow, "firefox").length).toBeGreaterThan(0);
  });

  it("keeps browser_specific_settings out of the Chrome build", () => {
    expect(checkManifest({ ...good(), browser_specific_settings: { gecko: allow.firefox.gecko } }, allow, "chrome").length).toBeGreaterThan(0);
  });

  it("flags a permission that is not an array", () => {
    expect(checkManifest({ ...good(), permissions: "tabs" }, allow, "chrome").length).toBeGreaterThan(0);
  });
});

describe("checkFiles (synthetic file lists)", () => {
  const ok = ["manifest.json", "devtools.html", "panel.html", "icon/16.png", "icon/128.png", "chunks/panel-Bid8DfUt.js", "chunks/modulepreload-polyfill-B5Qt9EMX.js", "assets/panel-DqvT8Obi.css"];

  it("accepts the expected file set", () => {
    expect(checkFiles(ok, allow)).toEqual([]);
  });

  it.each(["background.js", "content-scripts/content.js", "chunks/panel.js.map", "popup.html", "options.html", "sidepanel.html", "remote.js", "icon/logo.svg", "wxt-dev-reload.js", "chunks/sub/dir.js"])("flags %s", (file) => {
    expect(checkFiles([...ok, file], allow)).toEqual([`unexpected file in the build: ${file}`]);
  });
});

describe("source manifest definition", () => {
  it("declares no permissions in code either", () => {
    for (const target of ["chrome", "firefox", "edge"] as const) {
      const m = buildManifest(target) as Record<string, unknown>;
      expect(m.permissions, target).toBeUndefined();
      expect(m.host_permissions, target).toBeUndefined();
      expect(m.content_scripts, target).toBeUndefined();
      expect(m.background, target).toBeUndefined();
    }
  });

  it("puts the Firefox settings in the Firefox manifest only", () => {
    expect(buildManifest("chrome").browser_specific_settings).toBeUndefined();
    expect(buildManifest("edge").browser_specific_settings).toBeUndefined();
    expect(buildManifest("firefox").browser_specific_settings?.gecko).toMatchObject({ id: GECKO_ID, data_collection_permissions: { required: ["none"] } });
    expect(buildManifest("firefox").minimum_chrome_version).toBeUndefined();
  });
});

describe("real production builds", () => {
  const out = mkdtempSync(join(tmpdir(), "opal42-ext-"));
  // WXT writes to <outDir>/<browser>-mv3.
  const dirs = { chrome: join(out, "chrome", "chrome-mv3"), firefox: join(out, "firefox", "firefox-mv3") };

  beforeAll(async () => {
    for (const browser of ["chrome", "firefox"] as const) {
      await build({ root, browser, mode: "production", outDir: join(out, browser), manifestVersion: 3, logger: { debug() {}, info() {}, log() {}, warn() {}, error() {}, success() {}, fatal() {}, ready() {}, start() {}, trace() {}, box() {}, level: 0 } as never });
    }
  }, 180_000);

  afterAll(() => rmSync(out, { recursive: true, force: true }));

  for (const browser of ["chrome", "firefox"] as const) {
    describe(browser, () => {
      const manifest = () => JSON.parse(readFileSync(join(dirs[browser], "manifest.json"), "utf8")) as Record<string, unknown>;

      it("matches the permission allow-list exactly", () => {
        expect(checkManifest(manifest(), allow, browser)).toEqual([]);
      });

      it("asks for no permission of any kind", () => {
        const m = manifest();
        for (const key of ["permissions", "optional_permissions", "host_permissions", "optional_host_permissions", "content_scripts", "background", "web_accessible_resources", "action"]) {
          expect(m[key], key).toBeUndefined();
        }
      });

      it("contains only the allow-listed files", () => {
        expect(checkFiles(listFiles(dirs[browser]), allow)).toEqual([]);
      });

      it("every file the manifest and the pages refer to exists", () => {
        const m = manifest();
        const files = new Set(listFiles(dirs[browser]));
        expect(files.has(String(m.devtools_page))).toBe(true);
        for (const icon of Object.values(m.icons as Record<string, string>)) expect(files.has(icon), icon).toBe(true);
        for (const page of ["devtools.html", "panel.html"]) {
          const html = readFileSync(join(dirs[browser], page), "utf8");
          for (const ref of html.matchAll(/(?:src|href)="\/?([^"]+)"/g)) expect(files.has(ref[1]), `${page} -> ${ref[1]}`).toBe(true);
        }
        expect(files.has("icon/32.png")).toBe(true); // the panel icon used by the DevTools page
      });

      it("loads nothing from the network in its pages", () => {
        for (const page of ["devtools.html", "panel.html"]) {
          const html = readFileSync(join(dirs[browser], page), "utf8");
          expect(html, page).not.toMatch(/https?:\/\//);
          expect(html, page).not.toMatch(/<script(?![^>]*\ssrc=)/); // no inline script
          expect(html, page).not.toMatch(/\sstyle=|<style/); // no inline style
        }
      });

      it("the bundles do not call network APIs", () => {
        for (const file of listFiles(dirs[browser]).filter((f) => f.endsWith(".js"))) {
          const text = readFileSync(join(dirs[browser], file), "utf8");
          for (const re of [/\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/, /sendBeacon/, /importScripts/, /\bEventSource\b/]) {
            expect(text, `${file}: ${re}`).not.toMatch(re);
          }
        }
      });
    });
  }

  it("Chrome has minimum_chrome_version and no Firefox settings", () => {
    const m = JSON.parse(readFileSync(join(dirs.chrome, "manifest.json"), "utf8")) as Record<string, unknown>;
    expect(m.minimum_chrome_version).toBe("111");
    expect(m.browser_specific_settings).toBeUndefined();
  });

  it("Firefox declares the add-on id, a minimum version and data_collection_permissions none", () => {
    const m = JSON.parse(readFileSync(join(dirs.firefox, "manifest.json"), "utf8")) as { browser_specific_settings: { gecko: Record<string, unknown> }; minimum_chrome_version?: string };
    expect(m.browser_specific_settings.gecko).toEqual({ id: GECKO_ID, strict_min_version: "142.0", data_collection_permissions: { required: ["none"] } });
    expect(m.minimum_chrome_version).toBeUndefined();
  });
});
