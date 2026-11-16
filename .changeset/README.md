# Changesets

Every user-visible change to `@opal42/gradient` or `opal42` needs a changeset:
run `npm run changeset`, pick the packages and the bump, and write one or two
sentences for the changelog. Commit the generated file with your change.

Versions are applied with `npm run version-packages` (done by the maintainer
when releasing, see `docs/RELEASING.md`). Nothing here publishes anything: the
packages are `"private": true` until the owner removes it.
