# Releasing

Nothing in this repository publishes by itself. Every package is `"private": true`,
and the `release` workflow is manual and defaults to a dry run. Names are working
names ([PLAN D1](PLAN.md)); the scope `@opal42` is **unverified**. The single source
of truth for names and tiers is [`release.config.json`](../release.config.json).

## Tiers and order

| Tier | Packages (publish order) | When |
|---|---|---|
| 1 | `@opal42/gradient`, then `opal42` (CLI) | first; everything else depends on core |
| 2 | `@opal42/stylelint-plugin`, `@opal42/mcp` | after tier 1 is on npm |
| 3 | `@opal42/element`, `@opal42/style-dictionary`, `@opal42/bench` | on demand |

The apps (web, vscode, extension, figma, worker) are never published to npm.
`npm run release:check` fails if a package depends on one published later.

## Owner checklist

1. **Claim the scope, or rename.** Hardware-key 2FA on npm and GitHub first. Create
   the npm org `opal42`. A 404 from `npm view @opal42/gradient` is *not* proof the
   scope is free (all seven names were 404 when last read, from the build sandbox).
   Run the trademark search for "Opal" (PLAN D1(b)). If the scope is not yours,
   rename before anything else: see "If @opal42 is not available".
2. **`npm run release:check`.** For every candidate it checks: name and scope against
   `release.config.json`, version, license, repository (with `directory`), bugs,
   homepage, keywords, engines, `files`, `exports`/`types`/`bin` targets inside the
   tarball, `sideEffects`, `publishConfig`, README and LICENSE, dependency ranges (no
   `workspace:`, `*`, `file:`; internal ranges satisfied; tier order), the `npm pack`
   file list (no tests, sources, maps, `.env`, keys; token scan; size), and installs
   the tier 1 and 2 tarballs in a clean temp project and runs core, the CLI, the
   stylelint plugin and `opal42-mcp --version`. It needs the npm registry for
   third-party dependencies. CI runs it on the Node 24 leg.
3. **First manual publish of tier 1.** A trusted publisher can only be attached to a
   package that already exists. Verified (npm 12.2.2 tarball, `npm-trust.md`, read
   from the registry): "Package must exist", one configuration per package, 2FA
   required, `npm trust` needs npm >= 11.15.0. Not verified here (needs your
   account): whether the website offers any pre-publish flow, and whether
   `publishConfig.provenance: true` makes a laptop publish fail (it needs CI OIDC;
   if so add `--no-provenance`). Do: `npm run version-packages` (changesets set all
   packages to 0.1.0 and rewrite internal ranges to `^0.1.0`; review, commit), `node
   scripts/set-private.mjs tier:1 --false --write`, `npm run release:check --
   --require-public`, then `npm publish -w @opal42/gradient --access public` and
   `npm publish -w opal42 --access public` (2FA prompt). Any later tier whose
   package is new needs the same one-off manual publish before step 4.
4. **Trusted publisher, per package** (npmjs.com, package Settings, Trusted
   Publisher, GitHub Actions; or `npm trust github <pkg> --file release.yml --repo
   LightSeek3r/gradient-studio --allow-publish`): owner `LightSeek3r`, repository
   `gradient-studio`, workflow `release.yml`, no environment. Then set publishing
   access to "Require two-factor authentication and disallow tokens".
5. **Flip `private`** in a reviewed commit: `node scripts/set-private.mjs tier:2
   --false` (dry run, prints the edit), then again with `--write`. It accepts package
   names or `tier:N`, refuses anything that is not a candidate, and `--true` undoes it.
6. **Release workflow.** Actions, `release`, pick the `tier`, leave `dry_run` ticked
   (lint, tests, vectors, builds, publint, attw, size, `release:check`, pack lists;
   publishes nothing), read the file lists, then run it again unticked. It publishes
   in tier order with `--provenance`; check the badge on each npm page.
7. **Tag and release.** Tag the commit (`v0.1.0`) and write the notes from the
   changelogs. Launch write-up and playground links are separate work (PLAN §6).

Keep the slug in `release.yml` (`github.repository == 'LightSeek3r/gradient-studio'`)
right if the repository is renamed or transferred.

## If @opal42 is not available

```sh
git status                                   # must be clean (or pass --force)
node scripts/rename-scope.mjs @opal42 @acme --dry-run
node scripts/rename-scope.mjs @opal42 @acme --cli-name acme   # --cli-name also renames the CLI
npm run lint && npm run typecheck && npm test && npm run build:packages && npm run release:check
```

It rewrites package names, dependency keys, imports, `-w @scope/x` commands,
configs, workflows, docs, READMEs, changesets, CHANGELOGs and `release.config.json`,
prints every file it changed, then runs `npm install` to relink the workspaces and
regenerate the lockfile. A second run changes nothing. With `--cli-name` the CLI
package, its bin, `<cli>-mcp` and `<cli>-bench` follow. Left alone on purpose: brand
strings that are not registry names (the `opal42/` stylelint rule namespace,
`<opal42-gradient-score>`, VS Code settings, CSS variables), the decision record
`docs/PLAN.md` and `docs/plan-research/`, and the Cloudflare service name in
`apps/worker/wrangler.jsonc`. The fallback scope in PLAN D1 is `@lightseek3r`.
Tested on a scratch copy (`@opal42` to `@acme-test`, CLI `acme-test`): lint,
typecheck, all tests, builds, size, attw, publint, `release:check`, `vectors:diff`.

## Rollback

`npm deprecate` the bad version with a message and publish a patch. `npm unpublish`
is restricted after 72 hours or once something depends on the version.

## Why the workflow looks the way it does

- `workflow_dispatch` only; `dry_run` defaults to true; one tier per run.
- `contents: read` globally, `id-token: write` only on the one job; no secrets.
- Actions are pinned to the full commit SHAs `ci.yml` uses; no third-party action
  (versioning is a local, reviewed step, so the changesets action is not used).
- Guarded by `github.repository`, so a fork's workflow does nothing.
