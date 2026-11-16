# Releasing

Nothing in this repository publishes by itself. `@opal42/gradient` and `opal42`
are `"private": true`; the release workflow is manual and defaults to a dry run.
Everything below is the owner's checklist, in order. The names are working names
([PLAN D1](PLAN.md)); do not skip the verification steps.

## One-time, by the owner

1. **Hardware-key 2FA** on the npm and GitHub accounts (PLAN §7).
2. **Verify the names.** `npm view @opal42/gradient` and `npm view opal42` must
   both be 404 (unscoped names are not proof the scope is free). Run the
   trademark search for "Opal" in software classes 9 and 42 (INPI/EUIPO/USPTO) and
   check the `opal42` GitHub org/user. If the scope is not obtainable, switch to
   the fallback `@lightseek3r/*` before anything else (rename in both
   `package.json`, the CLI dependency, imports, docs).
3. **Claim the npm scope**: create the `opal42` organization (or the fallback
   scope) on npmjs.com. A scope must exist before its first publish. Decide the
   JSR scope separately (PLAN D1(c); JSR is not part of this pipeline).
4. **Publish once by hand or reserve?** Trusted publishing needs the package to
   exist on npm before a trusted publisher can be attached. The first
   `0.1.0` therefore needs either one manual `npm publish --access public` from
   a machine with 2FA, or npm's "configure before first publish" flow if
   available for your account. After that, only the workflow publishes.
5. **Set the trusted publisher** for each package (npmjs.com, package Settings,
   Trusted Publisher, GitHub Actions): organization/user `LightSeek3r`,
   repository `gradient-studio`, workflow filename `release.yml`, and no
   environment (the workflow declares none). Then, on each package, set
   publishing access to "Require two-factor authentication and disallow tokens"
   so no token can publish.
6. **Remove `"private": true`** from `packages/core/package.json` and
   `packages/cli/package.json` in a reviewed commit. Until you do, even
   `dry_run: false` fails at `npm publish`, by design.
7. **Check the metadata**: `repository`, `homepage`, `bugs`, `license`, `files`,
   `engines`. Read `npm pack --dry-run -w <pkg>` once more.
8. Make sure the repository slug in `release.yml` (`if: github.repository ==
   'LightSeek3r/gradient-studio'`) is still right if the repo is renamed or
   transferred.

## Each release

1. Merge the work. Every user-visible change has a changeset
   (`npm run changeset`); the first one, `.changeset/first-release.md`, describes
   0.1.0 of both packages as a `minor` bump from 0.0.0.
2. Version: `npm run version-packages` (changesets updates both
   `package.json` versions, writes `CHANGELOG.md` per package, and moves the
   CLI's dependency range to the new core). Review and commit.
   (`privatePackages.version` is on in `.changeset/config.json` so this works
   while the packages are private.)
3. Locally: `npm ci && npm run lint && npm run typecheck && npm test &&
   npm run build && npm run build:packages && npm run lint:package &&
   npm run attw && npm run size && npm run vectors:diff`.
4. **Dry run** in GitHub: Actions, `release`, Run workflow, leave `dry_run`
   ticked. It runs lint, tests, vectors, builds, publint, attw, size-limit, the
   CLI smoke test and `npm pack --dry-run` for both packages, and publishes
   nothing. Read the file lists.
5. **Publish**: run the workflow again with `dry_run` unticked. It needs npm
   >= 11.5.1 (the workflow upgrades and checks), `id-token: write` and the
   trusted publisher from step 5; it publishes core first, then the CLI, with
   `--provenance`. Check the provenance badge on both npm pages.
6. Tag the commit (`v0.1.0`) and write the release notes from the changelogs.
   Launch write-up and playground links are separate work (PLAN §6 Phase 1).

## Rollback

`npm deprecate` the bad version with a message and publish a patch. `npm
unpublish` is restricted by npm policy after 72 hours or once something depends
on the version; do not plan on it.

## Why the workflow looks the way it does

- `workflow_dispatch` only; `dry_run` defaults to true.
- Least privilege: `contents: read` globally, `id-token: write` only on the one
  job; no secrets are used.
- Every action is pinned to the full commit SHA already used by `ci.yml`
  (`actions/checkout`, `actions/setup-node`). It uses no third-party action
  (the changesets action is deliberately not used: versioning is a local,
  reviewed step).
- Guarded by `github.repository`, so a fork's workflow does nothing.
