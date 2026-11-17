// ── v2-experimental golden file ────────────────────────────────────────────────
// Run with:  npm run vectors:v2   (= vite-node scripts/gen-vectors-v2.ts)
//
// Writes spec/vectors/v2-experimental-score.json from the CURRENT prototype.
// Deterministic (no clock, no randomness) and byte-stable. This file is a
// regression fixture of an experimental model: it is NOT a v1 vector, the v1
// generator and vectors:diff never read it, and tests/v2-experimental.test.ts
// checks that it matches the code.

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderV2Vectors } from "./v2-corpus";

const here = dirname(fileURLToPath(import.meta.url));
const file = resolve(here, "../../../spec/vectors/v2-experimental-score.json");
const text = renderV2Vectors();
writeFileSync(file, text);
console.log(`v2-experimental-score.json: ${text.split("\n").length} lines`);
