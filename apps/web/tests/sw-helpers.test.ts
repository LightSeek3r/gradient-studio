import { describe, expect, it } from "vitest";
import {
  CACHE_PREFIX,
  buildPrecacheManifest,
  cacheName,
  isPrecacheable,
  isUpdateReady,
  manifestVersion,
  routeRequest,
  shouldCheckForUpdate,
  staleCacheNames,
} from "../src/sw/precache";
import { wantsImportDialog, withoutLaunchAction } from "../src/import/launch";

const files = [
  { path: "index.html", hash: "aaa" },
  { path: "assets/index-DnnPqKFJ.js", hash: "bbb" },
  { path: "assets/index-uC1m1gyg.css", hash: "ccc" },
  { path: "assets/space-grotesk-latin-400-normal-CJ-V5oYT.woff2", hash: "ddd" },
  { path: "assets/space-grotesk-latin-400-normal-BnQMeOim.woff", hash: "eee" },
  { path: "icon-192.png", hash: "fff" },
  { path: "site.webmanifest", hash: "ggg" },
  { path: "og-image.png", hash: "hhh" },
  { path: "sw.js", hash: "iii" },
  { path: "_headers", hash: "jjj" },
  { path: "vite.svg", hash: "kkk" },
];

describe("buildPrecacheManifest", () => {
  const manifest = buildPrecacheManifest(files);

  it("stores index.html as the shell `/` (hosts redirect /index.html, and a redirect cannot answer a navigation)", () => {
    expect(manifest.map((e) => e.url)).toContain("/");
    expect(manifest.map((e) => e.url)).not.toContain("/index.html");
  });

  it("leaves out the worker, host config, social image, legacy icon and woff fallbacks", () => {
    const urls = manifest.map((e) => e.url);
    for (const gone of ["/sw.js", "/_headers", "/og-image.png", "/vite.svg", "/assets/space-grotesk-latin-400-normal-BnQMeOim.woff"]) {
      expect(urls).not.toContain(gone);
    }
    expect(urls).toContain("/assets/space-grotesk-latin-400-normal-CJ-V5oYT.woff2");
  });

  it("uses the URL as revision for hashed assets and the content hash for the rest", () => {
    const rev = (u: string) => manifest.find((e) => e.url === u)?.revision;
    expect(rev("/assets/index-DnnPqKFJ.js")).toBeNull();
    expect(rev("/")).toBe("aaa");
    expect(rev("/icon-192.png")).toBe("fff");
    expect(rev("/site.webmanifest")).toBe("ggg");
  });

  it("is sorted and independent of input order", () => {
    expect(buildPrecacheManifest([...files].reverse())).toEqual(manifest);
    const urls = manifest.map((e) => e.url);
    expect(urls).toEqual([...urls].sort());
  });

  it("never precaches source maps", () => {
    expect(isPrecacheable("assets/index-DnnPqKFJ.js.map")).toBe(false);
  });
});

describe("manifestVersion / cacheName", () => {
  const base = buildPrecacheManifest(files);
  it("is stable for the same build", () => {
    expect(manifestVersion(base)).toBe(manifestVersion(buildPrecacheManifest(files)));
    expect(manifestVersion(base)).toMatch(/^[0-9a-f]{8}$/);
  });
  it("changes when a hashed asset is renamed or an unhashed file changes", () => {
    const renamed = buildPrecacheManifest(files.map((f) => (f.path.endsWith(".js") ? { ...f, path: "assets/index-ZZZZZZZZ.js" } : f)));
    const edited = buildPrecacheManifest(files.map((f) => (f.path === "index.html" ? { ...f, hash: "changed" } : f)));
    expect(manifestVersion(renamed)).not.toBe(manifestVersion(base));
    expect(manifestVersion(edited)).not.toBe(manifestVersion(base));
  });
  it("prefixes the cache name so old caches can be found", () => {
    expect(cacheName("abc12345")).toBe(`${CACHE_PREFIX}abc12345`);
  });
});

describe("staleCacheNames", () => {
  it("returns our other caches and never foreign ones", () => {
    const current = cacheName("new");
    expect(staleCacheNames([cacheName("old"), current, "someone-elses", cacheName("older")], current)).toEqual([
      cacheName("old"),
      cacheName("older"),
    ]);
    expect(staleCacheNames([], current)).toEqual([]);
  });
});

describe("routeRequest", () => {
  const origin = "https://gs.test";
  const precached = new Set(["/", "/assets/index-DnnPqKFJ.js", "/icon-192.png"]);
  const route = (url: string, mode = "no-cors", method = "GET") => routeRequest({ url, mode, method }, origin, precached);

  it("serves precached files from the cache", () => {
    expect(route(`${origin}/assets/index-DnnPqKFJ.js`)).toEqual({ kind: "precache", key: "/assets/index-DnnPqKFJ.js" });
    expect(route(`${origin}/icon-192.png?x=1`)).toEqual({ kind: "precache", key: "/icon-192.png" });
  });
  it("answers every same-origin navigation with the shell, whatever the path, query or hash", () => {
    for (const path of ["/", "/?action=import", "/some/deep/path", "/index.html"]) {
      expect(route(origin + path, "navigate")).toEqual({ kind: "precache", key: "/" });
    }
  });
  it("leaves unknown files, other methods and other origins to the network", () => {
    expect(route(`${origin}/sw.js`)).toEqual({ kind: "network" });
    expect(route(`${origin}/api/x`)).toEqual({ kind: "network" });
    expect(route(`${origin}/icon-192.png`, "no-cors", "POST")).toEqual({ kind: "network" });
    expect(route("https://fonts.example/x.woff2")).toEqual({ kind: "network" });
    expect(route("https://fonts.example/", "navigate")).toEqual({ kind: "network" });
    expect(route("not a url")).toEqual({ kind: "network" });
  });
  it("does not invent a shell that was not precached", () => {
    expect(routeRequest({ url: `${origin}/`, mode: "navigate", method: "GET" }, origin, new Set())).toEqual({ kind: "network" });
  });
});

describe("update flow helpers", () => {
  it("only a worker that finished installing under a controlled page is an update", () => {
    expect(isUpdateReady({ state: "installed" }, true)).toBe(true);
    expect(isUpdateReady({ state: "installed" }, false)).toBe(false); // first install, nothing to update
    expect(isUpdateReady({ state: "installing" }, true)).toBe(false);
    expect(isUpdateReady({ state: "activated" }, true)).toBe(false);
  });
  it("checks for updates when visible, at most once per interval", () => {
    const hour = 3_600_000;
    expect(shouldCheckForUpdate(hour, 0, "visible", hour)).toBe(true);
    expect(shouldCheckForUpdate(hour - 1, 0, "visible", hour)).toBe(false);
    expect(shouldCheckForUpdate(hour * 2, 0, "hidden", hour)).toBe(false);
  });
});

describe("launch shortcut", () => {
  it("recognises ?action=import only", () => {
    expect(wantsImportDialog("?action=import")).toBe(true);
    expect(wantsImportDialog("?a=1&action=import")).toBe(true);
    expect(wantsImportDialog("?action=export")).toBe(false);
    expect(wantsImportDialog("")).toBe(false);
  });
  it("strips the action and keeps the rest of the URL", () => {
    expect(withoutLaunchAction("https://gs.test/?action=import#v1;s=ff0000@0")).toBe("/#v1;s=ff0000@0");
    expect(withoutLaunchAction("https://gs.test/?x=1&action=import")).toBe("/?x=1");
  });
});
