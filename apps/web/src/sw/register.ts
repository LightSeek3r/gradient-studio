// Registers the service worker (production builds only) and reports when a new
// version is waiting. The page decides how to tell the person; `reload()`
// activates the waiting worker and reloads once it has taken over.

import { isUpdateReady, shouldCheckForUpdate } from "./precache";

export interface UpdateHandle {
  reload(): void;
}

const CHECK_EVERY_MS = 60 * 60 * 1000;
let registered = false;

export function registerServiceWorker(onUpdate: (handle: UpdateHandle) => void): void {
  if (registered || !import.meta.env.PROD || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  registered = true;
  const sw = navigator.serviceWorker;

  let reloading = false;
  // The first install also fires `controllerchange` (the worker claims the page): only reload for a requested update.
  sw.addEventListener("controllerchange", () => {
    if (reloading) window.location.reload();
  });

  const announce = (waiting: ServiceWorker): void =>
    onUpdate({
      reload: () => {
        reloading = true;
        waiting.postMessage({ type: "SKIP_WAITING" });
      },
    });

  const start = (): void => {
    sw.register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        if (reg.waiting && sw.controller) announce(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const incoming = reg.installing;
          incoming?.addEventListener("statechange", () => {
            if (isUpdateReady(incoming, sw.controller !== null)) announce(incoming);
          });
        });
        let last = Date.now();
        document.addEventListener("visibilitychange", () => {
          const now = Date.now();
          if (!shouldCheckForUpdate(now, last, document.visibilityState, CHECK_EVERY_MS)) return;
          last = now;
          reg.update().catch(() => {});
        });
      })
      .catch(() => {
        // Offline support is an enhancement; the app works without it.
      });
  };
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
}
