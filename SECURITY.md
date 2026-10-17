# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Report it privately in either way:

- GitHub: the **Security** tab of this repository, then **Report a vulnerability**
  (private vulnerability reporting).
- Email: [n.opal@unit42.fr](mailto:n.opal@unit42.fr?subject=Gradient%20Studio%20security%20report).

Include what you found, how to reproduce it, and which page or file is affected. I will
acknowledge a report within a few days and tell you what I plan to do about it. This is a
one-person project, so these are best-effort timelines, not guarantees.

## Scope

In scope: the app's source in `src/`, `index.html` and the files in `public/`, the build
configuration, and the GitHub workflow.

Out of scope: the platforms the app runs on (Cloudflare Pages, GitHub) and the third-party npm
packages it depends on. Please report those to their owners.

## Supported versions

Only the latest release and the current `master` branch are supported.

## What the repository contains

No secrets. Gradient Studio is a static, client-side app: it has no server, no account, no
environment variables and no API keys. If you ever find a credential in this repository or its
history, that is a vulnerability: please report it as above.
