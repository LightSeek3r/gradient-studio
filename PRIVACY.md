# Privacy

## Product surfaces: no telemetry

No Gradient Studio product surface collects telemetry: not the web app, the core
library, the CLI, lint rules, editor or browser extensions, or agent
integrations. That means no analytics, no crash reporting, no usage pings, no
"anonymous statistics", no fingerprinting, and no opt-out switch for any of
these, because there is nothing to opt out of.

- The **core library** performs no I/O at all: no network, no storage, no DOM
  (see [`SCOPE.md`](SCOPE.md)). Scoring a gradient never leaves the process
  that calls it.
- The **web app** runs entirely in your browser. Gradients you edit are not
  sent anywhere. Fonts and assets are bundled with the app, not loaded from
  third-party hosts. Future features that remember state (URL hash, autosave)
  keep it on your device; a shareable link carries the gradient in the link
  itself, and only you decide where it goes. Once loaded, the app keeps a copy of
  its own files in your browser's cache (a service worker) so it works offline;
  that cache holds only the app, never your gradients, and the worker makes no
  requests to any other host.
- The **hosting provider** (currently Cloudflare Pages) serves the static files
  and, as any web host does, sees request metadata such as IP addresses. We do
  not add analytics to it; whether the provider's own analytics are switched off
  for the site is tracked as a task in `docs/PLAN.md`.

"Nothing leaves your device" is a claim we make only for the app, the library,
the CLI and extensions, where it is true.

How we know whether the project is used, without telemetry: registry download
counts, stars, dependents, store install counts and issues.

## Future hosted or research data: separate and explicit

If the project ever runs something that receives data — a stateless hosted MCP
endpoint, or a study of how people judge gradients — it will be:

- **separate** from the product surfaces above: its own service, its own
  documentation, never called by the web app, library or CLI by default;
- **explicit**: you use it on purpose (you point a client at the hosted
  endpoint, or you choose to take part in a study), with a privacy statement
  published before it launches;
- **minimal**: for a hosted endpoint, stateless, with no storage of request
  bodies, no request-body logging and no cookies, while stating plainly that
  the provider still processes IP addresses (personal data under the GDPR);
- **consented and bounded** for research: consent text, a stated purpose, a
  retention period and deletion on request, and results published in aggregate.

Any change to this policy is made in this file, in the open, before the change
in behaviour.

## Contact

Security or privacy concerns: see [`SECURITY.md`](SECURITY.md).
