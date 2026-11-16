# GitHub Action

`actions/score` is a composite action over the [`opal42` CLI](cli.md): it
scans files for linear CSS gradients and writes one GitHub annotation per
finding (`--format github`). It adds no scoring logic, makes no network request
of its own and sends no telemetry ([`PRIVACY.md`](../PRIVACY.md)).

The score is a **smoothness score by our definition**, not a quality verdict.
There is no default threshold: the step never fails on scores unless you set
`min-score`. Annotations are warnings and notices; `::error` is used only for a
gradient below `min-score`, a skipped gradient under `fail-on-unscorable`, and
I/O problems.

## Usage

```yaml
jobs:
  gradients:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<full-sha> # pin third-party actions by full SHA
      - uses: actions/setup-node@<full-sha>
        with:
          node-version: 24 # Node 22 or newer is required
      - uses: LightSeek3r/gradient-studio/actions/score@<ref>
        with:
          paths: src/**/*.css
          min-score: 70 # your own number; omit to annotate only
```

Pin `<ref>` to a commit SHA you reviewed. The action does not set up Node:
the runner must have Node 22+ (as above).

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `paths` | `.` | Files, directories or globs, separated by spaces or newlines. Globs (`**` included) are expanded by bash; a glob that matches nothing is a notice, not an error. |
| `min-score` | empty (**no default**) | Fail if a scored gradient is below it (0-100, inclusive). |
| `fail-on-unscorable` | `false` | Fail if a gradient was skipped (`var()`, `calc()`, radial, ...). |
| `ignore` | empty | Globs to skip, one per line (CLI `--ignore`; `*`, `**`, `?`; a pattern without `/` matches any path segment). |
| `version` | `latest` | CLI version for `npx opal42@<version>`. Used only when `cli-path` is empty. |
| `cli-path` | empty | A locally built CLI (`packages/cli/dist/cli.js`), run with `node`. Nothing is downloaded. |
| `working-directory` | `.` | Where to run; annotation paths are relative to it. |

Exit status is the CLI's ([`cli.md`](cli.md#exit-codes)): 1 when a gradient is
below `min-score` (or skipped under `fail-on-unscorable`), 2 for a usage error
(including a non-numeric `min-score`), 3 for I/O errors. Inputs are passed
through environment variables, never interpolated into the script.

## Before the package is published

Nothing is published yet ([`RELEASING.md`](RELEASING.md)), so
`npx opal42@<version>` cannot work today. Build the CLI in the same job and use
`cli-path`; this repository's own CI does exactly that (job `dogfood-action` in
[`ci.yml`](../.github/workflows/ci.yml): informational, no `min-score`,
`continue-on-error`):

```yaml
- run: npm ci && npm run build:packages
- uses: ./actions/score
  with:
    paths: apps/web/src/**/*.css
    cli-path: packages/cli/dist/cli.js
```

Once `opal42` is published, drop `cli-path` and pin `version: 0.1.0` (the
package name is a working name until the registry checks in PLAN D1 are done).
