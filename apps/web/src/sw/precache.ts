// ── Pure service-worker helpers ───────────────────────────────────────────────
// Everything here is free of DOM, worker and Node APIs so it can be shared by
// the service worker (src/sw/sw.ts), the build step (build/sw-plugin.ts) and
// the unit tests. No network, no analytics: the worker only ever caches this
// app's own files.

/** Every cache this app creates starts with this, so old ones can be found. */
export const CACHE_PREFIX = "gradient-studio-precache-";

export interface PrecacheEntry {
  /** Absolute path as requested by the page, e.g. `/assets/index-abc.js`; the shell is `/`. */
  url: string;
  /** Content hash of files whose name carries none (index.html, icons, manifest). */
  revision: string | null;
}

export interface BuiltFile {
  /** Path inside the output directory, no leading slash, `/` separators. */
  path: string;
  /** Hex content hash. */
  hash: string;
}

/** Built files that must never be precached (the worker itself, host config, social/legacy images). */
const NEVER = /^(?:sw\.js|_headers|_redirects|og-image\.png|vite\.svg)$/;
/** Fonts: every browser that can run this app takes the woff2 source of each @font-face. */
const FALLBACK_FONT = /\.woff$/;
/** Vite names hashed assets `name-<8 chars>.ext`; their URL is their revision. */
const HASHED = /^assets\/.+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;

export function isPrecacheable(path: string): boolean {
  return !NEVER.test(path) && !FALLBACK_FONT.test(path) && !path.endsWith(".map");
}

/**
 * The precache list for a build: sorted, deduplicated, with `index.html`
 * stored under `/`. (Hosts such as Cloudflare Pages redirect `/index.html` to
 * `/`, and a redirected response cannot answer a navigation.)
 */
export function buildPrecacheManifest(files: readonly BuiltFile[]): PrecacheEntry[] {
  const byUrl = new Map<string, PrecacheEntry>();
  for (const f of files) {
    if (!isPrecacheable(f.path)) continue;
    const url = f.path === "index.html" ? "/" : `/${f.path}`;
    byUrl.set(url, { url, revision: HASHED.test(f.path) ? null : f.hash });
  }
  return [...byUrl.values()].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
}

/** FNV-1a over the manifest: a short, stable id that changes with any file. */
export function manifestVersion(entries: readonly PrecacheEntry[]): string {
  let h = 0x811c9dc5;
  for (const ch of entries.map((e) => `${e.url}@${e.revision ?? ""}`).join("\n")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export const cacheName = (version: string): string => `${CACHE_PREFIX}${version}`;

/** Our caches other than `current`: what `activate` deletes. Foreign caches are left alone. */
export function staleCacheNames(all: readonly string[], current: string): string[] {
  return all.filter((n) => n.startsWith(CACHE_PREFIX) && n !== current);
}

export type Route = { kind: "precache"; key: string } | { kind: "network" };

/**
 * How the worker answers a request. Precached files come from the cache
 * (the page and its assets are then always one consistent version; updates go
 * through the explicit "Update available" flow). Any same-origin navigation
 * gets the app shell. Everything else, including every cross-origin request,
 * is left to the network untouched.
 */
export function routeRequest(
  req: { method: string; url: string; mode: string },
  origin: string,
  precached: ReadonlySet<string>,
): Route {
  if (req.method !== "GET") return { kind: "network" };
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return { kind: "network" };
  }
  if (url.origin !== origin) return { kind: "network" };
  if (req.mode === "navigate") return precached.has("/") ? { kind: "precache", key: "/" } : { kind: "network" };
  return precached.has(url.pathname) ? { kind: "precache", key: url.pathname } : { kind: "network" };
}

/** A worker that finished installing is an *update* only if a page is already controlled by an older one. */
export function isUpdateReady(worker: { state: string }, hasController: boolean): boolean {
  return worker.state === "installed" && hasController;
}

/** Re-check for a new version when the tab becomes visible, at most once per interval. */
export function shouldCheckForUpdate(now: number, lastCheck: number, visibility: string, intervalMs: number): boolean {
  return visibility === "visible" && now - lastCheck >= intervalMs;
}
