# Exports

Gradient Studio turns one gradient into code for other tools. The generators are
in core, as the subpath `@opal42/gradient/export` (pure, no dependencies, never
throws); the web app shows them as tabs of the Export panel.

```ts
import { exportAll, toTailwind, toFigmaPaint, EXPORT_FORMATS } from "@opal42/gradient/export";

const doc = { kind: "linear", angle: 135, stops: [{ color: "#101b45" }, { color: "#9333ea" }] };
toTailwind(doc);          // { status: "ok", text, arbitrary, native, theme, utility, ... }
exportAll(doc).svg;       // { status: "ok", text: "<svg ...", language: "SVG", notes: [...] }
```

Every function returns either `{ status: "ok", text, language, notes }` (some
add fields) or `{ status: "unsupported", code, reason }`. Unsupported is a
value, not an exception: an invalid document, a non-linear kind, or a repeating
gradient for a target that has no repeating gradient. The API is in
[`spec/api.md`](../spec/api.md#export-subpath).

## Read this first: what is and is not verified

This work was done offline, in a sandbox with no devices and no design tools.

| Claim | Status |
|---|---|
| Tailwind v4 class names, defaults (`from` 0%, `via` 50%, `to` 100%) and the OKLAB default of `bg-linear-<angle>` | Read from the `tailwindcss@4.1.11` source; the arbitrary, `@theme` and `@utility` forms were also compiled with that version's compiler. Not seen in a browser. |
| SCSS compiles to the CSS shown | Compiled with `sass@1.89.0` for four fixtures. |
| CSS geometry (gradient line, corner rule) | Exact, and tested numerically against the css-images-3 definition. |
| SVG `gradientTransform` | Derived and tested numerically; not rendered in a browser. |
| SwiftUI, Compose, Flutter, Godot, Android snippets | **Untested on device.** API names are from memory of the public documentation; none was compiled. |
| How those toolkits interpolate (colour space, premultiplied alpha), whether their "perpendicular" is measured in pixels | **Not verified.** Snippets do not claim it; stops are pre-sampled instead (below). |
| Figma `gradientTransform` convention | **Derived from how gradient handles are commonly decoded; not verified against Figma.** Round-trips numerically, which proves self-consistency only. |
| DTCG gradient value shape | **Unverified against the normative text** (see below). |
| Android `<shape>` gradient behaviour for 45-degree angles in non-square views, minimum API of the vector form | **Not verified.** |
| Godot: `GradientTexture2D` linear fill measured in pixels or UV; hard stops at equal offsets | **Not verified.** |

The UI labels every native tab "Untested on device" and the generated code says
so in its first comment.

## The box assumption

A document stores a CSS angle, not a box. CSS puts the gradient line through the
centre of the box at that angle with length `|W sin a| + |H cos a|`, so the 0%
and 100% isolines touch the corners. That depends on the aspect ratio, so every
target that needs start and end points (everything except CSS-family text)
computes them for a box of aspect ratio `aspect` = width / height:

- default **square** (`aspect = 1`);
- `aspect` option on the native targets, `width`/`height` on SVG and Compose;
- the formulas are exact for that box (`cssAngleToLine`, tested so that the
  corners span exactly 0..1 for 18 angles at 6 aspect ratios).

Keyword corners (`to top right`) have no numeric angle until the box is known;
the document holds the numeric angle the parser derived (it warns
`corner-angle`). The export is that numeric angle.

## Baking, interpolation and alpha

CSS interpolates in the document's space (sRGB by default, or `in oklab` /
`in oklch`) with premultiplied alpha. The native targets and SVG, Figma and DTCG
consumers interpolate in sRGB, and which of them premultiply alpha is not
verified. So for **every non-CSS target** core pre-samples the gradient with
`bakeStops` (OKLAB/OKLCH, premultiplied) when sRGB interpolation of the given
stops would not match:

- the document interpolates in OKLAB or OKLCH, or
- its stops have different alphas.

Default is 16 stops (or twice the stop count). Only the segments that need it are
sampled (an opaque segment of a document whose last stop fades stays two stops).
`{ bake: n }` sets the number; `{ bake: 0 }` turns it off; an explicit `n` on a
document with no interpolation space samples in OKLAB (that is what asking for a
baked Figma gradient means). Every original stop is kept, so hard stops
survive. A note says what was done. Positions outside 0-1 (CSS allows them) are
clipped to the gradient line by sampling at 0 and 1.

The web app's own document has no interpolation space, and its preview is plain
sRGB CSS, so unless a stop has alpha its native exports are the stops as they
are, equal to what the preview paints.

## Formats

### CSS, CSS (OKLAB)

`CSS` is the app's exact `background` (and `background-blend-mode`), including
every direction layer. `CSS (OKLAB)` is `toCSSWithFallback`: a plain sRGB
declaration pre-sampled along OKLAB, then the `in oklab` declaration. A browser
interpolates in OKLAB **only if it supports the `in` clause**; others keep the
first declaration. The preview in the app is the plain sRGB gradient, so this tab
differs from the preview by design (same stops, same angle).

### Tailwind (`toTailwind`)

Tailwind CSS v4. Four forms in one snippet:

| Form | Exactness |
|---|---|
| `bg-[linear-gradient(...)]` (spaces as underscores) | **Exact**: it is `toCSS(doc)`. Any stops, hard stops, alpha, interpolation, repeating. |
| `bg-linear-135/srgb from-[#..] via-[#..] to-[#..]` | **Exact for two or three stops** (positions that differ from Tailwind's defaults get `from-20%`, `to-[12.5%]`, ...). The modifier pins the space: Tailwind v4's `bg-linear-<angle>` interpolates in OKLAB by default, so a document with no interpolation gets `/srgb`. A non-integer angle uses `bg-linear-[37.5deg]` (arbitrary angles take no modifier, so oklab/oklch go inside: `bg-linear-[37.5deg_in_oklab]`). Null for four or more stops, positions outside 0-100%, or repeating. Tailwind also adds an `@supports` guard that falls back to a plain angle in browsers without interpolation hints. |
| `@theme { --background-image-<name>: ... }` | Exact; used as `bg-<name>`. |
| `@utility bg-<name> { background-image: ... }` | Exact. |

`name` is reduced to `[a-z0-9-]`.

### SCSS (`toScss`)

Variables `$<name>-angle`, `$<name>-color-N`, `$<name>-position-N` and a
function-free `$<name>: linear-gradient(...)` (translucent colours use Sass's
`rgba(#hex, a)`). Repeating gradients are supported. Verified to compile.

### CSS variables (`toCssVariables`)

`--<prefix>-angle`, `--<prefix>-color-N`, `--<prefix>-position-N` and
`--<prefix>`, built from them with `var()`.

### SVG (`toSvg`)

A standalone `<svg>` with a `<linearGradient>` and a `<rect>`. The gradient is the
default (objectBoundingBox) vector from (0,0) to (1,0) with a
`gradientTransform` matrix that maps it onto the CSS gradient line, so the
isolines are perpendicular in pixels for a `width` x `height` box (default 512 x
512). It is only correct for a shape whose bounding box has that aspect ratio.
Colours are validated hex; `id` is reduced to `[A-Za-z][A-Za-z0-9_-]*`, 64
characters. Repeating is unsupported.

### SwiftUI, Compose, Flutter, Godot, Android: untested on device

- **SwiftUI**: `LinearGradient(stops:startPoint:endPoint:)` with
  `Gradient.Stop(color: Color(.sRGB, ...), location:)` and `UnitPoint`s.
- **Compose**: `Brush.linearGradient(colorStops, start, end)` with pixel offsets of
  a reference box (default 1000 x 1000), plus a size-independent `ShaderBrush`
  that recomputes the CSS gradient line from the angle for any size.
- **Flutter**: `LinearGradient(begin, end, colors, stops)`; `Alignment` by
  default, `FractionalOffset` with `alignment: "fractionalOffset"`.
- **Godot 4**: GDScript with `Gradient.offsets` / `colors` and a
  `GradientTexture2D` linear fill between two points, plus the Gradient as a
  `.tres` resource. The interpolation mode is left at its default.
- **Android**: `<shape><gradient>` with `startColor`/`centerColor`/`endColor`
  only for two or three stops at 0 (, 50%) and 100% and an angle that is a
  multiple of 45 (`android:angle` = 90 − CSS angle). Anything else returns a
  `VectorDrawable` with a gradient fill (`variant: "vector"`), which holds any
  stops and angle. The `<shape>` form cannot, which is the documented fallback.

### DTCG (`toDtcg`): unverified against the normative text

The W3C Design Tokens Format Module 2025.10 text was not available offline. The
output is the commonly implemented shape, written from memory:

```json
{ "gradient": { "$type": "gradient",
  "$value": [ { "color": { "colorSpace": "srgb", "components": [r, g, b], "alpha": 1, "hex": "#rrggbb" }, "position": 0 }, ... ],
  "$extensions": { "io.github.lightseek3r.gradient-studio": { "angle": 135 } } } }
```

`position` is 0-1. `colorFormat: "hex"` gives hex strings for older tools. DTCG
gradients carry no angle (as far as the writer remembers), so the angle and
interpolation travel in a vendor `$extensions` entry. Check the spec before
depending on it: the tests only check that the output is valid JSON of this
shape, and mark it so.

### Figma (`toFigmaPaint`, `fromFigmaPaint`, `angleToFigmaTransform`)

`GRADIENT_LINEAR` paint: `gradientStops` with RGBA 0-1, `gradientTransform`, and
`opacity`, `visible`, `blendMode` defaults. Figma has no OKLCH or OKLAB
interpolation, so an OKLAB/OKLCH document is baked (`bake`) and the render
approximates it.

Matrix convention, **derived, not verified against Figma**: a 2x3 affine matrix
`[[a, c, e], [b, d, f]]` (the Figma `Transform` type has two rows of three; it is
sometimes called 3x2 by column count) that maps a point of the node's unit box
(x right, y down) into gradient space, where the gradient runs along x from 0 to 1
at y = 0.5. The identity is therefore left to right, and the handles are
`inverse(M) * (0, .5)` and `inverse(M) * (1, .5)`. `angleToFigmaTransform(angle,
aspect)` builds it; `figmaTransformToAngle` inverts it; `fromFigmaPaint` reads a
paint back into a document (a paint `opacity` below 1 multiplies the stop alphas).
Tests round-trip 18 angles at 6 aspects within 1e-6 and check that the matrix
sends every pixel to its CSS gradient position. That proves the algebra is
self-consistent, not that Figma reads it this way: try one paint in a real file.

## Web app

The Export panel has one tab per format (a keyboard-operable tablist: arrows,
Home, End). Each has a Copy button (announced as "<format> copied to clipboard"),
a language label and wrapped code. The CSS tab is the app's own output and the
only one that can express more than one direction layer or a blend. Every other
tab exports the **base gradient**: the same stops at the first enabled
direction's angle, with a visible note naming how many directions are layered
when there is more than one. While the Suggested view is on, the panel is titled
"Suggested export" and every tab exports the suggestion shown in the preview.
Native tabs carry an "Untested on device" badge.
