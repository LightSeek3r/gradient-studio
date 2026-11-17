// Curated inputs for spec/vectors/v2-experimental-score.json (v2-experimental
// regression fixture; NOT part of the v1 vectors, NOT read by vectors:diff).
// Shared by scripts/gen-vectors-v2.ts and tests/v2-experimental.test.ts.

import type { GradientDocument, Interpolation } from "../src/api/types";
import { scoreV2, type ScoreResultV2, type ScoreV2Options } from "../src/experimental/v2";

export interface V2Input {
  name: string;
  doc: GradientDocument;
}

const lin = (colors: string[], positions?: number[]): GradientDocument => ({
  kind: "linear",
  angle: 90,
  stops: colors.map((color, i) => ({ color, position: positions ? positions[i] : i / (colors.length - 1) })),
});

export const V2_CORPUS: V2Input[] = [
  { name: "pair red-green", doc: lin(["#ff0000", "#00ff00"]) },
  { name: "pair red-blue", doc: lin(["#ff0000", "#0000ff"]) },
  { name: "pair blue-yellow", doc: lin(["#0000ff", "#ffff00"]) },
  { name: "pair black-white", doc: lin(["#000000", "#ffffff"]) },
  { name: "pair blue-white", doc: lin(["#0000ff", "#ffffff"]) },
  { name: "pair yellow-blue", doc: lin(["#ffff00", "#0000ff"]) },
  { name: "pair 300deg (h20, h320)", doc: lin(["#db6468", "#b76ec7"]) },
  { name: "grey to red", doc: lin(["#808080", "#ff0000"]) },
  { name: "off-white to blue", doc: lin(["#faf8f5", "#0000ff"]) },
  { name: "red grey blue", doc: lin(["#ff0000", "#808080", "#0000ff"]) },
  { name: "rgb rainbow 3", doc: lin(["#ff0000", "#00ff00", "#0000ff"]) },
  { name: "sunset 3", doc: lin(["#f97316", "#db2777", "#7c3aed"]) },
  { name: "ocean 2", doc: lin(["#0ea5e9", "#1e3a8a"]) },
  { name: "mint 2", doc: lin(["#a7f3d0", "#047857"]) },
  { name: "pastel 6", doc: lin(["#fbcfe8", "#fde68a", "#bbf7d0", "#bfdbfe", "#ddd6fe", "#fecaca"]) },
  { name: "navy banding", doc: lin(["#112233", "#1a2b3b"]) },
  { name: "dark slate", doc: lin(["#1e293b", "#0f172a"]) },
  { name: "near-identical", doc: lin(["#336699", "#346699"]) },
  { name: "hard stop pair", doc: lin(["#ff0000", "#ff0000", "#0000ff", "#0000ff"], [0, 0.5, 0.5, 1]) },
  { name: "all at one position", doc: lin(["#ff0000", "#00ff00", "#0000ff"], [0.3, 0.3, 0.3]) },
  { name: "lightness dip", doc: lin(["#e0e7ff", "#1e1b4b", "#c7d2fe"]) },
  { name: "edge gap", doc: lin(["#ff0000", "#0000ff"], [0.06, 0.94]) },
  { name: "uneven gaps", doc: lin(["#ef4444", "#f59e0b", "#10b981"], [0, 0.1, 1]) },
  { name: "8 stop hue wheel", doc: lin(["#ff0000", "#ff8800", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#8800ff", "#ff00ff"]) },
  { name: "auto positions", doc: { kind: "linear", angle: 180, stops: [{ color: "#4f46e5" }, { color: "#06b6d4" }, { color: "#22c55e" }] } },
];

export const V2_CONFIGS: { key: string; opts: ScoreV2Options }[] = [
  { key: "srgb", opts: { interpolation: { space: "srgb" } } },
  { key: "oklab", opts: { interpolation: { space: "oklab" } } },
  { key: "oklch", opts: { interpolation: { space: "oklch" } } },
  { key: "oklch-longer", opts: { interpolation: { space: "oklch", hue: "longer" } as Interpolation } },
  { key: "oklch-clip", opts: { interpolation: { space: "oklch" }, gamutMapping: "clip" } },
];

/** Documents outside the prototype's domain, with the expected unscorable code. */
export const V2_UNSCORABLE: { name: string; doc: unknown; code: string }[] = [
  { name: "translucent stop", doc: { kind: "linear", angle: 90, stops: [{ color: "#ff0000", alpha: 0.5 }, { color: "#0000ff" }] }, code: "alpha" },
  { name: "radial", doc: { kind: "radial", angle: 0, stops: [{ color: "#ff0000" }, { color: "#0000ff" }] }, code: "unsupported-kind" },
  { name: "repeating", doc: { kind: "linear", angle: 0, repeating: true, stops: [{ color: "#ff0000" }, { color: "#0000ff" }] }, code: "repeating" },
  { name: "one stop", doc: { kind: "linear", angle: 0, stops: [{ color: "#ff0000" }] }, code: "too-few-stops" },
  { name: "named colour", doc: { kind: "linear", angle: 0, stops: [{ color: "red" }, { color: "#0000ff" }] }, code: "invalid-color" },
  { name: "position out of range", doc: { kind: "linear", angle: 0, stops: [{ color: "#ff0000", position: -0.2 }, { color: "#0000ff" }] }, code: "position-range" },
  { name: "NaN position", doc: { kind: "linear", angle: 0, stops: [{ color: "#ff0000", position: Number.NaN }, { color: "#0000ff" }] }, code: "invalid-position" },
  { name: "not a document", doc: null, code: "invalid-document" },
  { name: "bad space", doc: { kind: "linear", angle: 0, interpolation: { space: "hsl" }, stops: [{ color: "#ff0000" }, { color: "#0000ff" }] }, code: "invalid-document" },
];

const r6 = (x: number): number => Math.round(x * 1e6) / 1e6;

function roundDeep(v: unknown): unknown {
  if (typeof v === "number") return Number.isFinite(v) ? r6(v) : null;
  if (Array.isArray(v)) return v.map(roundDeep);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, roundDeep(x)]));
  return v;
}

/** The serialisable record of one scoreV2 result (numbers rounded to 1e-6). */
export function recordV2(result: ScoreResultV2): Record<string, unknown> {
  if (result.status !== "ok") return { status: result.status, code: result.code };
  return {
    status: "ok",
    score: result.score,
    dimensions: result.dimensions,
    issues: result.issues.map((i) => ({ code: i.code, pointsLost: i.pointsLost, stopIndices: i.stopIndices ?? null, segment: i.segment ? roundDeep(i.segment) : null })),
    hasHardStops: result.analysis.hasHardStops,
    measurements: roundDeep(result.measurements),
  };
}

export function v2Cases(): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const input of V2_CORPUS) {
    for (const cfg of V2_CONFIGS) {
      out.push({ name: input.name, config: cfg.key, stops: input.doc.stops, ...recordV2(scoreV2(input.doc, cfg.opts)) });
    }
  }
  for (const u of V2_UNSCORABLE) {
    out.push({ name: u.name, config: "default", ...recordV2(scoreV2(u.doc as GradientDocument)) });
  }
  return out;
}

export function renderV2Vectors(): string {
  const meta = {
    vectorVersion: 1,
    kind: "score",
    scoringModel: "v2-experimental",
    note: "EXPERIMENTAL regression fixture of scoreV2 (packages/core/src/experimental/v2.ts, spec/scoring-v2.md). NOT a contract, NOT part of the v1 vector set, NOT compared by vectors:diff. Regenerate with `npm run vectors:v2 -w @opal42/gradient`. Numbers rounded to 1e-6.",
  };
  const header = Object.entries(meta)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join("\n");
  const body = v2Cases()
    .map((c) => "    " + JSON.stringify(c))
    .join(",\n");
  return `{\n${header}\n  "cases": [\n${body}\n  ]\n}\n`;
}
