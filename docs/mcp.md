# opal42 MCP server

`opal42-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io)
server (stdio) that gives an AI agent the gradient smoothness score as tools:
score gradients, get a refinement and targeted fixes, take a colour's
complement, and draw a preview. It is a thin adapter over `@opal42/gradient`:
all scoring logic lives in the core (scoring model v1,
[`spec/scoring-v1.md`](../spec/scoring-v1.md)). The matching Agent Skill, which
tells an agent when and how to use it, is in
[`skills/gradient-quality`](../skills/README.md).

The package names are working names and **nothing is published**
([`RELEASING.md`](RELEASING.md)). `packages/mcp/package.json` is
`"private": true`, and `packages/mcp/server.json` (MCP Registry metadata) is a
draft that has not been submitted anywhere.

The number is a **smoothness score by our definition** (0-100, from published,
coded rules). It is not a quality verdict, it has not been validated against
human judgement, and there is no pass threshold ([PLAN D5](PLAN.md)).

## Privacy

The server is **stateless and local**. It runs as a child process of your MCP
client and talks to it over stdin/stdout. It makes no network requests, writes
no files, reads no files other than its own code, keeps nothing between requests
and sends no telemetry ([`PRIVACY.md`](../PRIVACY.md)). Every tool is a pure
function of its arguments: the same input gives the same output, byte for byte.
The gradients you send reach only the client process and the model it is
connected to, as with any tool call.

## Install from source

Requires Node 22 or newer and a checkout of this repository.

```sh
npm ci
npm run build:packages        # builds core, CLI and the MCP server
node packages/mcp/dist/cli.js --version
```

`node packages/mcp/dist/cli.js` (no arguments) serves the tools on
stdin/stdout. Do not run it in a terminal to "see" it; point a client at it.

## Client configuration

Use the absolute path of your checkout (shown as `/path/to/gradient-studio`).

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "opal42-gradient": {
      "command": "node",
      "args": ["/path/to/gradient-studio/packages/mcp/dist/cli.js"]
    }
  }
}
```

**Claude Code:**

```sh
claude mcp add opal42-gradient -- node /path/to/gradient-studio/packages/mcp/dist/cli.js
```

**Any stdio client**: command `node`, arguments
`["/path/to/gradient-studio/packages/mcp/dist/cli.js"]`, no environment
variables, no working directory requirement.

Once the package is published this becomes `npx -y @opal42/mcp`; it is not
published today.

## Tools

All four tools are read-only, idempotent and closed-world (`readOnlyHint`,
`idempotentHint`, `openWorldHint: false` in their annotations). Each returns
`structuredContent` (declared by an `outputSchema`) and the same JSON as a text
block. Failures are results with `isError: true` and a plain message; no tool
throws.

**Input of `score_gradient`, `refine_gradient` and `render_preview`:** either
`css` (any text containing gradient functions) or structured `stops`, never both.

| Argument | Meaning |
|---|---|
| `css` | Up to 20,000 characters. Every gradient function in it is examined, at most 32 per call (`gradientsNotExamined` counts the rest). |
| `stops` | 2-32 objects `{ color, position? }`. `color` is any supported CSS colour (hex, `rgb()`, `hsl()`, a name, `oklab()`, `oklch()`); `position` is percent, 0-100, omitted for CSS auto-spacing. One linear gradient. |
| `angle` | With `stops`: CSS degrees, default 180. |
| `interpolation` | With `stops`: `srgb` (default), `oklab` or `oklch`. Changes printed CSS and the preview, not the v1 score. |

Colours must be literal: `var()`, `calc()`, `color-mix()` and `currentColor`
are rejected in `stops` and reported as skipped in `css`.

### `score_gradient`

Scores each gradient. Per gradient: `status` (`scored` or `skipped`), `score`,
`dimensions` (points kept per dimension with its budget `of`), `issues[]` (coded
and located: `code`, `severity`, `dimension`, `pointsLost`, `message`, the
`stops` involved, `segmentPercent`, and for `css` input the source `range` and
`loc` line/column), `hasHardStops`, parser `warnings`, or `skipped`
(`code`, `reason`). Skip codes are those of [`spec/parser.md`](../spec/parser.md)
plus `alpha`, `repeating`, `too-few-stops`.

```json
{ "name": "score_gradient",
  "arguments": { "css": "a{background:linear-gradient(90deg,#ff0000,#00ff00 50%,#0000ff)}" } }
```

```json
{
  "scoringModel": "v1",
  "note": "Smoothness score under scoring model v1 (0-100), ... It is not a quality verdict and has no pass threshold; ...",
  "gradientCount": 1,
  "gradients": [{
    "index": 0, "kind": "linear",
    "css": "linear-gradient(90deg,#ff0000,#00ff00 50%,#0000ff)",
    "range": { "start": 13, "end": 63 }, "loc": { "line": 1, "col": 14 },
    "status": "scored", "score": 58,
    "dimensions": {
      "lightness": { "points": 18, "of": 30 }, "chroma": { "points": 10, "of": 20 },
      "hue": { "points": 10, "of": 30 }, "spacing": { "points": 20, "of": 20 }
    },
    "issues": [{
      "code": "lightness/reversal", "severity": "error", "dimension": "lightness",
      "pointsLost": 12, "message": "Lightness fluctuates (1 reversal) — creates visual noise",
      "stops": [{ "index": 1, "color": "#00ff00", "positionPercent": 50 }],
      "range": { "start": 43, "end": 54 }, "loc": { "line": 1, "col": 44 }
    }, "..."],
    "hasHardStops": false, "warnings": []
  }],
  "summary": { "scored": 1, "skipped": 0, "scoreMin": 58, "scoreMax": 58 }
}
```

### `refine_gradient`

Same input. For each scorable gradient it runs the one-click refinement and the
targeted fixes of the core (`refine`, `proposeFixes`). Per gradient: `before`,
and either

- `refined: true` with `after`, `refinedCss`, `refinedStops`, `changes[]` (per
  stop: `from`, `to`, and `colorShift`, the OKLAB distance of the colour
  change), `largestColorShift`, `remainingIssues` and `fixes[]`; or
- `refined: false` with `declined` (`code`, `reason`): `hard-stops`,
  `color-hints`, `no-gain`, `would-lower-score` or `single-position`.

`fixes[]` are the targeted alternatives: at most one per issue, each re-scored by
the engine, each changing only the stops the issue names (`code`, `label`,
`kind`, `gain`, `scoreBefore`, `scoreAfter`, `changedStops`, `css`).

Like the CLI's `--fix`, it leaves gradients with hard stops (stripes) and colour
hints alone, because the intent would be lost. The refinement can change colours
a lot (about 0.02 `colorShift` is barely visible, above about 0.1 is a clearly
different colour); the tool reports, the caller decides. The tool edits nothing:
it returns text.

Cost: about 1 ms for a 3-stop gradient, 3 ms for 8, 5 ms for 16 and 9 ms for 32 stops
(Node 22), and about 0.27 s for the maximum input of 32 gradients x 32 stops (it was
7 s before the fix search was made cheaper; `docs/worker.md`, "Fix search cost").

```json
{ "name": "refine_gradient",
  "arguments": { "stops": [{ "color": "#ff0000" }, { "color": "#00ff00" }, { "color": "#0000ff" }], "angle": 90 } }
```

```json
{ "gradients": [{
    "status": "scored", "before": { "score": 58 }, "refined": true, "after": { "score": 90 },
    "refinedCss": "linear-gradient(90deg, #f500a6 0%, #ff0000 50%, #7e00d0 100%)",
    "largestColorShift": 0.5198,
    "fixes": [{ "code": "lightness/reversal", "label": "Make stop 2 darker", "kind": "lightness",
                "gain": 12, "scoreBefore": 58, "scoreAfter": 70, "changedStops": [1],
                "css": "linear-gradient(90deg, #ff0000, #00a400 50%, #0000ff)" }, "..."]
}] }
```

(Abridged; the `before`/`after` objects also carry `dimensions`.)

### `complement`

`{ "color": "tomato" }` gives `{ "input": "tomato", "color": "#ff6347", "complement": "#00b0c9" }`.
The complement is the hue rotated by 180 degrees in OKLCH, gamut-fitted. Alpha is
ignored (`alphaIgnored: true` when the input had some).

### `render_preview`

`css` (with optional `index` to pick one of several gradients) or `stops`, plus
`angle`, `interpolation`, `width` and `height` (integers 16-2048, default
480 x 270). Returns two content blocks, an `image` block (`image/svg+xml`, base64)
and the SVG source as `text` (not every client renders SVG images), and
`structuredContent` with the drawn stops, `smoothnessScore` and warnings. Radial,
conic, repeating, skipped and out-of-range-position gradients are refused with a
message. `in oklab` / `in oklch` gradients are pre-sampled so the SVG (which only
interpolates in sRGB) matches the CSS. The background is transparent.

**The SVG is built from a fixed template.** The only values that reach it are
colours re-checked against `#rrggbb` (taken from the colour parser's normalised
output, never from your text) and numbers formatted as plain decimals. There is
no `<title>`, no id derived from input and no text node, so strings such as
`"><script>` cannot appear; they fail validation or are discarded. Errors that
quote input escape `<`, `>` and `&`.

## Limits

| Limit | Value |
|---|---|
| `css` length | 20,000 characters |
| Gradients examined per call | 32 |
| `stops` per gradient | 2-32 |
| Colour string | 200 characters |
| Preview size | 16-2048 px per side |
| `angle` | -3600 to 3600 degrees |

Larger input is rejected with `isError` before any work is done (gradients beyond
32 in valid `css` are counted, not scored). Radial, conic, repeating,
vendor-prefixed and translucent gradients, and anything with `var()`, `calc()` or
`color-mix()`, are reported as skipped, never guessed
([`spec/parser.md`](../spec/parser.md)). The v1 score measures the stop list,
not the interpolated path.

## Protocol support

The server is built on the official TypeScript SDK, `@modelcontextprotocol/server`
**2.4.0** (the v2 line), which implements MCP spec revision **2026-07-28**. It
serves that revision statelessly, with no `initialize` handshake: each request
names the protocol version in `_meta` (`io.modelcontextprotocol/protocolVersion`)
and `server/discover` reports `supportedVersions: ["2026-07-28"]`. It also still
accepts the older `initialize` handshake (revisions 2025-11-25 down to
2024-10-07), so current clients work. All of this is exercised by
`packages/mcp/tests/stdio.e2e.test.ts` against the built executable. See
[`packages/mcp/README.md`](../packages/mcp/README.md) for the gaps and what was
and was not verified.

The tool handlers are in `packages/mcp/src/handlers.ts`, free of the SDK and of
Node, so a stateless Worker can reuse them (`@opal42/mcp/handlers`); that Worker is built but not deployed, see [`worker.md`](worker.md).
