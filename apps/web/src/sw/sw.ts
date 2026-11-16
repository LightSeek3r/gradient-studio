// ── Service worker ────────────────────────────────────────────────────────────
// Offline-first for this app's own files and nothing else: no network
// analytics, no runtime caching of foreign origins. The precache list and
// version are injected at build time by build/sw-plugin.ts.
//
// Update flow: a new worker installs in the background and WAITS. The page
// shows "Update available - reload"; when the person agrees it posts
// SKIP_WAITING, the new worker takes over and the page reloads.

import { cacheName, routeRequest, staleCacheNames, type PrecacheEntry } from "./precache";

declare const __PRECACHE__: PrecacheEntry[];
declare const __SW_VERSION__: string;

// The app's tsconfig has the DOM lib, not the WebWorker one: type just what is used.
interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEvent extends ExtendableEvent {
  readonly request: Request;
  respondWith(response: Promise<Response> | Response): void;
}
interface ExtendableMessageEvent extends ExtendableEvent {
  readonly data: unknown;
}
declare const self: {
  readonly location: Location;
  readonly clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: "install" | "activate", fn: (e: ExtendableEvent) => void): void;
  addEventListener(type: "fetch", fn: (e: FetchEvent) => void): void;
  addEventListener(type: "message", fn: (e: ExtendableMessageEvent) => void): void;
};

const CACHE = cacheName(__SW_VERSION__);
const URLS = __PRECACHE__.map((e) => e.url);
const PRECACHED: ReadonlySet<string> = new Set(URLS);

async function precache(): Promise<void> {
  const cache = await caches.open(CACHE);
  // `reload` bypasses the HTTP cache, so the cache holds exactly what the server has now.
  // Any failure rejects `install`: the previous worker (and its cache) stays in charge.
  await Promise.all(
    URLS.map(async (url) => {
      const res = await fetch(new Request(url, { cache: "reload" }));
      if (!res.ok || res.redirected) throw new Error(`precache ${url}: ${res.status}`);
      await cache.put(url, res);
    }),
  );
}

async function dropOldCaches(): Promise<void> {
  await Promise.all(staleCacheNames(await caches.keys(), CACHE).map((n) => caches.delete(n)));
}

self.addEventListener("install", (e) => e.waitUntil(precache()));

self.addEventListener("activate", (e) => e.waitUntil(dropOldCaches().then(() => self.clients.claim())));

self.addEventListener("fetch", (e) => {
  const route = routeRequest(e.request, self.location.origin, PRECACHED);
  if (route.kind !== "precache") return; // untouched: the browser handles it
  e.respondWith(
    caches
      .open(CACHE)
      .then((cache) => cache.match(route.key))
      .then((hit) => hit ?? fetch(e.request)),
  );
});

self.addEventListener("message", (e) => {
  const data = e.data as { type?: unknown } | null;
  if (data && data.type === "SKIP_WAITING") void self.skipWaiting();
});
