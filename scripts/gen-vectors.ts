// ── Characterisation-vector generator ──────────────────────────────────────────
// Run with:  npm run vectors      (= vite-node scripts/gen-vectors.ts)
//
// vite-node (bundled with Vitest's toolchain) is used because color-formats.ts
// imports "./gradient-engine" without an extension, which bare Node cannot
// resolve. Works offline; no network, no clock, no Math.random: the corpus is
// hand-picked cases plus a fixed-seed PRNG, so output is byte-for-byte stable.
//
// IMPORTANT: run this only against an engine whose behaviour you intend to
// freeze as the reference. Regenerating after a deliberate behaviour change
// is a reviewed, intentional act: run `npm run vectors:diff` afterwards and
// account for every changed case (spec/vectors/CHANGES-v1.md).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evalColor,
  evalCss,
  evalFindings,
  evalInterpolate,
  evalScore,
  evalSuggest,
  mulberry32,
  spreadDirectionAngles,
  type ColorCase,
  type Stop,
} from "./vector-lib";
import type { GradientBlendMode, GradientDirection } from "../src/gradient-engine";

// ── Corpus ────────────────────────────────────────────────────────────────────

interface NamedGradient {
  name: string;
  stops: Stop[];
}

/** Build stops with ids 1..n from `[color, position]` pairs. */
function g(name: string, pairs: [string, number][]): NamedGradient {
  return { name, stops: pairs.map(([color, position], i) => ({ id: i + 1, color, position })) };
}

/** Evenly spaced stops across 0..100. */
function even(name: string, colors: string[]): NamedGradient {
  const n = colors.length;
  return g(
    name,
    colors.map((c, i) => [c, Math.round((i / (n - 1)) * 100)] as [string, number]),
  );
}

function handPicked(): NamedGradient[] {
  const out: NamedGradient[] = [];

  // Classic pairs
  out.push(even("pair red-blue", ["#ff0000", "#0000ff"]));
  out.push(even("pair red-green", ["#ff0000", "#00ff00"]));
  out.push(even("pair blue-yellow", ["#0000ff", "#ffff00"]));
  out.push(even("pair black-white", ["#000000", "#ffffff"]));
  out.push(even("pair white-black", ["#ffffff", "#000000"]));
  out.push(even("pair orange-purple", ["#ffa500", "#800080"]));
  out.push(even("pair cyan-magenta", ["#00ffff", "#ff00ff"]));
  out.push(even("pair sunset", ["#ff512f", "#dd2476"]));
  out.push(even("pair ocean", ["#2193b0", "#6dd5ed"]));
  out.push(even("pair peach", ["#ed4264", "#ffedbc"]));
  out.push(even("pair mint", ["#00b09b", "#96c93d"]));
  out.push(even("pair royal", ["#141e30", "#243b55"]));
  out.push(even("pair lavender", ["#c471f5", "#fa71cd"]));
  out.push(even("pair fire", ["#f12711", "#f5af19"]));
  out.push(even("pair forest", ["#134e5e", "#71b280"]));
  out.push(even("pair css names", ["#ff6347", "#4682b4"]));

  // Rainbow / many stops
  out.push(even("rainbow 7", ["#ff0000", "#ff7f00", "#ffff00", "#00ff00", "#0000ff", "#4b0082", "#9400d3"]));
  out.push(even("rainbow 6", ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff"]));
  out.push(even("sunset 3", ["#ff512f", "#dd2476", "#4a00e0"]));
  out.push(even("aurora 4", ["#00c9ff", "#92fe9d", "#fcff9e", "#ff7eb3"]));
  out.push(even("spectrum 5", ["#2b5876", "#4e4376", "#7f5a83", "#a77693", "#d8a7b1"]));

  // Near-identical stops
  out.push(even("identical", ["#336699", "#336699"]));
  out.push(even("off by 1", ["#336699", "#346699"]));
  out.push(even("off by 5", ["#336699", "#386b9e"]));
  out.push(even("off by 12", ["#336699", "#3f72a8"]));
  out.push(even("near-white pair", ["#ffffff", "#fafafa"]));
  out.push(even("near-black pair", ["#000000", "#050505"]));
  out.push(even("identical 3", ["#808080", "#808080", "#808080"]));

  // Dark -> light
  out.push(even("dark to light blue", ["#0a0f2c", "#8ec5ff"]));
  out.push(even("dark to light 3", ["#0b0b12", "#4a5fc1", "#e8eeff"]));
  out.push(even("dark to light warm", ["#1a0500", "#c2410c", "#fff1e6"]));
  out.push(even("light to dark 4", ["#f8fafc", "#94a3b8", "#475569", "#0f172a"]));

  // Greys
  out.push(even("grey ramp 3", ["#000000", "#808080", "#ffffff"]));
  out.push(even("grey ramp 5", ["#111111", "#444444", "#777777", "#aaaaaa", "#eeeeee"]));
  out.push(even("red grey green", ["#ff0000", "#808080", "#00ff00"]));
  out.push(even("red grey blue", ["#ff0000", "#808080", "#0000ff"]));
  out.push(even("blue dark-grey orange", ["#1d4ed8", "#303030", "#f97316"]));
  out.push(even("grey ends vivid middle", ["#666666", "#ff3366", "#999999"]));
  out.push(even("near-grey tinted", ["#808080", "#7f8082"]));
  out.push(even("grey-light grey", ["#cccccc", "#eeeeee"]));

  // Two stops at the same position / hard stops
  out.push(g("same position 50/50", [["#ff0000", 50], ["#0000ff", 50]]));
  out.push(g("same position 0/0", [["#ff0000", 0], ["#0000ff", 0]]));
  out.push(g("same position 100/100", [["#ff0000", 100], ["#0000ff", 100]]));
  out.push(g("hard stop mid", [["#ff0000", 0], ["#ff0000", 50], ["#0000ff", 50], ["#0000ff", 100]]));
  out.push(g("stripes 5", [["#1d4ed8", 0], ["#1d4ed8", 20], ["#f59e0b", 20], ["#f59e0b", 40], ["#10b981", 40], ["#10b981", 60], ["#ec4899", 60], ["#ec4899", 100]]));
  out.push(g("duplicate position among 3", [["#ff0000", 0], ["#00ff00", 50], ["#0000ff", 50]]));
  out.push(g("all three same position", [["#ff0000", 30], ["#00ff00", 30], ["#0000ff", 30]]));

  // Unsorted stops
  out.push(g("unsorted 3", [["#0000ff", 100], ["#ff0000", 0], ["#00ff00", 50]]));
  out.push(g("unsorted 4", [["#ffff00", 75], ["#ff0000", 0], ["#0000ff", 100], ["#00ff00", 25]]));
  out.push(g("unsorted reversed", [["#0000ff", 100], ["#ff0000", 0]]));
  out.push(g("unsorted 5", [["#f97316", 60], ["#1d4ed8", 0], ["#ec4899", 90], ["#10b981", 30], ["#facc15", 100]]));

  // 2..10 stops, evenly spaced, hue sweep through OKLCH-ish steps
  const sweep = ["#ff0000", "#ff8000", "#ffff00", "#80ff00", "#00ff00", "#00ff80", "#00ffff", "#0080ff", "#0000ff", "#8000ff"];
  for (let n = 2; n <= 10; n++) out.push(even(`sweep ${n} stops`, sweep.slice(0, n)));
  const pastel = ["#fbcfe8", "#fde68a", "#bbf7d0", "#bfdbfe", "#ddd6fe", "#fecaca", "#fed7aa", "#a7f3d0", "#c7d2fe", "#e9d5ff"];
  for (let n = 2; n <= 10; n++) out.push(even(`pastel ${n} stops`, pastel.slice(0, n)));

  // Positions not spanning 0-100
  out.push(g("narrow 20/80", [["#ff0000", 20], ["#0000ff", 80]]));
  out.push(g("narrow 10/60", [["#ff0000", 10], ["#0000ff", 60]]));
  out.push(g("narrow 40/60", [["#ff0000", 40], ["#0000ff", 60]]));
  out.push(g("narrow 0/30", [["#ff0000", 0], ["#0000ff", 30]]));
  out.push(g("narrow 70/100", [["#ff0000", 70], ["#0000ff", 100]]));
  out.push(g("narrow 45/55", [["#ff0000", 45], ["#0000ff", 55]]));
  out.push(g("narrow 3 stops 20/50/80", [["#ff0000", 20], ["#00ff00", 50], ["#0000ff", 80]]));
  out.push(g("narrow 3 stops 10/30/90", [["#ff0000", 10], ["#ffff00", 30], ["#0000ff", 90]]));
  out.push(g("narrow 4 stops 15/35/65/85", [["#f97316", 15], ["#ec4899", 35], ["#8b5cf6", 65], ["#0ea5e9", 85]]));
  out.push(g("edge gap 12", [["#ff0000", 6], ["#0000ff", 94]]));
  out.push(g("edge gap 15", [["#ff0000", 5], ["#0000ff", 90]]));
  out.push(g("span 30", [["#ff0000", 0], ["#0000ff", 30]]));
  out.push(g("span 35 centred", [["#ff0000", 32], ["#0000ff", 67]]));
  out.push(g("fractional positions", [["#ff0000", 0.5], ["#00ff00", 33.3], ["#0000ff", 99.9]]));

  // Hue geometry: wraparound, opposed hues, tight arcs, reversals
  out.push(even("hue 359 -> 1 (red)", ["#ff0005", "#ff0a00"]));
  out.push(even("hue wrap magenta-orange", ["#ff00aa", "#ff6a00"]));
  out.push(even("hue wrap 3 stops", ["#ff0033", "#ff0000", "#ff3300"]));
  out.push(even("opposed hues red-cyan", ["#ff0000", "#00ffff"]));
  out.push(even("opposed hues 3", ["#ff0000", "#00ffff", "#ff0000"]));
  out.push(even("opposed hues 4", ["#ff0000", "#00ff00", "#00ffff", "#ff00ff"]));
  out.push(even("tight arc blues", ["#1e40af", "#1d4ed8", "#2563eb"]));
  out.push(even("tight arc 2", ["#3b82f6", "#2563eb"]));
  out.push(even("hue zigzag", ["#ff0000", "#0000ff", "#ff0000", "#0000ff"]));
  out.push(even("hue reversal 4", ["#ff0000", "#ffff00", "#00ff00", "#ffff00"]));
  out.push(even("wide arc 150", ["#ff0000", "#00ff80"]));
  out.push(even("wide arc 100", ["#ff7700", "#00cc88"]));

  // Lightness patterns
  out.push(even("L reversal dip", ["#e0e7ff", "#1e1b4b", "#c7d2fe"]));
  out.push(even("L reversal peak", ["#1e1b4b", "#e0e7ff", "#312e81"]));
  out.push(even("H-K wobble", ["#808080", "#ff0066", "#9a9a9a"]));
  out.push(even("monotone vivid", ["#7f1d1d", "#dc2626", "#fca5a5"]));

  // Uneven spacing / velocity
  out.push(g("clustered 4", [["#ff0000", 0], ["#ff8800", 5], ["#ffff00", 10], ["#0000ff", 100]]));
  out.push(g("uneven rhythm mild", [["#ff0000", 0], ["#ffaa00", 40], ["#00aaff", 60], ["#0000ff", 100]]));
  out.push(g("abrupt jump 5%", [["#000000", 0], ["#ffffff", 5], ["#888888", 100]]));
  out.push(g("abrupt jump 10%", [["#ff0000", 0], ["#0000ff", 10], ["#00ff00", 100]]));
  out.push(g("abrupt jump 11%", [["#ff0000", 0], ["#0000ff", 11], ["#00ff00", 100]]));

  // Chroma
  out.push(even("saturation spike", ["#808080", "#ff0000"]));
  out.push(even("chroma coherence", ["#ff0000", "#999999", "#0000ff"]));
  out.push(even("muddy midpoint", ["#00ff00", "#ff00ff"]));
  out.push(even("muddy midpoint blue-yellow", ["#0000ff", "#ffff00"]));
  out.push(even("low contrast banding", ["#112233", "#1a2b3b"]));
  out.push(even("subtle banding 3", ["#223344", "#2a3b4c", "#334455"]));
  out.push(even("black white black", ["#000000", "#ffffff", "#000000"]));

  return out;
}

function randomHex(rand: () => number): string {
  const byte = () => Math.floor(rand() * 256);
  return "#" + [byte(), byte(), byte()].map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** Seeded pseudo-random gradients: 2..10 stops, varied spacing and ordering. */
function seededRandom(count: number, seed: number): NamedGradient[] {
  const rand = mulberry32(seed);
  const out: NamedGradient[] = [];
  for (let k = 0; k < count; k++) {
    // Skew towards 2..5 stops, which is what people actually build.
    const n = rand() < 0.6 ? 2 + Math.floor(rand() * 4) : 2 + Math.floor(rand() * 9);
    const style = rand();
    const pairs: [string, number][] = [];
    const positions: number[] = [];
    if (style < 0.35) {
      for (let i = 0; i < n; i++) positions.push(Math.round((i / (n - 1)) * 100));
    } else if (style < 0.75) {
      positions.push(0, 100);
      while (positions.length < n) positions.push(Math.round(rand() * 100));
    } else {
      const lo = Math.round(rand() * 40);
      const hi = 100 - Math.round(rand() * 40);
      positions.push(lo, hi);
      while (positions.length < n) positions.push(lo + Math.round(rand() * (hi - lo)));
    }
    positions.sort((a, b) => a - b);
    // A fifth of the cases are handed over in shuffled (unsorted) order.
    const shuffled = rand() < 0.2;
    if (shuffled) {
      for (let i = positions.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [positions[i], positions[j]] = [positions[j], positions[i]];
      }
    }
    for (let i = 0; i < n; i++) pairs.push([randomHex(rand), positions[i]]);
    out.push(g(`random #${k + 1} (n=${n}${shuffled ? ", shuffled" : ""})`, pairs));
  }
  return out;
}

/**
 * Cases added with the pre-freeze defect fixes. They are appended AFTER the
 * random corpus so the original cases keep their index (the CSS vectors pick
 * angle/direction/blend by index).
 */
function defectCases(): NamedGradient[] {
  return [
    // D1: outside the v1 domain
    g("D1 invalid #zzzzzz", [["#zzzzzz", 0], ["#ffffff", 100]]),
    g("D1 invalid shorthand #abc", [["#abc", 0], ["#ff0000", 100]]),
    g("D1 invalid empty colour", [["", 0], ["#00ff00", 100]]),
    g("D1 invalid both colours", [["#zzzzzz", 0], ["#abc", 100]]),
    g("D1 invalid alpha #rrggbbaa", [["#ff000080", 0], ["#0000ff", 100]]),
    g("D1 invalid name 'red'", [["red", 0], ["#0000ff", 100]]),
    g("D1 invalid among valid", [["#ff0000", 0], ["#zzzzzz", 50], ["#0000ff", 100]]),
    g("D1 position above 100", [["#ff0000", 0], ["#0000ff", 150]]),
    g("D1 position below 0", [["#ff0000", -5], ["#0000ff", 100]]),
    g("D1 single stop", [["#ff8800", 50]]),
    // Domain edge: upper-case hex is valid
    g("domain upper-case hex", [["#FF0000", 0], ["#0000FF", 100]]),
    // D5: hard stops a fraction of a percent apart; grey among vivid
    g("D5 hard stop 0.5% apart", [["#1d4ed8", 0], ["#1d4ed8", 50], ["#f59e0b", 50.5], ["#f59e0b", 100]]),
    g("D5 grey middle among warm", [["#ff512f", 0], ["#808080", 50], ["#f5af19", 100]]),
    // D6: unsorted with a tie (tie order is array order)
    g("D6 unsorted with tie", [["#0000ff", 100], ["#ff0000", 50], ["#00ff00", 50], ["#ffff00", 0]]),
    // D7: opposed hues, balanced
    even("D7 opposed 4 balanced", ["#ff0000", "#00ffff", "#ff0000", "#00ffff"]),
  ];
}

function buildCorpus(): NamedGradient[] {
  const corpus = [...handPicked(), ...seededRandom(190, 0x6d5a3f21), ...defectCases()];
  return corpus;
}

// ── Direction / blend rotations for the CSS vectors ───────────────────────────

const ANGLES = [0, 45, 90, 135, 180, 225, 270, 315, 17, 360, -30];

function dirs(angles: number[], weights: number[], enabled?: boolean[]): GradientDirection[] {
  return angles.map((angle, i) => ({
    id: i + 1,
    angle,
    weight: weights[i] ?? 50,
    enabled: enabled?.[i] ?? true,
  }));
}

const DIRECTION_SETS: GradientDirection[][] = [
  dirs([135], [50]),
  dirs([90, 180], [50, 50]),
  dirs([0, 120, 240], [100, 50, 25]),
  dirs(spreadDirectionAngles(4), [10, 20, 30, 40]),
  dirs([45, 135, 225, 315], [50, 50, 50, 50], [true, false, true, true]),
  dirs([30, 60], [0, 40]),
  dirs([30, 60], [10, 20], [false, false]),
  dirs(spreadDirectionAngles(7), [1, 100, 3, 77, 5, 33, 99]),
  dirs([135, 135.5], [33, 67]),
];

const BLENDS: GradientBlendMode[] = [
  "normal",
  "screen",
  "multiply",
  "overlay",
  "soft-light",
  "hard-light",
  "difference",
  "lighten",
  "darken",
];

// ── Colour inputs ─────────────────────────────────────────────────────────────

function colorInputs(): { kind: ColorCase["kind"]; input: unknown }[] {
  const out: { kind: ColorCase["kind"]; input: unknown }[] = [];

  const hexes = [
    "#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff",
    "#808080", "#7f7f7f", "#818181", "#010101", "#fefefe", "#c0c0c0", "#404040",
    "#ff6347", "#4682b4", "#663399", "#ffa500", "#2e8b57", "#dc143c", "#708090",
    "#123456", "#abcdef", "#fedcba", "#0a0a0a", "#f5f5f5", "#8a2be2", "#ff1493",
    "#1e90ff", "#ffd700", "#a52a2a", "#00fa9a", "#e6e6fa", "#191970", "#556b2f",
    "#ff0005", "#ff0a00", "#7f8082", "#335577",
  ];
  for (const hex of hexes) out.push({ kind: "hex", input: hex });

  const strings = [
    // hex shapes
    "#fff", "#FFF", "fff", "#ffff", "#abcdef", "ABCDEF", "#abcdef80", "#12345678", "  #123456  ",
    "#12", "#12345", "#1234567", "#ggg", "",
    // rgb
    "rgb(255, 0, 0)", "rgb(255 0 0 / 50%)", "rgba(1,2,3,.5)", "rgb(100%, 50%, 0%)", "rgb(300, -5, 128)",
    "rgb(1.5, 2.5, 3.5)", "255, 128, 0", "12 34 56", "rgb(1, 2)", "rgb()",
    // hsl
    "hsl(210, 50%, 40%)", "hsl(210deg 50% 40% / 80%)", "hsla(0, 100%, 50%, .3)", "hsl(0.5turn 100% 50%)",
    "hsl(3.14159rad 100% 50%)", "hsl(200grad 100% 50%)", "hsl(360, 100%, 50%)", "hsl(-30, 100%, 50%)",
    "hsl(120, 0.5, 0.5)", "hsl(120, 1, 1)", "hsl(120, 2, 50)", "hsl(120, 0, 0)", "210 50 40", "210 50% 40%",
    "hsl(120, 100%)",
    // names
    "red", "Red", "RED", "rebeccapurple", "~tomato", "nearest: teal", "nearest:teal", "dark blue", "dark_blue",
    "dark-blue", "grey", "gray", "cyan", "aqua", "notacolor", "transparent",
    // anyColor extras
    "linear-gradient(red, blue)", "#fff #000", "rgb(1,2,3) rgb(4,5,6)", "hello", "1", "1 2", "12abc", "50% 20% 100%",
    "  rgb(10,20,30)  ", "rgb(10,20,30", "(10,20,30)", "hsl(10 20% 30%) extra",
  ];
  for (const s of strings) out.push({ kind: "parse", input: s });

  const lchs = [
    { L: 0.5, C: 0.1, h: 30 }, { L: 0.7, C: 0.3, h: 150 }, { L: 0.9, C: 0.4, h: 90 },
    { L: 0.3, C: 0.4, h: 265 }, { L: 0.0, C: 0.2, h: 0 }, { L: 1.0, C: 0.2, h: 120 },
    { L: 0.5, C: 0, h: 0 }, { L: 0.62, C: 0.26, h: 29 }, { L: 0.45, C: 0.31, h: 264 },
    { L: 1.2, C: 0.1, h: 200 }, { L: -0.2, C: 0.1, h: 200 }, { L: 0.5, C: 0.1, h: 360 },
    { L: 0.5, C: 0.1, h: -90 }, { L: 0.8, C: 0.15, h: 720 }, { L: 0.97, C: 0.35, h: 110 },
  ];
  for (const lch of lchs) out.push({ kind: "lch", input: lch });

  const scalars = [0, 1, 10, 11, 12.92, 50, 128, 200, 254, 255, 256, -5, 0.5, 0.0031308, 0.04045];
  for (const v of scalars) out.push({ kind: "scalar", input: v });

  const hsls = [
    { h: 0, s: 100, l: 50 }, { h: 120, s: 100, l: 50 }, { h: 240, s: 100, l: 50 }, { h: 60, s: 50, l: 25 },
    { h: 359.9, s: 80, l: 60 }, { h: 360, s: 100, l: 50 }, { h: -120, s: 100, l: 50 }, { h: 720, s: 40, l: 70 },
    { h: 180, s: 150, l: 50 }, { h: 180, s: -20, l: 50 }, { h: 90, s: 50, l: 120 },
  ];
  for (const hsl of hsls) out.push({ kind: "hsl", input: hsl });

  // D3: Object.prototype member names must not parse as colours. Appended last
  // so every earlier case keeps its index.
  for (const s of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf", "Constructor", "~constructor", "nearest: toString"]) {
    out.push({ kind: "parse", input: s });
  }

  return out;
}

// ── Output ────────────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "../spec/vectors");

/**
 * One case per line so diffs of regenerated vectors stay reviewable. Key order
 * is the (code-defined) insertion order; numbers are emitted by JSON.stringify,
 * i.e. the shortest round-tripping JS representation.
 */
function writeVectors(file: string, meta: Record<string, unknown>, cases: unknown[]): void {
  const header = Object.entries(meta)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join("\n");
  const body = cases.map((c) => "    " + JSON.stringify(c)).join(",\n");
  writeFileSync(resolve(outDir, file), `{\n${header}\n  "cases": [\n${body}\n  ]\n}\n`);
  console.log(`${file}: ${cases.length} cases`);
}

const NOTE =
  "Characterisation vectors of the frozen v1 engine (scoring model V1_MODEL, src/scoring-model-v1.ts), after the pre-freeze defect fixes D1-D7 listed in spec/vectors/CHANGES-v1.md. Generated by scripts/gen-vectors.ts; replayed with exact equality by tests/characterisation.test.ts. NaN/Infinity appear as null (JSON).";
const DEFECT_NOTE =
  "`defects` tags cases whose input lies in the region of a fixed pre-freeze defect (D1 invalid input, D2 interpolate bracket, D4 formerly silent penalty, D5 refine guarantees); their output reflects the FIXED behaviour. D6 (array order) and D7 (opposed-hue mean) are fixed too but not tagged. See spec/vectors/CHANGES-v1.md.";
const FINDINGS_NOTE =
  "Explained score per corpus case: status, coded + located findings (Finding, src/gradient-engine.ts), the full ScoreMeasurements and `boundary` = some measurement lies within 1e-6*max(1,|t|) of one of its thresholds t (V1_BOUNDARY_TABLE). Ports must match non-boundary cases exactly and boundary cases on measurements (with tolerance) only.";

function main(): void {
  mkdirSync(outDir, { recursive: true });
  const corpus = buildCorpus();

  writeVectors(
    "v1-score.json",
    { vectorVersion: 1, kind: "score", note: NOTE, defectNote: DEFECT_NOTE },
    corpus.map((c) => evalScore(c.name, c.stops)),
  );

  writeVectors(
    "v1-findings.json",
    { vectorVersion: 1, kind: "findings", scoringModel: "v1", note: FINDINGS_NOTE },
    corpus.map((c) => evalFindings(c.name, c.stops)),
  );

  writeVectors(
    "v1-suggest.json",
    { vectorVersion: 1, kind: "suggest", note: NOTE, defectNote: DEFECT_NOTE },
    corpus.map((c) => evalSuggest(c.name, c.stops)),
  );

  const cssCases = corpus.map((c, i) =>
    evalCss(
      c.name,
      c.stops,
      ANGLES[i % ANGLES.length],
      DIRECTION_SETS[i % DIRECTION_SETS.length],
      BLENDS[i % BLENDS.length],
    ),
  );
  cssCases.push(
    evalCss("empty stops", [], 135, DIRECTION_SETS[1], "normal"),
    evalCss("empty stops, multiply", [], 0, DIRECTION_SETS[0], "multiply"),
    evalCss(
      "single stop",
      [{ id: 1, color: "#ff8800", position: 50 }],
      90,
      DIRECTION_SETS[2],
      "screen",
    ),
  );
  const spreads: Record<string, number[]> = {};
  for (const n of [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 12]) spreads[String(n)] = spreadDirectionAngles(n);
  for (const start of [0, 45, 135, 350]) spreads[`4@${start}`] = spreadDirectionAngles(4, start);
  writeVectors(
    "v1-css.json",
    { vectorVersion: 1, kind: "css", note: NOTE, spreadDirectionAngles: spreads },
    cssCases,
  );

  const interpCases = corpus.map((c) => evalInterpolate(c.name, c.stops));
  writeVectors(
    "v1-interpolate.json",
    {
      vectorVersion: 1,
      kind: "interpolate",
      note: NOTE,
      defectNote: DEFECT_NOTE,
      counts: [2, 3, 5, 8, 16],
      colorAtPositions: [0, 10, 25, 50, 75, 90, 100],
    },
    interpCases,
  );

  writeVectors(
    "v1-color.json",
    { vectorVersion: 1, kind: "color", note: NOTE },
    colorInputs().map(evalColor),
  );
}

main();
