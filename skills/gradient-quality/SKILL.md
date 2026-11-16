---
name: gradient-quality
description: Score and, where it keeps the intent, fix CSS gradients before you emit them. Use whenever you are about to write, edit or review a CSS linear-gradient (backgrounds, hero sections, buttons, themes, design tokens, Tailwind arbitrary values). Run the opal42 CLI or the score_gradient MCP tool, read the coded issues (muddy sRGB midpoints, wide hue arcs, lightness reversals, bunched stops), and fix only what is unintentional. The number is a smoothness score by a published definition, not a quality verdict.
license: MIT
compatibility: Needs Node 22+ to run the opal42 CLI (npx opal42) or the opal42-mcp server. Local only; no network access and no telemetry.
metadata:
  scoring-model: v1
---

# Gradient smoothness check

Use this before you hand back any CSS gradient, and when reviewing one. The
tools are deterministic and local: the same gradient always gets the same score
and the same coded issues.

**The score is a smoothness score by our definition** (0-100, scoring model v1,
rules in `spec/scoring-v1.md`). It is not a quality or taste verdict, it has not
been validated against human judgement, and **there is no pass threshold**. Do
not invent one ("anything over some number is fine" is wrong), and do not describe a gradient as
"good", "bad" or "passing" because of it. Say what the issues are and what you
did about them.

## 1. Score it

Pick whichever is available.

- **CLI** (reads stdin, any text containing gradients):
  `echo 'background: linear-gradient(90deg, #ff0000, #00ff00 50%, #0000ff)' | npx opal42 score --json -`
  Read `files[0].gradients[]`: `status`, `score`, `dimensions`, `issues[]`
  (`code`, `severity`, `pointsLost`, `message`, `stopIndices`, `range`), or `skipped.code`.
  From a checkout of the repository: `node packages/cli/dist/cli.js score --json -`.
- **MCP**: the `score_gradient` tool (`css` text, or structured `stops`).
  Same data: `gradients[].score`, `.dimensions`, `.issues[]` with `stops` and `range`.

The package names are working names and nothing is published yet; see
`docs/cli.md` and `docs/mcp.md` for running from a checkout.

If a gradient comes back **skipped** (`var()`, `calc()`, `color-mix()`, alpha or
`transparent`, radial, conic, repeating, vendor-prefixed) it was not judged.
Say "not scored: <code>", never guess a score. Fades to `transparent` are a
common, legitimate pattern; leave them alone.

## 2. Read the issues

Each issue has a stable `code` (`dimension/rule`), a `severity`, the points it
cost and the stops it concerns. The severity word is the rule's, not a verdict
on the design: `error` = a large deduction (12+ points), `warning` = 6-10,
`info` = 5 or fewer. The full list with one-line fixes is in
[references/issue-codes.md](references/issue-codes.md); the four anti-patterns
you will meet most are in [references/anti-patterns.md](references/anti-patterns.md).

**Default aim (when the user or project has set no `--min-score`):** remove the
`error` and `warning` findings that are *not intentional*. Leave `info` findings
alone unless the fix is free. If the user or the project does set a minimum
score, use theirs and nothing else.

## 3. Fix with the least change

1. Prefer the **targeted fixes** (`refine_gradient` → `gradients[].fixes[]`,
   at most one per issue, each re-scored, each editing only the stops the issue
   names) over the one-click refinement.
2. Use the one-click refinement (`refinedCss`; the CLI's `npx opal42 refine -`
   only shows it and changes nothing) only when several issues interact. It can recolour stops
   heavily (it pulls every hue into an 80 degree arc and re-spaces the stops).
3. **Check what changed before you use it.** Each change carries `colorShift`,
   an OKLAB distance; `largestColorShift` is the biggest. Rule of thumb: about
   0.02 is barely visible, above about 0.1 is a clearly different colour.
   - If the user gave you brand or token colours, do not change them silently.
     Keep those stops, fix the other stops, positions or interpolation, or
     **ask** / flag the trade-off ("the muddy midpoint comes from green to magenta;
     fixing it means changing the green").
   - If a fix changes a colour a lot, show the before and after and say so.
4. The score models the **stop list**, not the interpolated path. Writing
   `in oklab` or `in oklch` makes the browser blend better, but v1 still reports
   `chroma/muddy-midpoint` because it measures the sRGB midpoint. Say that
   rather than hunting for a score change. Do add the clause when it suits the
   target browsers and the design.
5. Re-score after you edit. Keep the fix only if the score did not drop and the
   design intent survived.

## 4. Leave alone, and say so

- **Hard stops** (stripes, `red 50%, blue 50%`) and **colour hints**: the tools
  decline to refine them. They are usually the point of the gradient.
- Deliberate effects: a rainbow, a high-contrast duotone, a vignette. Keep them,
  list the findings that remain and why they are intentional.
- Anything skipped.

## 5. Report briefly

For each gradient you touched: score before and after, the codes you removed,
the codes you kept and why, and any colour you changed (with `colorShift` when
it is large). One short paragraph; no verdict words.

## Do not

- Treat the score as a gate or a grade unless the user asked for a threshold.
- Claim the score measures beauty, accessibility or contrast with text. It
  measures lightness flow, hue travel, chroma and stop spacing only.
- Call the network, install anything, or publish. Both tools are read-only.
- Rewrite gradients the tools skipped, or hard-stop/hint gradients, to raise a number.
