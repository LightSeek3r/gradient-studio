# pre-commit, lint-staged and husky

Recipes that run [`opal42 score`](cli.md) on the files you are about to commit.
The score is a **smoothness score by our definition**, not a quality verdict;
with no `--min-score` the hook only prints and never fails on scores, and there
is no default threshold. Everything runs locally: no network (after install),
no telemetry.

## Honest status: the CLI is not published

Nothing is published yet ([`RELEASING.md`](RELEASING.md)); `opal42` is a working
name. These recipes need the CLI to exist on the npm registry (or be installed
from a checkout). Two further caveats for the pre-commit framework:

- `.pre-commit-hooks.yaml` at the root of this repository defines the hook
  `opal42-score` (`language: node`, `entry: opal42 score`). pre-commit installs
  the *hook repository* with npm, but this repository's root is a private
  workspace that exposes no `opal42` bin. Until the CLI is published, the hook
  is a definition, not something you can consume with `repo: <url>`.
- Once published, pin the CLI in your config with `additional_dependencies`
  (below).

## pre-commit (framework)

After publication:

```yaml
repos:
  - repo: https://github.com/LightSeek3r/gradient-studio
    rev: <tag or full sha>
    hooks:
      - id: opal42-score
        additional_dependencies: ['opal42@0.1.0']
        args: [--min-score, '70'] # your own number; omit to only print
```

pre-commit passes the staged files as arguments; the hook's `files` pattern is
`\.(css|scss|sass|less|html|htm|vue|svelte|astro|jsx|tsx|js|mjs|cjs|ts|mts|cts|md|mdx)$`
(narrow it with `files:` in your config). A local hook works today if
`opal42` is on your `PATH` (for example from `npm link` in `packages/cli`):

```yaml
repos:
  - repo: local
    hooks:
      - id: opal42
        name: gradient smoothness
        entry: opal42 score --min-score 70
        language: system
        files: \.(css|scss|sass|less)$
```

## lint-staged

```json
{
  "lint-staged": {
    "*.{css,scss,sass,less,html,vue,svelte,astro,jsx,tsx,js,mjs,ts,md,mdx}": "opal42 score --min-score 70"
  }
}
```

lint-staged appends the staged file names. Drop `--min-score` to annotate
without failing. To fix on commit use `opal42 score --fix --min-score 70`
(lint-staged re-stages the changed files); `--fix` can change colours, so look
at what it does to your gradients first (`--fix --dry-run`).

## husky

`.husky/pre-commit`:

```sh
npx --no-install lint-staged
```

or without lint-staged:

```sh
files=$(git diff --cached --name-only --diff-filter=ACM -- '*.css' '*.scss' '*.sass' '*.less')
[ -z "$files" ] || npx --no-install opal42 score --min-score 70 $files
```

`--no-install` makes it fail instead of downloading if `opal42` is not a
dependency of the project. Until publication, run the built CLI instead:
`node path/to/gradient-studio/packages/cli/dist/cli.js score ...`.

## Stylelint instead

If the project already runs Stylelint in its hooks, the
[Stylelint plugin](stylelint.md) gives the same score as lint errors with exact
ranges and an opt-in `--fix`.
