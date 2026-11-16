# @opal42/gradient

Deterministic smoothness score, CSS gradient parser and refiner for linear
gradients (OKLAB/OKLCH). Pure functions, zero dependencies, no I/O. Working
package name; not published yet. ESM only.

```ts
import { parseGradient, scoreParsed } from "@opal42/gradient";

const { gradients } = parseGradient("a { background: linear-gradient(red, lime, blue) }");
const result = scoreParsed(gradients[0]); // { status: "ok", score, issues, ... }
```

Subpaths: `.` (everything), `./css` (parser), `./color` (colour parse, format,
convert), `./names` (the 148 CSS colour names). See the API spec in the
repository: `spec/api.md`, `spec/parser.md`, `spec/scoring-v1.md`.
