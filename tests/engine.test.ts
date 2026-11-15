// Hot-spot unit tests for src/gradient-engine.ts (PLAN §6 Phase 0, tasks 4-8).
//
// Three kinds of test live here:
//   - plain `it`: pinned v1 behaviour or invariants that must keep holding;
//   - `it.fails` tagged `// DEFECT-n`: assert the CORRECT behaviour that the code
//     does not have yet. They pass today because the assertion throws. When the
//     defect is fixed the test starts failing ("expected to fail") - at that
//     point drop the `.fails`.
//   - "sanity" tests next to each DEFECT test prove the premise (e.g. that the
//     silent penalty really is applied) so a `.fails` can't pass for the wrong
//     reason.

import { describe, expect, it } from "vitest";
import {
  buildGradientCSS,
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
  scoreGradient,
  srgbToLinear,
  suggestGradient,
  type GradientTick,
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

  // The next three pin today's garbage-in/garbage-out behaviour. It is the root
  // cause of DEFECT-1; revisit these when invalid input becomes `unscorable`.
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
    expect(r.details.hue).toBe(25); // the silent <15 deg penalty (see DEFECT-4)
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

  // Exactly opposed hues: the circular mean vector is ~0, so atan2 returns an
  // arbitrary angle (floating-point noise). The result is still arc-compressed
  // and finite, but its centre is NOT meaningful. We pin: valid colours,
  // deterministic, arc ~80 deg - not any particular mean.
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
  it("scoreGradient with fewer than two stops is the all-zero score", () => {
    const zero = { score: 0, issues: [], details: { lightness: 0, hue: 0, chroma: 0, spacing: 0 } };
    expect(scoreGradient([])).toEqual(zero);
    expect(scoreGradient([tick(RED, 0)])).toEqual(zero);
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
      expect(JSON.stringify(r)).not.toContain("null");
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
      for (const v of Object.values(d)) expect(v).toBeGreaterThanOrEqual(0);
      for (const m of r.issues) expect(m.length).toBeGreaterThan(0);
    }
  });

  it("scoring is deterministic", () => {
    for (const g of corpus.slice(0, 200)) {
      expect(scoreGradient(g)).toEqual(scoreGradient(g));
      expect(scoreGradient(structuredClone(g))).toEqual(scoreGradient(g));
    }
  });

  it("suggestGradient is deterministic and emits valid evenly-spaced #rrggbb stops", () => {
    for (const g of corpus) {
      const a = suggestGradient(g);
      expect(suggestGradient(g)).toEqual(a);
      expect(a).toHaveLength(g.length);
      expect(a[0].position).toBe(0);
      expect(a[a.length - 1].position).toBe(100);
      for (let i = 0; i < a.length; i++) {
        expect(a[i].color).toMatch(HEX);
        expect(Number.isInteger(a[i].position)).toBe(true);
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

// ── DEFECT-1: invalid hex ─────────────────────────────────────────────────────

describe("DEFECT-1: invalid hex input", () => {
  const INVALID: [string, GradientTick[]][] = [
    ["#zzzzzz", stops(["#zzzzzz", "#ffffff"])],
    ["#abc (shorthand)", stops(["#abc", RED])],
    ["empty string", stops(["", "#00ff00"])],
    ["both invalid", stops(["#zzzzzz", "#abc"])],
  ];

  it("premise: invalid colours currently flow into NaN maths", () => {
    expect(JSON.stringify(suggestGradient(stops(["#zzzzzz", "#abc"])))).toContain("NaN");
    const r = scoreGradient(stops(["#zzzzzz", "#ffffff"]));
    expect(r.score).toBe(100);
    expect(r.issues).toEqual([]);
  });

  // DEFECT-1: invalid hex scores a perfect 100 with no issue.
  it.fails("DEFECT-1: scoreGradient does not report a perfect clean score for invalid hex", () => {
    for (const [, input] of INVALID) {
      const r = scoreGradient(input);
      expect(r.score !== 100 || r.issues.length > 0).toBe(true);
    }
  });

  // DEFECT-1: suggestGradient yields '#NaNNaNNaN' colours for invalid hex.
  it.fails("DEFECT-1: suggestGradient never emits NaN colours for invalid hex", () => {
    for (const [, input] of INVALID) {
      expect(JSON.stringify(suggestGradient(input))).not.toContain("NaN");
    }
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

  it("premise: today the last sample is not the last stop's colour", () => {
    const out = interpolateGradient([tick(RED, 20, 1), tick(BLUE, 80, 2)], 11);
    expect(out[out.length - 1]).toBe("#2300ff");
    expect(out[out.length - 1]).not.toBe(BLUE);
  });

  // DEFECT-2: t beyond the last stop interpolates first<->last, overshooting.
  it.fails("DEFECT-2: 20%/80% red->blue is clamped to the end stops and monotone", () => {
    const ticks = [tick(RED, 20, 1), tick(BLUE, 80, 2)];
    const out = interpolateGradient(ticks, 11);
    expect(out[0]).toBe(RED);
    expect(out[out.length - 1]).toBe(BLUE);
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

  // DEFECT-2: t before the first stop uses a negative interpolation fraction.
  it.fails("DEFECT-2: before the first stop the colour is the first stop's (no negative frac)", () => {
    const first = "#6080c0";
    const last = "#c08060";
    const ticks = [tick(first, 20, 1), tick(last, 80, 2)];
    const out = interpolateGradient(ticks, 11); // t = 0, .1 are before the first stop
    expect(out[0]).toBe(first);
    expect(out[1]).toBe(first);
    expect(out[10]).toBe(last);
    expect(out[9]).toBe(last);
  });

  // DEFECT-2: with 3 stops the tail skips the middle stop entirely.
  it.fails("DEFECT-2: three stops 20/50/80 end on the last colour and pass through the middle", () => {
    const ticks = [tick(RED, 20, 1), tick(GREEN, 50, 2), tick(BLUE, 80, 3)];
    const out = interpolateGradient(ticks, 11);
    expect(out[0]).toBe(RED);
    expect(out[5]).toBe(GREEN);
    expect(out[10]).toBe(BLUE);
    expect(out.slice(8)).toEqual([BLUE, BLUE, BLUE]);
  });

  // DEFECT-2 (consistency): the correct reference already exists - colorAtPosition clamps.
  it.fails("DEFECT-2: interpolateGradient agrees with colorAtPosition for non-spanning stops", () => {
    const ticks = [tick("#102030", 10, 1), tick("#a0b0c0", 40, 2), tick("#ffeedd", 70, 3)];
    const n = 16;
    const out = interpolateGradient(ticks, n);
    for (let i = 0; i < n; i++) {
      expect(out[i]).toBe(colorAtPosition(ticks, (i / (n - 1)) * 100));
    }
  });
});

// ── DEFECT-4: silent penalties ────────────────────────────────────────────────

describe("DEFECT-4: four score penalties emit no issue", () => {
  // Each pair differs only by crossing one threshold. Colours are chosen so no
  // other rule fires. The sanity tests prove the penalty is applied; the
  // DEFECT tests assert the penalty is explained by an extra issue message.
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
    },
    edge: {
      label: "edge gap > 10 (-3)",
      penalised: stops([c0, c1], [6, 94]),
      control: stops([c0, c1], [4, 96]),
      delta: 3,
    },
    span: {
      label: "span < 40 (-4)",
      penalised: stops([c0, c1], [32, 67]),
      control: stops([c0, c1], [30, 70]),
      delta: 4,
    },
    rhythm: {
      label: "gap-evenness cv > 0.25 (-4)",
      penalised: stops(c3, [0, 35, 100]),
      control: stops(c3, [0, 40, 100]),
      delta: 4,
    },
  } as const;

  for (const [key, c] of Object.entries(cases)) {
    it(`premise (${key}): ${c.label} lowers the score by ${c.delta}`, () => {
      const p = scoreGradient([...c.penalised]);
      const k = scoreGradient([...c.control]);
      expect(k.score - p.score).toBe(c.delta);
    });
  }

  // DEFECT-4: arc < 15 deg takes 5 points off with no message.
  it.fails("DEFECT-4: hue arc < 15 deg is explained by an issue", () => {
    const p = scoreGradient([...cases.arc.penalised]);
    const k = scoreGradient([...cases.arc.control]);
    expect(p.issues.length).toBeGreaterThan(k.issues.length);
  });

  // DEFECT-4: edge gap 10-20 takes 3 points off with no message.
  it.fails("DEFECT-4: edge gap > 10 is explained by an issue", () => {
    const p = scoreGradient([...cases.edge.penalised]);
    const k = scoreGradient([...cases.edge.control]);
    expect(p.issues.length).toBeGreaterThan(k.issues.length);
  });

  // DEFECT-4: span 20-40 takes 4 points off with no message of its own
  // (the "bunched in the middle" edge message fires either way).
  it.fails("DEFECT-4: span < 40 is explained by an issue", () => {
    const p = scoreGradient([...cases.span.penalised]);
    const k = scoreGradient([...cases.span.control]);
    expect(p.issues.length).toBeGreaterThan(k.issues.length);
  });

  // DEFECT-4: uneven gaps (cv 0.25-0.5) take 4 points off with no message.
  it.fails("DEFECT-4: stop-gap cv > 0.25 is explained by an issue", () => {
    const p = scoreGradient([...cases.rhythm.penalised]);
    const k = scoreGradient([...cases.rhythm.control]);
    expect(p.issues.length).toBeGreaterThan(k.issues.length);
  });

  // The general form of the same defect: a score below 100 with no issues.
  it.fails("DEFECT-4: no score under 100 may come with an empty issue list", () => {
    for (const c of Object.values(cases)) {
      const r = scoreGradient([...c.penalised]);
      if (r.score < 100) expect(r.issues.length).toBeGreaterThan(0);
    }
  });
});

// ── DEFECT-6 (found while writing these tests): array order leaks into the score ──

describe("DEFECT-6: scoreGradient depends on the order of the stop array", () => {
  // The lightness-reversal (1a) and Helmholtz-Kohlrausch (1a') checks walk the
  // stops in ARRAY order, while every other check sorts by position first. The
  // same gradient therefore scores differently depending on how the caller
  // happens to order its array.
  const sortedStops = stops([RED, GREEN, BLUE], [0, 50, 100]);
  const shuffledStops = [tick(BLUE, 100, 3), tick(RED, 0, 1), tick(GREEN, 50, 2)];

  it("premise: the two orderings of the same gradient score differently today", () => {
    expect(scoreGradient(shuffledStops).score).not.toBe(scoreGradient(sortedStops).score);
  });

  // DEFECT-6: same gradient, different array order, different score.
  it.fails("DEFECT-6: the same stops in a different array order score identically", () => {
    const a = scoreGradient(sortedStops);
    const b = scoreGradient(shuffledStops);
    expect(b.score).toBe(a.score);
    expect(b.issues).toEqual(a.issues);
  });

  // DEFECT-6: ... and the same over a random corpus.
  it.fails("DEFECT-6: reversing the array never changes the score (random corpus)", () => {
    const rand = mulberry32(0xc0ffee);
    for (let i = 0; i < 200; i++) {
      const g = randomGradient(rand);
      expect(scoreGradient([...g].reverse()).score).toBe(scoreGradient(g).score);
    }
  });
});

// ── DEFECT-5: suggestGradient ("refine") ──────────────────────────────────────

describe("DEFECT-5: suggestGradient keeps grey stops grey and never lowers the score", () => {
  const chromaOf = (hex: string) => hexToOklch(hex).C;

  it("premise: a grey middle stop is currently recoloured (#808080 -> chromatic)", () => {
    const out = suggestGradient(stops([RED, "#808080", GREEN]));
    expect(chromaOf("#808080")).toBeLessThan(0.001);
    expect(chromaOf(out[1].color)).toBeGreaterThan(0.05);
  });

  it("premise: refine can lower the score (sunset 3-stop 100 -> 96)", () => {
    const input = stops(["#ff512f", "#dd2476", "#4a00e0"]);
    expect(scoreGradient(input).score).toBe(100);
    expect(scoreGradient(suggestGradient(input)).score).toBe(96);
  });

  // DEFECT-5: achromatic stops get a chroma envelope applied.
  it.fails("DEFECT-5: red / #808080 / green keeps the middle stop achromatic", () => {
    const out = suggestGradient(stops([RED, "#808080", GREEN]));
    expect(chromaOf(out[1].color)).toBeLessThan(0.02);
  });

  // DEFECT-5: same for grey endpoints and for pure-grey stops among vivid ones.
  it.fails("DEFECT-5: grey stops among vivid ones all stay achromatic", () => {
    const input = stops(["#666666", "#ff3366", "#999999", "#3366ff", "#cccccc"]);
    const out = suggestGradient(input);
    for (const i of [0, 2, 4]) expect(chromaOf(out[i].color)).toBeLessThan(0.02);
  });

  // DEFECT-5: refine is not monotone in score.
  it.fails("DEFECT-5: score(suggest(x)) >= score(x) for typical inputs", () => {
    const inputs = [
      stops(["#ff512f", "#dd2476", "#4a00e0"]),
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

  // DEFECT-5 (split out so each failing input is visible on its own).
  it.fails("DEFECT-5: refine does not lower a perfect 3-stop warm sweep", () => {
    const input = stops(["#ff0000", "#ff8000", "#ffff00"]);
    expect(scoreGradient(input).score).toBe(100);
    expect(scoreGradient(suggestGradient(input)).score).toBe(100);
  });
});
