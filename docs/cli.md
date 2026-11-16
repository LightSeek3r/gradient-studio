# opal42 command line

`opal42` scores the linear CSS gradients it finds in files, directories or
standard input, lists coded issues with their source positions, and can rewrite
the gradients that a refinement improves. It is a thin adapter over
`@opal42/gradient`: all scoring logic lives in the core (scoring model v1,
[`spec/scoring-v1.md`](../spec/scoring-v1.md)).

The package names are working names and nothing is published yet
([`RELEASING.md`](RELEASING.md)). From a checkout: `npm run build:packages`, then
`node packages/cli/dist/cli.js ...`. Requires Node 22 or newer. It makes no
network requests and sends no telemetry ([`PRIVACY.md`](../PRIVACY.md)).

The number is a **smoothness score by our definition** (0-100, from published,
coded rules). It is not a quality verdict, and there is no default threshold:
you choose one with `--min-score` or you do not.

## Usage

```
opal42 score  [options] <files|dirs|->...
opal42 refine [options] <files|dirs|->...
opal42 parse  [options] <files|dirs|->...
opal42 --help | --version
```

| Command | What it does |
|---|---|
| `score` | Scores every gradient found. With `--fix`, also rewrites the ones a refinement improves. |
| `refine` | Shows, per gradient, the refinement and the score it would reach. Changes nothing unless `--write`. |
| `parse` | Debug: prints each gradient the parser found with its source range, stop ranges, document and skip code. |

A path is a file, a directory (searched recursively) or `-` for standard input
(once). There is no default path: calling a command without input is a usage
error.

Directory walking reads files with these extensions: `.css .scss .sass .less
.html .htm .vue .svelte .astro .jsx .tsx .js .mjs .cjs .ts .mts .cts .md .mdx`.
`node_modules`, `.git`, `dist`, `build` and `coverage` are skipped at any depth
(unless you name one as a root). Symbolic links to files are followed, links to
directories are not. A file you name explicitly is always read, whatever its
extension. Files over 2 MB, files containing a NUL byte and files that are not
valid UTF-8 are skipped with a notice (exit code unaffected); the 2 MB limit
also applies to standard input.

## Options

| Option | Meaning |
|---|---|
| `--json` | Same as `--format json`. |
| `--format text\|json\|github` | Output format (default `text`). |
| `--min-score <n>` | Exit 1 if any scored gradient is below `n` (0-100). Inclusive: a score equal to `n` passes. **No default.** |
| `--fail-on-unscorable` | Exit 1 if any gradient was skipped (off by default). |
| `--fix` | `score` only. Rewrite files in place, but only gradients that a refinement improves (see below). |
| `--write` | `refine` only. Same rewrite. |
| `--dry-run` | With `--fix`/`--write`: report what would change, write nothing. |
| `--ignore <glob>` | Skip matching paths. Repeatable. `*` (not `/`), `**` (anything), `?` (one character). A pattern without `/` matches any path segment (`vendor`, `*.min.css`); with `/` it is anchored at the working directory (`src/legacy/**`). Matching a directory skips everything below it. |
| `--max-gradients <n>` | Gradients examined per file (default 2000); the rest are counted and reported. |
| `-q`, `--quiet` | Text and github formats print only gradients below `--min-score` and errors. JSON is unaffected. |
| `--verbose` | Also list skipped gradients and parser warnings. |
| `--no-color` | Plain text. Colour is off anyway when stdout is not a terminal or `NO_COLOR` is set (`FORCE_COLOR` forces it on). |
| `-h`, `--help`, `-v`, `--version` | |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success. Without `--min-score` and `--fail-on-unscorable` this is the answer unless something went wrong. |
| 1 | A scored gradient is below `--min-score`, or a gradient was skipped under `--fail-on-unscorable`. With `--fix`, scores are the ones after the rewrite; with `--dry-run` they are the current ones. |
| 2 | Usage error (unknown option or command, bad value, no input, conflicting flags). Message on stderr. |
| 3 | I/O error (a path does not exist or cannot be read, a file cannot be written) or an internal error. Wins over 1, because the result is incomplete; the other files are still processed and reported. |

`run(argv, io)` never throws; `io` carries stdout, stderr, file system, stdin,
working directory and colour, so everything above is testable without a
process.

## Text output

```
rough.css:3:15  smoothness score 58/100  (lightness 18/30, hue 10/30, chroma 10/20, spacing 20/20)  linear-gradient(90deg, #ff0000, #00ff00 50%, #0000ff)
  rough.css:3:47  error  lightness/reversal  -12  Lightness fluctuates (1 reversal) — creates visual noise
  rough.css:3:38  error  hue/wide-arc  -20  Hue arc spans >180° — colors clash unexpectedly
```

`path:line:col` is where the gradient (or, indented, the offending stops)
starts; lines and columns are 1-based, columns count UTF-16 code units, and
`\r\n`, `\n` and a lone `\r` each end a line. The severity word is the rule's,
not a verdict on the file. Skipped gradients are summarised by skip code at the
end (`8 skipped (alpha 1, var 1, ...)`) and listed with `--verbose`. Notices
(skipped files, `--max-gradients`) and errors go to stderr.

## Rewriting (`--fix`, `refine --write`)

The rewrite is the same refinement as the web app's Suggest button (`refine` in
the core). It can change colours substantially, so review the diff or start with
`--dry-run`. Rules:

- Only scorable gradients whose refinement **raises** the score are rewritten.
  Skipped, legacy (`-webkit-`), radial, conic, repeating, translucent,
  `var()`/`calc()`/preprocessor gradients are never touched.
- Also left alone: gradients with hard stops (stripes), colour hints, or
  double-position stops (`red 10% 20%`); a rewrite could lose their intent.
- Only the stop arguments are replaced. Direction, `in oklch`, whitespace,
  newlines, comments and everything outside the gradient stay byte for byte;
  CRLF endings and a UTF-8 BOM are preserved. A stop whose colour and position
  do not change keeps its text.
- Rewriting repeats until the rewritten text no longer improves, so a second
  run finds nothing to do (idempotent).
- Each change is reported with the old and new score and the old and new
  gradient text.
- With `-` the rewritten text goes to stdout and the report to stderr (a filter:
  `opal42 refine --write - < in.css > out.css`). It cannot be combined with
  other paths or `--json`, except with `--dry-run`.

## JSON schema (`schemaVersion: 1`)

The key names and meanings below are the stable contract. New
optional keys may be added within version 1; removing or changing one bumps
`schemaVersion`. Paths are relative to the working directory, `/`-separated
(`<stdin>` for standard input). Ranges are half-open UTF-16 offsets into the
file text without a BOM; `loc` gives 1-based line and column, `endLine`/`endCol`
being exclusive.

```jsonc
{
  "schemaVersion": 1,
  "tool": { "name": "opal42", "version": "0.1.0" },
  "scoringModel": "v1",
  "command": "score",                  // or "refine"
  "files": [
    {
      "path": "src/a.css",
      "status": "scanned",             // "scanned" | "skipped" | "error"
      "gradients": [
        {
          "range": { "start": 17, "end": 70 },
          "loc": { "line": 3, "col": 15, "endLine": 3, "endCol": 68 },
          "kind": "linear",            // "linear" | "radial" | "conic"
          "repeating": false,
          "vendorPrefix": "-webkit-",  // only when present
          "status": "ok",              // "ok" (scored) | "skipped"
          "score": 58,                 // integer 0-100; null when skipped
          "dimensions": { "lightness": 18, "chroma": 10, "hue": 10, "spacing": 20 }, // points kept (budgets 30/20/30/20); null when skipped
          "analysis": { "hasHardStops": false },
          "issues": [
            {
              "code": "lightness/reversal",
              "severity": "error",     // "error" | "warning" | "info"
              "dimension": "lightness",
              "pointsLost": 12,
              "message": "Lightness fluctuates (1 reversal) — creates visual noise",
              "stopIndices": [2],
              "range": { "start": 62, "end": 69 },   // the offending stops
              "loc": { "line": 3, "col": 47, "endLine": 3, "endCol": 54 }
            }
          ],
          "warnings": [ { "code": "corner-angle", "message": "...", "range": {}, "loc": {} } ],
          "skipped": { "code": "var", "reason": "var() cannot be resolved statically" }, // when status is "skipped"
          "fix": {                     // only when a refinement improves the score (score --fix, refine)
            "applied": true,           // false for --dry-run and refine without --write
            "scoreBefore": 58, "scoreAfter": 90,
            "original": "linear-gradient(...)", "replacement": "linear-gradient(...)"
          }
        }
      ],
      "gradientsNotExamined": 3,       // only with --max-gradients
      "skipped": { "code": "too-large", "reason": "larger than 2 MB" },  // file status "skipped": too-large | binary | not-utf8 | ignored
      "error": { "code": "EACCES", "message": "permission denied" },     // file status "error"
      "rewritten": true                // only when --fix / --write changed the file
    }
  ],
  "summary": {
    "filesScanned": 1, "filesSkipped": 0, "filesWithErrors": 0,
    "gradients": 4, "scored": 3, "skipped": 1,
    "skippedByCode": { "var": 1 },
    "belowMinScore": 0, "minScore": null, "failOnUnscorable": false,
    "scoreMin": 58, "scoreMax": 95, "scoreMean": 80.33,   // null when nothing was scored
    "fixable": 0, "fixed": 0,
    "exitCode": 0
  }
}
```

`dimensions` keys are `lightness`, `chroma`, `hue`, `spacing` (the spec's
`rhythm` rule family is `spacing` here, as in the core API). Issue codes and
messages are those of [`spec/scoring-v1.md`](../spec/scoring-v1.md). Skip codes
are listed in [`spec/parser.md`](../spec/parser.md) plus the scorer's own
(`alpha`, `repeating`, `too-few-stops`, ...: [`spec/api.md`](../spec/api.md)).
`parse --json` has `"command": "parse"` and, per gradient, `document` (or
`null`), `stopRanges[]` and `angleRange` as `{ range, loc, text }`.
Golden outputs are in `packages/cli/tests/golden/`.

## GitHub annotations (`--format github`)

One workflow command per issue, e.g.

```
::warning file=rough.css,line=7,col=50,endLine=7,endColumn=57,title=opal42 lightness/reversal::Lightness fluctuates (1 reversal) — creates visual noise (-12 points)
```

Issues are `::warning` (`info` issues `::notice`): an annotation never fails the
step. `::error` is used only for a gradient below `--min-score`, a skipped
gradient under `--fail-on-unscorable`, and I/O problems. Skipped gradients are
`::notice` otherwise.

## Recipes

### GitHub Actions

```yaml
- uses: actions/setup-node@<sha> # pin by full SHA
  with:
    node-version: 24
- name: Gradient smoothness
  run: npx opal42 score --format github --min-score 70 src
```

Pick your own threshold; `70` is an example, not a recommendation. Drop
`--min-score` to annotate without ever failing. Once the package is published,
pin the version (`npx opal42@0.1.0`); until then build it from a checkout
(`npm run build:packages && node packages/cli/dist/cli.js ...`).

### pre-commit (local hook)

```yaml
repos:
  - repo: local
    hooks:
      - id: opal42
        name: gradient smoothness
        entry: npx opal42 score --min-score 70
        language: system
        files: \.(css|scss|sass|less|html|vue|svelte|astro|jsx|tsx|js|ts|md|mdx)$
```

pre-commit passes the changed files as arguments.

### lint-staged

```json
{
  "lint-staged": {
    "*.{css,scss,sass,less,html,vue,svelte,astro,jsx,tsx,js,mjs,ts,md,mdx}": "opal42 score --min-score 70"
  }
}
```

lint-staged appends the staged file names. To fix on commit, use
`opal42 score --fix --min-score 70` (re-stage with lint-staged's default
behaviour), after you have looked at what `--fix` does to your gradients.

### Shell

```sh
opal42 score --json src | jq '.summary'
opal42 score --quiet --min-score 70 src        # prints only failures
opal42 refine --write - < in.css > out.css
```

## Known limits

Tailwind classes and CSS-in-JS values built at run time are outside what any
text scanner sees; `var()`, `calc()`, `color-mix()`, wide-gamut colours, radial
and conic gradients are found and reported as skipped, never guessed
([`spec/parser.md`](../spec/parser.md)). The v1 score measures the stop list,
not the interpolated path.
