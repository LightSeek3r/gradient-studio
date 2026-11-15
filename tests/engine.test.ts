// Hot-spot unit tests for src/gradient-engine.ts (PLAN §6 Phase 0, tasks 4-8).
//
// Three kinds of test live here:
//   - plain `it`: pinned v1 behaviour or invariants that must keep holding;
//   - tests named `DEFECT-n`: regression tests for the defects fixed before the
//     v1 freeze (Phase 0b; spec/vectors/CHANGES-v1.md). They were `it.fails`
//     while the defect existed; the convention for a newly found defect is
//     still to add it as `it.fails` tagged `// DEFECT-n` and flip it when fixed.
//   - "premise" tests next to some DEFECT tests prove the setup (e.g. that a
//     penalty really is applied) so a DEFECT test can't pass for the wrong
//     reason.

import { describe, expect, it } from "vitest";
import {
  buildGradientCSS,
  buildMultiGradientStyle,
  colorAtPosition,
  hexToOklch,
  hexToRgb,
  interpolateGradient,
  linearToSrgb,
  lchToOklab,
  oklabToLch,
  oklabToRgb,
  oklchToHex,
  rgbToHex,
  rgbToOklab,
  refineGradient,
  scoreGradient,
  srgbToLinear,
  suggestGradient,
  type GradientTick,
  V1_MODEL,
} from "../src/gradient-engine";
import { mulberry32 } from "../scripts/vector-lib";

// ── Helpers ───────────────────────────────────────────────────────────────────

const HEX = /^#[0-9a-f]{6}$/;

function tick(color: string, position: number, id = 1): GradientTick {
  return { id, color, position };
}

/** Stops from colours and positions, ids 1..n. */
function stops(colors: string[], positions?: number[]): GradientTick[] {
  return colors.map((color, i) => ({
    id: i + 1,
    color,
    position: positions ? positions[i] : Math.round((i / (colors.length - 1)) * 100),
  }));
}

/** Hex for an OKLCH colour (in-gamut values only, so no fitting is needed). */
const lch = (L: number, C: number, h: number) => oklchToHex({ L, C, h });

/** Smallest circular distance between two hue angles, in degrees. */
function hueDistance(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

/** Minimum arc enclosing all the given hues (degrees). */
function enclosingArc(hues: number[]): number {
  const s = [...hues].sort((a, b) => a - b);
  let maxGap = s[0] + 360 - s[s.length - 1];
  for (let i = 1; i < s.length; i++) maxGap = Math.max(maxGap, s[i] - s[i - 1]);
  return 360 - maxGap;
}

function randomHex(rand: () => number): string {
  const byte = () => Math.floor(rand() * 256);
  return "#" + [byte(), byte(), byte()].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function randomGradient(rand: () => number): GradientTick[] {
  const n = 2 + Math.floor(rand() * 9);
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    color: randomHex(rand),
    position: Math.round(rand() * 100),
  }));
}

/** True if any number anywhere in `v` is NaN (JSON would hide it as null). */
function hasNaN(v: unknown): boolean {
  if (typeof v === "number") return Number.isNaN(v);
  if (typeof v === "string") return v.includes("NaN");
  if (Array.isArray(v)) return v.some(hasNaN);
  if (v && typeof v === "object") return Object.values(v).some(hasNaN);
  return false;
}

/** Two position-neighbours at most 1% apart. */
function hasHardStop(g: GradientTick[]): boolean {
  const ps = g.map((t) => t.position).sort((a, b) => a - b);
  return ps.some((p, i) => i > 0 && p - ps[i - 1] <= 1);
}

const RED = "#ff0000";
const GREEN = "#00ff00";
const BLUE = "#0000ff";

// ── Colour conversion edge cases (Phase 0 task 7) ─────────────────────────────

describe("srgbToLinear / linearToSrgb", () => {
  it("round-trips every 8-bit value exactly", () => {
    for (let v = 0; v <= 255; v++) expect(linearToSrgb(srgbToLinear(v))).toBe(v);
  });

  it("hits the endpoints", () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(255)).toBeCloseTo(1, 12);
    expect(linearToSrgb(0)).toBe(0);
    expect(linearToSrgb(1)).toBe(255);
  });

  it("srgbToLinear does not clamp: negative and >255 inputs extrapolate (v1 behaviour)", () => {
    expect(srgbToLinear(-5)).toBeCloseTo(-5 / 255 / 12.92, 12); // linear toe segment
    expect(srgbToLinear(-5)).toBeLessThan(0);
    expect(srgbToLinear(300)).toBeGreaterThan(1);
    expect(srgbToLinear(Infinity)).toBe(Infinity);
  });

  it("srgbToLinear propagates NaN", () => {
    expect(srgbToLinear(NaN)).toBeNaN();
  });

  it("linearToSrgb clamps to 0..255", () => {
    expect(linearToSrgb(-1)).toBe(0);
    expect(linearToSrgb(-Infinity)).toBe(0);
    expect(linearToSrgb(2)).toBe(255);
    expect(linearToSrgb(Infinity)).toBe(255);
    expect(linearToSrgb(1.0000001)).toBe(255);
  });

  it("linearToSrgb propagates NaN (clamp passes NaN through)", () => {
    expect(linearToSrgb(NaN)).toBeNaN();
  });

  it("is monotone and uses the linear toe below 0.0031308", () => {
    let prev = -1;
    for (let i = 0; i <= 1000; i++) {
      const v = linearToSrgb(i / 1000);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(linearToSrgb(0.0031308)).toBe(Math.round(255 * 12.92 * 0.0031308));
  });
});

describe("hexToRgb / rgbToHex", () => {
  it("parses well-formed #rrggbb in either case", () => {
    expect(hexToRgb("#ff8000")).toEqual({ r: 255, g: 128, b: 0 });
    expect(hexToRgb("#FF8000")).toEqual({ r: 255, g: 128, b: 0 });
    expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
  });

  // The next three pin hexToRgb's garbage-in/garbage-out behaviour (it is a
  // low-level converter). It was the root cause of DEFECT-1; the scoring and
  // CSS entry points now validate (`unscorableReason`) before calling it.
  it("malformed hex yields NaN channels instead of throwing (v1 behaviour)", () => {
    expect(hexToRgb("#zzzzzz")).toEqual({ r: NaN, g: NaN, b: NaN });
    expect(hexToRgb("")).toEqual({ r: NaN, g: NaN, b: NaN });
    expect(hexToRgb("#abc")).toEqual({ r: 0xab, g: 0x0c, b: NaN }); // slices overlap the string end
    expect(hexToRgb("#ff")).toEqual({ r: 255, g: NaN, b: NaN });
  });

  it("requires the leading '#': a bare hex string is mis-sliced (v1 behaviour)", () => {
    expect(hexToRgb("ff0000")).toEqual({ r: 0xf0, g: 0, b: 0 });
  });

  it("ignores everything past the sixth digit (alpha is dropped)", () => {
    expect(hexToRgb("#11223344")).toEqual({ r: 0x11, g: 0x22, b: 0x33 });
  });

  it("rgbToHex rounds, clamps and zero-pads", () => {
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe("#000000");
    expect(rgbToHex({ r: 255, g: 255, b: 255 })).toBe("#ffffff");
    expect(rgbToHex({ r: 1, g: 2, b: 3 })).toBe("#010203");
    expect(rgbToHex({ r: -10, g: 300, b: 127.6 })).toBe("#00ff80");
    expect(rgbToHex({ r: Infinity, g: -Infinity, b: 0.4 })).toBe("#ff0000");
  });

  it("rgbToHex turns NaN into the literal text 'NaN' (root cause of DEFECT-1)", () => {
    expect(rgbToHex({ r: NaN, g: 255, b: 0 })).toBe("#NaNff00");
  });

  it("hex -> rgb -> hex is the identity for valid colours", () => {
    const rand = mulberry32(11);
    for (let i = 0; i < 500; i++) {
      const hex = randomHex(rand);
      expect(rgbToHex(hexToRgb(hex))).toBe(hex);
    }
  });
});

describe("OKLAB / OKLCH round trips", () => {
  it("rgb -> oklab -> rgb is the identity for 8-bit colours", () => {
    const rand = mulberry32(12);
    for (let i = 0; i < 1000; i++) {
      const rgb = hexToRgb(randomHex(rand));
      expect(oklabToRgb(rgbToOklab(rgb))).toEqual(rgb);
    }
  });

  it("hexToOklch / oklchToHex round-trip", () => {
    const rand = mulberry32(13);
    for (let i = 0; i < 500; i++) {
      const hex = randomHex(rand);
      expect(oklchToHex(hexToOklch(hex))).toBe(hex);
    }
  });

  it("white is L=1 with ~zero chroma and black is L=0", () => {
    const white = rgbToOklab({ r: 255, g: 255, b: 255 });
    expect(white.L).toBeCloseTo(1, 4);
    expect(Math.hypot(white.a, white.b)).toBeLessThan(1e-4);
    expect(rgbToOklab({ r: 0, g: 0, b: 0 })).toEqual({ L: 0, a: 0, b: 0 });
  });
});

// ── Hue wraparound (Phase 0 task 4) ───────────────────────────────────────────

describe("oklabToLch hue normalisation", () => {
  it("maps every direction into [0, 360)", () => {
    for (let deg = -720; deg <= 720; deg += 7) {
      const rad = (deg * Math.PI) / 180;
      const { h } = oklabToLch({ L: 0.5, a: Math.cos(rad), b: Math.sin(rad) });
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  it("negative b gives hues just below 360, positive b just above 0", () => {
    expect(oklabToLch({ L: 0.5, a: 1, b: -1e-3 }).h).toBeCloseTo(359.94, 1);
    expect(oklabToLch({ L: 0.5, a: 1, b: 1e-3 }).h).toBeCloseTo(0.057, 2);
    expect(oklabToLch({ L: 0.5, a: -1, b: -1e-3 }).h).toBeCloseTo(180.06, 1);
  });

  it("axis directions", () => {
    expect(oklabToLch({ L: 0.5, a: 0, b: 1 }).h).toBeCloseTo(90, 10);
    expect(oklabToLch({ L: 0.5, a: -1, b: 0 }).h).toBeCloseTo(180, 10);
    expect(oklabToLch({ L: 0.5, a: 0, b: -1 }).h).toBeCloseTo(270, 10);
  });

  it("achromatic input gives C=0 and a defined (0) hue, never NaN", () => {
    expect(oklabToLch({ L: 0.5, a: 0, b: 0 })).toEqual({ L: 0.5, C: 0, h: 0 });
    // atan2(-0, 0) is -0: the normalisation must not leak -0 or 360.
    const { h } = oklabToLch({ L: 0.5, a: 0, b: -0 });
    expect(Object.is(h, -0)).toBe(false);
    expect(h).toBe(0);
  });

  it("lch -> lab -> lch round-trips hues including the wrap point", () => {
    for (const h of [0, 0.5, 1, 90, 179.9, 180, 270, 358, 359, 359.99]) {
      const back = oklabToLch(lchToOklab({ L: 0.6, C: 0.12, h }));
      expect(hueDistance(back.h, h)).toBeLessThan(1e-9);
      expect(back.C).toBeCloseTo(0.12, 12);
    }
  });
});

describe("scoreGradient - hue arcs across the 0/360 seam", () => {
  const A = (h: number) => lch(0.65, 0.12, h);

  it("fixture colours really sit at the intended hues", () => {
    expect(hueDistance(hexToOklch(A(350)).h, 350)).toBeLessThan(1);
    expect(hueDistance(hexToOklch(A(10)).h, 10)).toBeLessThan(1);
    expect(hueDistance(hexToOklch(A(359)).h, 359)).toBeLessThan(1);
    expect(hueDistance(hexToOklch(A(1)).h, 1)).toBeLessThan(1);
  });

  it("350 deg and 10 deg form a 20 deg arc, not a 340 deg one", () => {
    const r = scoreGradient(stops([lch(0.5, 0.12, 350), lch(0.8, 0.12, 10)]));
    expect(r.details.hue).toBe(30);
    expect(r.issues.some((m) => m.startsWith("Hue arc") || m.startsWith("Wide hue arc"))).toBe(false);
  });

  it("is symmetric: swapping which end sits at 350 vs 10 changes nothing", () => {
    const a = scoreGradient(stops([lch(0.5, 0.12, 350), lch(0.8, 0.12, 10)]));
    const b = scoreGradient(stops([lch(0.5, 0.12, 10), lch(0.8, 0.12, 350)]));
    expect(b.details.hue).toBe(a.details.hue);
    expect(b.score).toBe(a.score);
  });

  it("359 deg and 1 deg is a ~2 deg arc: treated as a (tight) single hue", () => {
    const r = scoreGradient(stops([lch(0.5, 0.12, 359), lch(0.8, 0.12, 1)]));
    // Not the >180 deg clash a naive max-min (358 deg) would report.
    expect(r.issues.some((m) => m.includes("Hue arc spans"))).toBe(false);
    expect(r.details.hue).toBe(25); // the <15 deg narrow-arc penalty (formerly silent, DEFECT-4)
    expect(r.findings.map((f) => f.code)).toContain("hue/narrow-arc");
  });

  it("an arc straddling the seam is measured the short way for 120/180 deg thresholds", () => {
    // 320 deg and 80 deg: 120 deg apart through 0, not 240 the long way.
    const r = scoreGradient(stops([lch(0.5, 0.12, 320), lch(0.8, 0.12, 80)]));
    expect(r.details.hue).toBeGreaterThanOrEqual(22); // at most the "wide arc" -8
    expect(r.issues.some((m) => m.includes("Hue arc spans >180"))).toBe(false);
  });

  it("opposed hues (180 apart) trip the >180 / wide-arc branch consistently", () => {
    const r = scoreGradient(stops([lch(0.6, 0.12, 30), lch(0.6, 0.12, 215)]));
    expect(r.details.hue).toBeLessThanOrEqual(22);
  });

  it("direction consistency uses the shortest arc, so 350 -> 5 -> 20 is clockwise", () => {
    const r = scoreGradient(stops([lch(0.4, 0.12, 350), lch(0.6, 0.12, 5), lch(0.8, 0.12, 20)]));
    expect(r.issues.some((m) => m.includes("reverses direction"))).toBe(false);
  });

  it("a real reversal across the seam is flagged (350 -> 30 -> 10)", () => {
    const r = scoreGradient(stops([lch(0.4, 0.12, 350), lch(0.6, 0.12, 30), lch(0.8, 0.12, 10)]));
    expect(r.issues.some((m) => m.includes("reverses direction"))).toBe(true);
    expect(r.details.hue).toBeLessThan(30);
  });

  it("hue steps of 5 deg or less are ignored by the direction check", () => {
    const r = scoreGradient(stops([lch(0.4, 0.12, 100), lch(0.6, 0.12, 103), lch(0.8, 0.12, 99)]));
    expect(r.issues.some((m) => m.includes("reverses direction"))).toBe(false);
  });
});

describe("suggestGradient - hue compression", () => {
  const hueOf = (hex: string) => hexToOklch(hex).h;

  it("leaves a tight arc across the seam untouched (circular mean handles 359/1)", () => {
    const input = stops([lch(0.5, 0.12, 359), lch(0.8, 0.12, 1)]);
    const out = suggestGradient(input);
    expect(hueDistance(hueOf(out[0].color), hueOf(input[0].color))).toBeLessThan(2);
    expect(hueDistance(hueOf(out[1].color), hueOf(input[1].color))).toBeLessThan(2);
  });

  it("350 deg / 10 deg stays a ~20 deg arc and does not flip to the far side", () => {
    const out = suggestGradient(stops([lch(0.5, 0.12, 350), lch(0.8, 0.12, 10)]));
    expect(enclosingArc(out.map((s) => hueOf(s.color)))).toBeLessThan(30);
  });

  it("compresses a wide arc that straddles the seam to about 80 deg", () => {
    const out = suggestGradient(stops([lch(0.5, 0.12, 320), lch(0.8, 0.12, 100)]));
    const arc = enclosingArc(out.map((s) => hueOf(s.color)));
    expect(arc).toBeLessThan(85);
    expect(arc).toBeGreaterThan(60);
  });

  // Exactly opposed hues: the circular mean vector is ~0, so atan2 would return
  // an arbitrary angle (floating-point noise). Since D7 the centre falls back to
  // the midpoint of the shorter arc from the first to the last chromatic stop
  // (see the D7 tests below); here we pin: valid colours, deterministic, arc ~80.
  it.each([
    ["30/210", [30, 210]],
    ["0/180", [0, 180]],
    ["90/270", [90, 270]],
    ["0/120/240", [0, 120, 240]],
    ["0/90/180/270", [0, 90, 180, 270]],
  ] as const)("degenerate circular mean (%s): finite, compressed, deterministic", (_n, hues) => {
    const input = stops(hues.map((h) => lch(0.6, 0.12, h)));
    const a = suggestGradient(input);
    const b = suggestGradient(input);
    expect(a).toEqual(b);
    for (const s of a) expect(s.color).toMatch(HEX);
    expect(enclosingArc(a.map((s) => hueOf(s.color)))).toBeLessThan(85);
  });
});

// ── Already-guarded divisions (Phase 0 task 5) ────────────────────────────────

describe("guarded divisions and degenerate input", () => {
  it("scoreGradient with fewer than two stops is unscorable with the all-zero score (D1)", () => {
    for (const input of [[], [tick(RED, 0)]]) {
      const r = scoreGradient(input);
      expect(r).toEqual({
        status: "unscorable",
        reason: "needs at least 2 stops",
        score: 0,
        issues: [],
        details: { lightness: 0, hue: 0, chroma: 0, spacing: 0 },
        findings: [],
      });
    }
  });

  it("suggestGradient with fewer than two stops returns the input untouched", () => {
    const one = [tick(RED, 40)];
    expect(suggestGradient(one)).toBe(one);
    const none: GradientTick[] = [];
    expect(suggestGradient(none)).toBe(none);
  });

  it("interpolateGradient: empty, single stop and n <= 1", () => {
    expect(interpolateGradient([], 5)).toEqual([]);
    expect(interpolateGradient([tick(RED, 10)], 5)).toEqual([RED]);
    const two = stops([RED, BLUE]);
    for (const n of [1, 0, -1, -100]) expect(interpolateGradient(two, n)).toEqual([RED]);
    expect(interpolateGradient(two, 2)).toEqual([RED, BLUE]);
  });

  it("interpolateGradient with NaN count returns an empty list rather than looping", () => {
    expect(interpolateGradient(stops([RED, BLUE]), NaN)).toEqual([]);
  });

  it("interpolateGradient span === 0 (stacked stops) stays finite", () => {
    const stacked = [tick(RED, 50, 1), tick(BLUE, 50, 2)];
    const out = interpolateGradient(stacked, 9);
    expect(out).toHaveLength(9);
    for (const c of out) expect(c).toMatch(HEX);
  });

  it("interpolateGradient with every stop at the same position stays finite", () => {
    const out = interpolateGradient(
      [tick(RED, 0, 1), tick(GREEN, 0, 2), tick(BLUE, 0, 3)],
      7,
    );
    for (const c of out) expect(c).toMatch(HEX);
  });

  it("colorAtPosition span === 0 stays finite and returns an end colour", () => {
    const stacked = [tick(RED, 50, 1), tick(BLUE, 50, 2)];
    expect(colorAtPosition(stacked, 50)).toBe(RED);
    expect(colorAtPosition(stacked, 49.9)).toBe(RED);
    expect(colorAtPosition(stacked, 50.1)).toBe(BLUE);
  });

  it("scoreGradient: stops at one position (zero span, zero gaps)", () => {
    const r = scoreGradient([tick(RED, 30, 1), tick(BLUE, 30, 2)]);
    expect(Number.isInteger(r.score)).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.issues).toContain("Transition squeezed into a narrow band");
  });

  it("scoreGradient: three stops at one position (avgGap === 0 guard)", () => {
    const r = scoreGradient([tick(RED, 0, 1), tick(GREEN, 0, 2), tick(BLUE, 0, 3)]);
    expect(Number.isFinite(r.score)).toBe(true);
    expect(r.details.spacing).toBeGreaterThanOrEqual(0);
  });

  it("scoreGradient: identical colours at 3+ stops (avgV === 0 guard)", () => {
    const r = scoreGradient(stops(["#336699", "#336699", "#336699"]));
    expect(Number.isFinite(r.score)).toBe(true);
    expect(r.issues).toContain("Stops are nearly identical — gradient is invisible");
    expect(r.issues.some((m) => m.includes("speed"))).toBe(false);
  });

  it("scoreGradient: zero-chroma (grey) stops skip the chroma-ratio and muddy-midpoint maths", () => {
    const r = scoreGradient(stops(["#000000", "#808080", "#ffffff"]));
    expect(Number.isFinite(r.score)).toBe(true);
    expect(r.details.chroma).toBe(20);
    expect(r.details.hue).toBe(30); // fewer than two chromatic stops
  });

  it("scoreGradient: all-grey ramps never produce NaN anywhere", () => {
    for (const ramp of [
      ["#000000", "#ffffff"],
      ["#111111", "#444444", "#777777", "#aaaaaa"],
      ["#808080", "#808080"],
    ]) {
      const r = scoreGradient(stops(ramp));
      expect(hasNaN(r)).toBe(false);
      expect(Number.isFinite(r.score)).toBe(true);
    }
  });

  it("scoreGradient: unsorted input with the same stops stays finite and in range", () => {
    const shuffled = scoreGradient([tick(BLUE, 100, 3), tick(RED, 0, 1), tick(GREEN, 50, 2)]);
    expect(Number.isInteger(shuffled.score)).toBe(true);
    expect(shuffled.score).toBeGreaterThanOrEqual(0);
    expect(shuffled.score).toBeLessThanOrEqual(100);
  });

  it("scoreGradient does not mutate its input", () => {
    const input = [tick(BLUE, 100, 3), tick(RED, 0, 1), tick(GREEN, 50, 2)];
    const copy = structuredClone(input);
    scoreGradient(input);
    suggestGradient(input);
    interpolateGradient(input, 5);
    buildGradientCSS(input, 90);
    expect(input).toEqual(copy);
  });

  it("buildGradientCSS sorts by position and handles empty input", () => {
    expect(buildGradientCSS([], 90)).toBe("#ccc");
    expect(buildGradientCSS([tick(BLUE, 100, 2), tick(RED, 0, 1)], 45)).toBe(
      "linear-gradient(45deg, #ff0000 0%, #0000ff 100%)",
    );
  });
});

// ── Interpolation ─────────────────────────────────────────────────────────────

describe("interpolateGradient", () => {
  it("returns the end stop colours for gradients that span 0-100", () => {
    for (const n of [2, 3, 5, 8, 16]) {
      const out = interpolateGradient(stops([RED, GREEN, BLUE]), n);
      expect(out).toHaveLength(n);
      expect(out[0]).toBe(RED);
      expect(out[n - 1]).toBe(BLUE);
    }
  });

  it("hits interior stops exactly when a sample lands on them", () => {
    const out = interpolateGradient(stops([RED, GREEN, BLUE]), 5);
    expect(out[2]).toBe(GREEN);
  });

  it("agrees with colorAtPosition for stops that span 0-100", () => {
    const cases = [
      stops([RED, BLUE]),
      stops([RED, GREEN, BLUE]),
      stops(["#102030", "#a0b0c0", "#ffeedd", "#334455"], [0, 30, 55, 100]),
      stops(["#ff00aa", "#00aaff"], [0, 100]),
    ];
    for (const ticks of cases) {
      for (const n of [2, 3, 5, 8, 16]) {
        const out = interpolateGradient(ticks, n);
        for (let i = 0; i < n; i++) {
          expect(out[i]).toBe(colorAtPosition(ticks, (i / (n - 1)) * 100));
        }
      }
    }
  });

  it("is order-independent (sorts by position)", () => {
    const a = interpolateGradient(stops([RED, GREEN, BLUE], [0, 50, 100]), 9);
    const b = interpolateGradient(
      [tick(BLUE, 100, 3), tick(RED, 0, 1), tick(GREEN, 50, 2)],
      9,
    );
    expect(b).toEqual(a);
  });
});

// ── Properties over random valid input ───────────────────────────────────────

describe("properties over seeded random gradients", () => {
  const rand = mulberry32(0xc0ffee);
  const corpus = Array.from({ length: 1000 }, () => randomGradient(rand));

  it("score is always a finite integer in 0..100, equal to the sum of its dimensions", () => {
    for (const g of corpus) {
      const r = scoreGradient(g);
      expect(Number.isInteger(r.score)).toBe(true);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      const d = r.details;
      expect(d.lightness + d.hue + d.chroma + d.spacing).toBe(r.score);
      expect(d.lightness).toBeLessThanOrEqual(30);
      expect(d.hue).toBeLessThanOrEqual(30);
      expect(d.chroma).toBeLessThanOrEqual(20);
      expect(d.spacing).toBeLessThanOrEqual(20);
      for (const v of [d.lightness, d.hue, d.chroma, d.spacing]) expect(v).toBeGreaterThanOrEqual(0);
      for (const m of r.issues) expect(m.length).toBeGreaterThan(0);
    }
  });

  it("scoring is deterministic", () => {
    for (const g of corpus.slice(0, 200)) {
      expect(scoreGradient(g)).toEqual(scoreGradient(g));
      expect(scoreGradient(structuredClone(g))).toEqual(scoreGradient(g));
    }
  });

  it("suggestGradient is deterministic and emits valid stops: refined ones spread 0-100, declined ones unchanged", () => {
    for (const g of corpus) {
      const a = suggestGradient(g);
      expect(suggestGradient(g)).toEqual(a);
      expect(a).toHaveLength(g.length);
      const r = refineGradient(g);
      if (r.refined) {
        expect(a[0].position).toBe(0);
        expect(a[a.length - 1].position).toBe(100);
      } else {
        expect(a).toEqual([...g].sort((x, y) => x.position - y.position));
      }
      for (let i = 0; i < a.length; i++) {
        expect(a[i].color).toMatch(HEX);
        // Positions are integers unless a hard-stop group keeps a fractional offset.
        if (r.refined && !hasHardStop(g)) expect(Number.isInteger(a[i].position)).toBe(true);
        if (i > 0) expect(a[i].position).toBeGreaterThanOrEqual(a[i - 1].position);
      }
      // ids follow the position-sorted order of the input
      const byPos = [...g].sort((x, y) => x.position - y.position).map((s) => s.id);
      expect(a.map((s) => s.id)).toEqual(byPos);
    }
  });

  it("suggested gradients are always finite-scored", () => {
    for (const g of corpus.slice(0, 300)) {
      const r = scoreGradient(suggestGradient(g));
      expect(Number.isInteger(r.score)).toBe(true);
    }
  });

  it("interpolateGradient emits n valid colours for every count", () => {
    for (const g of corpus.slice(0, 200)) {
      for (const n of [2, 3, 5, 8, 16]) {
        const out = interpolateGradient(g, n);
        expect(out).toHaveLength(n);
        for (const c of out) expect(c).toMatch(HEX);
      }
    }
  });
});

// ── DEFECT-1: input outside the v1 domain ─────────────────────────────────────

describe("DEFECT-1: input outside the v1 domain is unscorable, never NaN", () => {
  const INVALID: [string, GradientTick[]][] = [
    ["#zzzzzz", stops(["#zzzzzz", "#ffffff"])],
    ["#abc (shorthand)", stops(["#abc", RED])],
    ["empty string", stops(["", "#00ff00"])],
    ["both invalid", stops(["#zzzzzz", "#abc"])],
    ["#rrggbbaa (alpha)", stops(["#ff000080", BLUE])],
    ["css name", stops(["red", BLUE])],
    ["no leading #", stops(["ff0000", BLUE])],
    ["NaN position", [tick(RED, NaN, 1), tick(BLUE, 100, 2)]],
    ["Infinity position", [tick(RED, 0, 1), tick(BLUE, Infinity, 2)]],
    ["position above 100", [tick(RED, 0, 1), tick(BLUE, 150, 2)]],
    ["position below 0", [tick(RED, -1, 1), tick(BLUE, 100, 2)]],
    ["one invalid among valid", stops([RED, "#zzzzzz", BLUE])],
    ["a single stop", [tick(RED, 50)]],
    ["no stops", []],
  ];

  it.each(INVALID)("scoreGradient(%s) is unscorable with a reason, score 0 and no NaN", (_n, input) => {
    const r = scoreGradient(input);
    expect(r.status).toBe("unscorable");
    expect(typeof r.reason).toBe("string");
    expect(r.reason!.length).toBeGreaterThan(0);
    expect(r.score).toBe(0);
    expect(r.issues).toEqual([]);
    expect(r.findings).toEqual([]);
    expect(r.details).toEqual({ lightness: 0, hue: 0, chroma: 0, spacing: 0 });
    expect(hasNaN(r)).toBe(false);
  });

  it("the reason names the offending stop (input index)", () => {
    expect(scoreGradient(stops([RED, "#zzzzzz", BLUE])).reason).toBe(
      'stop 1: colour "#zzzzzz" is not an opaque #rrggbb hex colour',
    );
    expect(scoreGradient([tick(RED, 0, 1), tick(BLUE, 150, 2)]).reason).toBe(
      "stop 1: position 150 is outside 0..100",
    );
    expect(scoreGradient([tick(RED, NaN, 1), tick(BLUE, 100, 2)]).reason).toBe(
      "stop 0: position is not a finite number",
    );
  });

  it("upper-case #RRGGBB is inside the domain and scores like lower-case", () => {
    const upper = scoreGradient(stops(["#FF512F", "#DD2476"]));
    const lower = scoreGradient(stops(["#ff512f", "#dd2476"]));
    expect(upper.status).toBe("ok");
    expect(upper).toEqual(lower);
  });

  it.each(INVALID)("suggestGradient(%s) returns the input itself", (_n, input) => {
    expect(suggestGradient(input)).toBe(input);
    expect(hasNaN(suggestGradient(input).map((s) => s.color))).toBe(false);
    if (input.length >= 2) expect(refineGradient(input)).toMatchObject({ refined: false, declined: "unscorable" });
  });

  it("interpolate / colorAtPosition / CSS builders skip invalid stops and never emit NaN", () => {
    for (const [, input] of INVALID) {
      for (const n of [1, 2, 5]) expect(hasNaN(interpolateGradient(input, n))).toBe(false);
      for (const p of [0, 33, 100, NaN]) expect(colorAtPosition(input, p)).toMatch(HEX);
      expect(buildGradientCSS(input, 90)).not.toContain("NaN");
      const multi = buildMultiGradientStyle(input, [{ id: 1, angle: 90, weight: 50, enabled: true }]);
      expect(multi.background).not.toContain("NaN");
    }
    // Valid stops survive, invalid ones are dropped.
    const mixed = stops([RED, "#zzzzzz", BLUE]);
    expect(buildGradientCSS(mixed, 90)).toBe("linear-gradient(90deg, #ff0000 0%, #0000ff 100%)");
    expect(interpolateGradient(mixed, 2)).toEqual([RED, BLUE]);
    expect(buildGradientCSS(stops(["#zzzzzz", "#abc"]), 90)).toBe("#ccc");
    expect(interpolateGradient(stops(["#zzzzzz", "#abc"]), 4)).toEqual([]);
  });
});

// ── DEFECT-2: interpolateGradient bracketing ──────────────────────────────────

describe("DEFECT-2: interpolateGradient with stops not spanning 0-100", () => {
  /** Progress of `c` along the OKLAB segment a -> b (0 at a, 1 at b). */
  function progress(c: string, a: string, b: string): number {
    const p = rgbToOklab(hexToRgb(c));
    const pa = rgbToOklab(hexToRgb(a));
    const pb = rgbToOklab(hexToRgb(b));
    const d = { L: pb.L - pa.L, a: pb.a - pa.a, b: pb.b - pa.b };
    const v = { L: p.L - pa.L, a: p.a - pa.a, b: p.b - pa.b };
    return (v.L * d.L + v.a * d.a + v.b * d.b) / (d.L * d.L + d.a * d.a + d.b * d.b);
  }

  it("DEFECT-2: 20%/80% red->blue is clamped to the end stops and monotone", () => {
    const ticks = [tick(RED, 20, 1), tick(BLUE, 80, 2)];
    const out = interpolateGradient(ticks, 11);
    expect(out[0]).toBe(RED);
    expect(out[out.length - 1]).toBe(BLUE); // was #2300ff
    let prev = -Infinity;
    for (const c of out) {
      const p = progress(c, RED, BLUE);
      expect(p).toBeGreaterThanOrEqual(prev - 1e-6);
      expect(p).toBeGreaterThanOrEqual(-0.02);
      expect(p).toBeLessThanOrEqual(1.02);
      prev = p;
    }
    // Samples at or before 20% are the first colour, at or after 80% the last.
    expect(out.slice(0, 3)).toEqual([RED, RED, RED]);
    expect(out.slice(8)).toEqual([BLUE, BLUE, BLUE]);
  });

  it("DEFECT-2: before the first stop the colour is the first stop's (no negative frac)", () => {
    const first = "#6080c0";
    const last = "#c08060";
    const ticks = [tick(first, 20, 1), tick(last, 80, 2)];
    const out = interpolateGradient(ticks, 11); // t = 0, .1 are before the first stop
    expect(out[0]).toBe(first);
    expect(out[1]).toBe(first);
    expect(out[10]).toBe(last);
    expect(out[9]).toBe(last);
  });

  it("DEFECT-2: three stops 20/50/80 end on the last colour and pass through the middle", () => {
    const ticks = [tick(RED, 20, 1), tick(GREEN, 50, 2), tick(BLUE, 80, 3)];
    const out = interpolateGradient(ticks, 11);
    expect(out[0]).toBe(RED);
    expect(out[5]).toBe(GREEN);
    expect(out[10]).toBe(BLUE);
    expect(out.slice(8)).toEqual([BLUE, BLUE, BLUE]);
  });

  it("DEFECT-2: interpolateGradient agrees with colorAtPosition for non-spanning stops", () => {
    const ticks = [tick("#102030", 10, 1), tick("#a0b0c0", 40, 2), tick("#ffeedd", 70, 3)];
    const n = 16;
    const out = interpolateGradient(ticks, n);
    for (let i = 0; i < n; i++) {
      expect(out[i]).toBe(colorAtPosition(ticks, (i / (n - 1)) * 100));
    }
  });

  it("DEFECT-2: several stops at the last position end on the LAST of them (as CSS paints past 100%)", () => {
    const ticks = [tick(RED, 0, 1), tick(GREEN, 100, 2), tick(BLUE, 100, 3)];
    expect(interpolateGradient(ticks, 5).at(-1)).toBe(BLUE);
    expect(colorAtPosition(ticks, 100)).toBe(BLUE);
  });

  it("interpolateGradient and colorAtPosition agree on a seeded random corpus (one shared helper)", () => {
    const rand = mulberry32(0xd2);
    for (let k = 0; k < 300; k++) {
      const g = randomGradient(rand);
      const n = 2 + Math.floor(rand() * 15);
      const out = interpolateGradient(g, n);
      for (let i = 0; i < n; i++) {
        // Same bracket search; the two may differ only by 8-bit rounding of the
        // interpolation fraction (t in 0..1 vs 0..100), never by more than 1 level.
        const a = hexToRgb(out[i]);
        const b = hexToRgb(colorAtPosition(g, (i / (n - 1)) * 100));
        expect(Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b))).toBeLessThanOrEqual(1);
      }
    }
  });
});

// ── DEFECT-4: formerly silent penalties ───────────────────────────────────────

describe("DEFECT-4: every penalty is explained by an issue", () => {
  // Each pair differs only by crossing one threshold. Colours are chosen so no
  // other rule fires.
  const c0 = lch(0.55, 0.12, 200);
  const c1 = lch(0.85, 0.12, 230);
  const blues = [lch(0.55, 0.12, 200), lch(0.85, 0.12, 208)]; // arc ~8 deg
  const c3 = [lch(0.45, 0.12, 200), lch(0.65, 0.12, 230), lch(0.85, 0.12, 260)];

  const cases = {
    arc: {
      label: "hue arc < 15 deg (-5)",
      penalised: stops(blues, [0, 100]),
      control: stops([c0, c1], [0, 100]),
      delta: 5,
      code: "hue/narrow-arc",
      message: "Very narrow hue arc (<15°) — the gradient reads as a single hue",
    },
    edge: {
      label: "edge gap > 10 (-3)",
      penalised: stops([c0, c1], [6, 94]),
      control: stops([c0, c1], [4, 96]),
      delta: 3,
      code: "rhythm/edge-gap",
      message: "Stops fall slightly short of the edges — small solid-color zones",
    },
    span: {
      label: "span < 40 (-4)",
      penalised: stops([c0, c1], [32, 67]),
      control: stops([c0, c1], [30, 70]),
      delta: 4,
      code: "rhythm/narrow-span",
      message: "Transition covers less than 40% of the gradient",
    },
    rhythm: {
      label: "gap-evenness cv > 0.25 (-4)",
      penalised: stops(c3, [0, 35, 100]),
      control: stops(c3, [0, 40, 100]),
      delta: 4,
      code: "rhythm/uneven-gaps",
      message: "Stop spacing is slightly uneven",
    },
  } as const;

  for (const [key, c] of Object.entries(cases)) {
    it(`premise (${key}): ${c.label} lowers the score by ${c.delta}`, () => {
      const p = scoreGradient([...c.penalised]);
      const k = scoreGradient([...c.control]);
      expect(k.score - p.score).toBe(c.delta);
    });

    it(`DEFECT-4 (${key}): the penalty comes with an info finding and issue`, () => {
      const p = scoreGradient([...c.penalised]);
      const k = scoreGradient([...c.control]);
      expect(p.issues.length).toBe(k.issues.length + 1);
      const extra = p.findings.filter((f) => !k.findings.some((g) => g.code === f.code && g.message === f.message));
      expect(extra).toHaveLength(1);
      expect(extra[0]).toMatchObject({ code: c.code, severity: "info", pointsLost: c.delta, message: c.message });
      expect(p.issues).toContain(c.message);
    });
  }

  it("DEFECT-4: no score under 100 comes with an empty issue list (seeded corpus)", () => {
    const rand = mulberry32(0xd4);
    for (let i = 0; i < 1000; i++) {
      const r = scoreGradient(randomGradient(rand));
      if (r.score < 100) expect(r.issues.length).toBeGreaterThan(0);
      else expect(r.issues).toEqual([]);
    }
  });
});

// ── DEFECT-6: array order must not leak into the score ────────────────────────

describe("DEFECT-6: scoreGradient sorts by position before analysis", () => {
  const sortedStops = stops([RED, GREEN, BLUE], [0, 50, 100]);
  const shuffledStops = [tick(BLUE, 100, 3), tick(RED, 0, 1), tick(GREEN, 50, 2)];

  it("DEFECT-6: the same stops in a different array order score identically", () => {
    const a = scoreGradient(sortedStops);
    const b = scoreGradient(shuffledStops);
    expect(b).toEqual(a);
  });

  it("DEFECT-6: reversing an array with distinct positions never changes the result (random corpus)", () => {
    const rand = mulberry32(0xc0ffee);
    for (let i = 0; i < 300; i++) {
      const g = randomGradient(rand).map((t, k) => ({ ...t, position: t.position * 0.99 + k * 1e-3 }));
      expect(scoreGradient([...g].reverse())).toEqual(scoreGradient(g));
      expect(suggestGradient([...g].reverse())).toEqual(suggestGradient(g));
    }
  });

  it("stops sharing a position keep their array order (it is what CSS paints)", () => {
    // red|blue hard edge at 50 vs blue|red: different gradients, both valid.
    const a = [tick(RED, 0, 1), tick(RED, 50, 2), tick(BLUE, 50, 3), tick(BLUE, 100, 4)];
    const b = [tick(RED, 0, 1), tick(BLUE, 50, 3), tick(RED, 50, 2), tick(BLUE, 100, 4)];
    expect(buildGradientCSS(a, 90)).not.toBe(buildGradientCSS(b, 90));
    expect(scoreGradient(a).details.measurements!.segmentRgbSteps).not.toEqual(
      scoreGradient(b).details.measurements!.segmentRgbSteps,
    );
  });

  it("finding stop indices refer to position-sorted stops", () => {
    const dip = scoreGradient([tick("#c7d2fe", 100, 3), tick("#e0e7ff", 0, 1), tick("#1e1b4b", 50, 2)]);
    expect(dip.findings.find((f) => f.code === "lightness/reversal")?.stops).toEqual([1]);
  });
});

// ── DEFECT-5: suggestGradient ("refine") guarantees ───────────────────────────

describe("DEFECT-5: refine keeps grey stops grey, keeps hard stops and never lowers the score", () => {
  const chromaOf = (hex: string) => hexToOklch(hex).C;

  it("DEFECT-5: red / #808080 / green keeps the middle stop achromatic", () => {
    const out = suggestGradient(stops([RED, "#808080", GREEN]));
    expect(chromaOf(out[1].color)).toBeLessThan(0.02);
  });

  it("DEFECT-5: grey stops among vivid ones all stay achromatic", () => {
    const input = stops(["#666666", "#ff3366", "#999999", "#3366ff", "#cccccc"]);
    const out = suggestGradient(input);
    for (const i of [0, 2, 4]) expect(chromaOf(out[i].color)).toBeLessThan(0.02);
  });

  it("an all-grey ramp stays grey", () => {
    for (const s of suggestGradient(stops(["#111111", "#777777", "#eeeeee"]))) {
      expect(chromaOf(s.color)).toBeLessThanOrEqual(0.02);
    }
  });

  it("DEFECT-5: score(suggest(x)) >= score(x) for typical inputs", () => {
    const inputs = [
      stops(["#ff512f", "#dd2476", "#4a00e0"]), // used to drop 100 -> 96
      stops(["#ff0000", "#ff8000", "#ffff00"]),
      stops([RED, "#808080", GREEN]),
      stops(["#2193b0", "#6dd5ed"]),
    ];
    for (const input of inputs) {
      expect(scoreGradient(suggestGradient(input)).score).toBeGreaterThanOrEqual(
        scoreGradient(input).score,
      );
    }
  });

  it("DEFECT-5: refine does not lower a perfect 3-stop warm sweep", () => {
    const input = stops(["#ff0000", "#ff8000", "#ffff00"]);
    expect(scoreGradient(input).score).toBe(100);
    expect(scoreGradient(suggestGradient(input)).score).toBe(100);
  });

  it("when refining would lower the score, the input comes back unchanged (sorted, same ids)", () => {
    const input = [tick("#dd2476", 50, 7), tick("#ff512f", 0, 3), tick("#4a00e0", 100, 9)];
    const r = refineGradient(input);
    expect(r).toMatchObject({ refined: false, declined: "would-lower-score", before: 100, after: 100 });
    expect(r.stops).toEqual([tick("#ff512f", 0, 3), tick("#dd2476", 50, 7), tick("#4a00e0", 100, 9)]);
    expect(suggestGradient(input)).toEqual(r.stops);
  });

  it("hard stops stay hard: same-position and <= 1% neighbours move together", () => {
    const input = [
      tick("#1d4ed8", 0, 1),
      tick("#1d4ed8", 30, 2),
      tick("#f59e0b", 30, 3),
      tick("#f59e0b", 70, 4),
      tick("#10b981", 70.5, 5),
      tick("#10b981", 100, 6),
    ];
    const r = refineGradient(input);
    const p = r.stops.map((s) => s.position);
    expect(p[1]).toBe(p[2]);
    expect(p[4] - p[3]).toBeCloseTo(0.5, 12);
    expect(p[0]).toBe(0);
    expect(p[5]).toBe(100);
  });

  it("every stop at one position: nothing to redistribute, refine declines", () => {
    const input = [tick(RED, 50, 1), tick(BLUE, 50, 2)];
    expect(refineGradient(input)).toMatchObject({ refined: false, declined: "single-position" });
    expect(suggestGradient(input)).toEqual(input);
  });
});

// ── D7: opposed hues (degenerate circular mean) ──────────────────────────────

describe("D7: refine centres opposed hues deterministically", () => {
  const hueOf = (hex: string) => hexToOklch(hex).h;

  it("premise: these inputs really have a near-zero mean resultant", () => {
    const hs = [hueOf(lch(0.6, 0.12, 30)), hueOf(lch(0.6, 0.12, 210))];
    const x = hs.reduce((a, h) => a + Math.cos((h * Math.PI) / 180), 0) / 2;
    const y = hs.reduce((a, h) => a + Math.sin((h * Math.PI) / 180), 0) / 2;
    expect(Math.hypot(x, y)).toBeLessThan(V1_MODEL.refine.degenerateResultantBelow);
  });

  it("two opposed stops are compressed around the midpoint of the shorter first->last arc", () => {
    const input = stops([lch(0.5, 0.12, 30), lch(0.8, 0.12, 210)]);
    const r = refineGradient(input);
    expect(r.refined).toBe(true);
    const h1 = hueOf(input[0].color);
    const d = (((hueOf(input[1].color) - h1) % 360) + 360) % 360;
    const centre = (((d <= 180 ? h1 + d / 2 : h1 - (360 - d) / 2) % 360) + 360) % 360;
    for (const s of r.stops) expect(hueDistance(hueOf(s.color), centre)).toBeLessThan(45);
  });

  it("red / cyan / red is centred on red (first and last stop share the hue)", () => {
    const input = stops([lch(0.5, 0.12, 30), lch(0.65, 0.12, 210), lch(0.8, 0.12, 30)]);
    const r = refineGradient(input);
    expect(r.refined).toBe(true);
    const red = hueOf(input[0].color);
    expect(hueDistance(hueOf(r.stops[0].color), red)).toBeLessThan(5);
    expect(hueDistance(hueOf(r.stops[2].color), red)).toBeLessThan(5);
    expect(hueDistance(hueOf(r.stops[1].color), red)).toBeLessThan(85);
  });

  it("is stable under tiny hue noise (same output for the same input, any array order)", () => {
    const input = stops([lch(0.5, 0.12, 0), lch(0.6, 0.12, 90), lch(0.7, 0.12, 180), lch(0.8, 0.12, 270)]);
    const a = suggestGradient(input);
    expect(suggestGradient([...input].reverse())).toEqual(a);
    expect(suggestGradient(structuredClone(input))).toEqual(a);
  });
});
