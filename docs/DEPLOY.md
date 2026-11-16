# Deploying the web app (Cloudflare Pages)

The app is a static site. `npm run build` writes everything to the repo-root `dist/`.

## What did not change

The existing Pages project settings keep working as they are:

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | repository root |

Nothing here deploys anything by itself; GitHub runs no deploy workflow.

## What is new (all in the repo)

| File | Purpose |
|---|---|
| `docs/deploy/wrangler.example.jsonc` | An EXAMPLE Pages config as code (not active). Copy it to the repo root as `wrangler.jsonc` only after replacing `name` with your real Pages project name. |
| `apps/web/public/_headers` | Security and cache headers, copied to `dist/_headers` by the build. |
| `apps/web/build/sw-plugin.ts` | Build step that writes `dist/sw.js` with a generated precache list. |

No `_redirects` file is needed: routing is hash-based (`#v1;...`), so every URL is `/`.

**Why `wrangler.jsonc` is not active.** Once a Pages project's repository carries a Wrangler file with
`pages_build_output_dir`, Cloudflare treats that file as the source of truth for the fields it sets and
shows them read-only in the dashboard, and its `name` must match the existing project. The live project is
served at `gradient-studio-al4.pages.dev` and its exact project name is not recorded in this repo, so the
file ships as an example only, and the existing dashboard settings (build command `npm run build`, output
directory `dist`) keep working unchanged. To adopt config-as-code: confirm the project name in the
Cloudflare dashboard, copy the example to `wrangler.jsonc` with that name, and deploy once to confirm.
Do not add bindings or `vars`: there are no Functions.

## Manual deploy

```sh
npm ci
npm run build
npx wrangler pages deploy dist --project-name <your-pages-project>   # needs `wrangler login` or CLOUDFLARE_API_TOKEN
```

Check `dist/sw.js`, `dist/_headers` and `dist/site.webmanifest` exist first.

## Headers

Pages merges values of the same header from every matching rule, so each header name is set by one
rule per path: security headers on `/*`, `Cache-Control` only on `/assets/*`, `/sw.js` and
`/site.webmanifest`.

- **CSP**: `default-src 'self'`, with `script-src 'self'` (one module bundle and the worker; no
  inline script, no eval), `style-src 'self'` (React sets `style=""` through the CSSOM, which CSP does not
  block), `font-src 'self' data:` and `img-src 'self' data:` (Vite inlines the smallest font subsets and
  the CSS dot-grid as `data:` URLs), `connect-src 'self'` (only the service worker's precache
  fetches), `worker-src 'self'`, `frame-ancestors 'none'`, `base-uri 'none'`, `form-action 'none'`. No
  `unsafe-inline`, no `unsafe-eval`. Verified: the built app with these exact headers produces zero
  violations and zero console errors (import dialog, paste, offline included).
- Also: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  `Cross-Origin-Opener-Policy: same-origin`, a `Permissions-Policy` that denies camera, microphone,
  geolocation, payment and USB (clipboard stays allowed: paste import needs it), HSTS for one year
  (no `includeSubDomains`, no preload).
- **Cache**: `/assets/*` is content-hashed, so `public, max-age=31536000, immutable`. `/sw.js` and
  the manifest are `no-cache` so updates are always seen. HTML keeps the Pages default (revalidate).

If you add a script, style or network call, update the CSP in the same change. A new external host
means a new `connect-src`/`img-src` entry and a note in `PRIVACY.md`.

## Offline and updates (service worker)

`dist/sw.js` precaches the page shell, the hashed bundle, the woff2 fonts, icons and the manifest
(about 28 files) under a cache named by a hash of that list, then answers every same-origin request
from it. It makes no other requests and caches nothing from other origins. A new deploy changes the
worker's bytes; browsers install it in the background, the app shows "Update available - reload",
and the new version takes over only when the person clicks Reload. Old caches are deleted on
activation.

`vite-plugin-pwa` was tried first and rejected: its `workbox-build` dependency tree fails
`npm audit` (the repo keeps it at 0).

## Checking a build locally

Serve `dist/` with any static server on a fresh port (not `vite preview`, which ignores `_headers`),
open it once, then go offline and reload. To check headers, use a server that applies `dist/_headers`
or `npx wrangler pages dev dist`.
