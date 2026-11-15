// Hot-spot unit tests for src/color-formats.ts (PLAN §6 Phase 0, tasks 6-8).
// See engine.test.ts for the plain-test / `it.fails` DEFECT-n conventions.

import { describe, expect, it } from "vitest";
import {
  hexToOklch,
  hexToRgb,
  lchToOklab,
  oklabToLinearRgb,
  oklabToLch,
  rgbToHex,
  rgbToOklab,
  type LchColor,
} from "../src/gradient-engine";
import {
  CSS_COLOR_NAMES,
  CSS_NAMED_COLORS,
  complementHex,
  formatHex,
  formatHsl,
  formatName,
  formatNameDisplay,
  formatRgb,
  gamutFitOklch,
  hexToHsl,
  hexToHslPrecise,
  hslToHex,
  hslToRgb,
  nearestColorName,
  oklchToHexFitted,
  parseAnyColor,
  parseHex,
  parseHsl,
  parseName,
  parseRgb,
  rgbToHsl,
  rgbToHslPrecise,
} from "../src/color-formats";
import { mulberry32 } from "../scripts/vector-lib";

// ── Helpers ───────────────────────────────────────────────────────────────────

function randomHexes(count: number, seed: number): string[] {
  const rand = mulberry32(seed);
  const byte = () => Math.floor(rand() * 256);
  return Array.from(
    { length: count },
    () => "#" + [byte(), byte(), byte()].map((v) => v.toString(16).padStart(2, "0")).join(""),
  );
}

/** Same in-gamut test the module uses (private there): linear sRGB within eps of 0..1. */
function inGamut(lch: LchColor, eps = 1e-4): boolean {
  const { r, g, b } = oklabToLinearRgb(lchToOklab(lch));
  return [r, g, b].every((v) => v >= -eps && v <= 1 + eps);
}

function maxChannelError(a: string, b: string): number {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return Math.max(Math.abs(x.r - y.r), Math.abs(x.g - y.g), Math.abs(x.b - y.b));
}

// ── gamutFitOklch (Phase 0 task 6) ───────────────────────────────────────────

describe("gamutFitOklch", () => {
  it("returns in-gamut colours unchanged (same object)", () => {
    const inside: LchColor[] = [
      { L: 0.5, C: 0.1, h: 30 },
      { L: 0.5, C: 0, h: 0 },
      { L: 0.8, C: 0.05, h: 200 },
      { L: 0.62, C: 0.2, h: 29 },
    ];
    for (const c of inside) {
      expect(inGamut(c)).toBe(true);
      expect(gamutFitOklch(c)).toBe(c);
    }
  });

  it("every sRGB colour is already in gamut (identity) after an OKLCH round trip", () => {
    for (const hex of randomHexes(300, 21)) {
      const lch = hexToOklch(hex);
      expect(gamutFitOklch(lch)).toBe(lch);
    }
  });

  it("reduces chroma only, preserving lightness and hue exactly", () => {
    const outside: LchColor[] = [
      { L: 0.5, C: 0.4, h: 30 },
      { L: 0.9, C: 0.4, h: 90 },
      { L: 0.3, C: 0.4, h: 265 },
      { L: 0.7, C: 0.3, h: 150 },
      { L: 0.97, C: 0.35, h: 110 },
    ];
    for (const c of outside) {
      expect(inGamut(c)).toBe(false);
      const fit = gamutFitOklch(c);
      expect(fit.L).toBe(c.L);
      expect(fit.h).toBe(c.h);
      expect(fit.C).toBeLessThan(c.C);
      expect(fit.C).toBeGreaterThan(0);
      expect(inGamut(fit)).toBe(true);
    }
  });

  it("converges to within C0 / 2^16 of the gamut boundary (16 bisection steps)", () => {
    const outside: LchColor[] = [
      { L: 0.5, C: 0.4, h: 30 },
      { L: 0.9, C: 0.4, h: 90 },
      { L: 0.3, C: 0.4, h: 265 },
      { L: 0.7, C: 0.3, h: 150 },
    ];
    for (const c of outside) {
      const fit = gamutFitOklch(c);
      const width = c.C / 2 ** 16;
      expect(inGamut(fit)).toBe(true);
      // one more bisection-width of chroma must leave the gamut
      expect(inGamut({ ...fit, C: fit.C + width * 1.01 })).toBe(false);
    }
  });

  it("is idempotent", () => {
    const fit = gamutFitOklch({ L: 0.5, C: 0.4, h: 30 });
    expect(gamutFitOklch(fit)).toBe(fit);
  });

  it("L above 1 or below 0 never fits: chroma collapses to 0 and L is NOT clamped (v1 behaviour)", () => {
    expect(gamutFitOklch({ L: 1.2, C: 0.1, h: 200 })).toEqual({ L: 1.2, C: 0, h: 200 });
    expect(gamutFitOklch({ L: -0.2, C: 0.1, h: 200 })).toEqual({ L: -0.2, C: 0, h: 200 });
    expect(gamutFitOklch({ L: 3, C: 0, h: 0 })).toEqual({ L: 3, C: 0, h: 0 });
  });

  it("the L out-of-range results still convert to white / black via oklchToHexFitted", () => {
    expect(oklchToHexFitted({ L: 1.2, C: 0.1, h: 200 })).toBe("#ffffff");
    expect(oklchToHexFitted({ L: -0.2, C: 0.1, h: 200 })).toBe("#000000");
  });

  it("NaN lightness or chroma collapses to C=0 without throwing", () => {
    expect(gamutFitOklch({ L: NaN, C: 0.1, h: 30 }).C).toBe(0);
    expect(gamutFitOklch({ L: 0.5, C: NaN, h: 30 }).C).toBe(0);
  });

  it("negative chroma is bisected towards 0 rather than rejected (v1 quirk)", () => {
    const fit = gamutFitOklch({ L: 0.5, C: -0.1, h: 30 });
    expect(fit.C).toBeLessThanOrEqual(0);
    expect(fit.C).toBeGreaterThanOrEqual(-0.1);
    expect(fit.L).toBe(0.5);
    expect(fit.h).toBe(30);
  });

  it("hue stays put while fitting: the fitted colour's hue matches the input hue", () => {
    const c = { L: 0.6, C: 0.35, h: 140 };
    const fit = gamutFitOklch(c);
    const back = oklabToLch(lchToOklab(fit));
    expect(back.h).toBeCloseTo(c.h, 6);
  });

  it("oklchToHexFitted always yields a valid #rrggbb, even for wild input", () => {
    const rand = mulberry32(22);
    for (let i = 0; i < 500; i++) {
      const lch = { L: rand() * 1.4 - 0.2, C: rand() * 0.6, h: rand() * 1080 - 360 };
      expect(oklchToHexFitted(lch)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("complementHex", () => {
  it("rotates hue by 180 degrees in OKLCH for chromatic colours", () => {
    for (const hex of randomHexes(100, 24)) {
      const a = hexToOklch(hex);
      if (a.C < 0.05) continue;
      const b = hexToOklch(complementHex(hex));
      if (b.C < 0.02) continue; // fitting may collapse chroma at the gamut tip
      const diff = Math.abs(((a.h - b.h + 540) % 360) - 180);
      expect(180 - diff).toBeLessThan(6); // 8-bit quantisation + gamut fit
    }
  });

  it("mirrors lightness for near-achromatic input", () => {
    expect(complementHex("#000000")).toBe("#ffffff");
    expect(complementHex("#ffffff")).toBe("#000000");
    const mid = hexToOklch(complementHex("#808080"));
    expect(mid.L).toBeCloseTo(1 - hexToOklch("#808080").L, 1);
    expect(mid.C).toBeLessThan(0.01);
  });

  it("always returns a valid hex", () => {
    for (const hex of randomHexes(300, 25)) expect(complementHex(hex)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

// ── parseName and prototype keys (Phase 0 task 8) ────────────────────────────

describe("parseName", () => {
  it("resolves every CSS named colour and nothing else", () => {
    expect(CSS_COLOR_NAMES).toHaveLength(148);
    for (const [name, hex] of Object.entries(CSS_NAMED_COLORS)) {
      expect(parseName(name)).toBe(hex);
    }
  });

  it("tolerates case, spaces, hyphens, underscores and the ~ / nearest: prefixes", () => {
    expect(parseName("RED")).toBe("#ff0000");
    expect(parseName("  Dark Blue ")).toBe("#00008b");
    expect(parseName("dark-blue")).toBe("#00008b");
    expect(parseName("dark_blue")).toBe("#00008b");
    expect(parseName("~tomato")).toBe("#ff6347");
    expect(parseName("nearest: teal")).toBe("#008080");
    expect(parseName("nearest:teal")).toBe("#008080");
  });

  it("returns null for unknown names, empty input and 'transparent'", () => {
    for (const s of ["", "   ", "notacolor", "transparent", "currentcolor", "red!"]) {
      expect(parseName(s)).toBeNull();
    }
  });

  // These Object.prototype keys already return null today, but only by accident:
  // parseName lowercases and strips '_' before the lookup, so 'toString' becomes
  // 'tostring' and '__proto__' becomes 'proto'. Keep them as regression guards for
  // when the lookup moves to an own-property check.
  it.each(["toString", "__proto__", "hasOwnProperty", "valueOf", "isPrototypeOf", "toLocaleString", "__defineGetter__"])(
    "prototype key %s is not a colour",
    (key) => {
      expect(parseName(key)).toBeNull();
      expect(parseAnyColor(key)).toBeNull();
    },
  );

  it("premise: 'constructor' survives the lowercasing and resolves to an Object member", () => {
    expect(typeof parseName("constructor")).toBe("function");
    expect(parseName("constructor")).toBe(Object);
    expect(typeof parseAnyColor("constructor")).toBe("function");
  });

  // DEFECT-3: the lookup `CSS_NAMED_COLORS[key] ?? null` walks the prototype chain.
  // 'constructor' is the only Object.prototype key left intact after the
  // normalisation, but the fix must be an own-property lookup, not more normalising.
  it.fails("DEFECT-3: parseName('constructor') returns null", () => {
    expect(parseName("constructor")).toBeNull();
  });

  // DEFECT-3: same lookup, reached via the paste path.
  it.fails("DEFECT-3: parseAnyColor('constructor') returns null", () => {
    expect(parseAnyColor("constructor")).toBeNull();
  });

  // DEFECT-3: casing / prefix variants all reach the same member.
  it.fails("DEFECT-3: variants of 'constructor' are rejected too", () => {
    for (const s of ["Constructor", "CONSTRUCTOR", "~constructor", "nearest: constructor", "con-structor"]) {
      expect(parseName(s)).toBeNull();
    }
  });

  // DEFECT-3 (type contract): the return type is string | null, so the result must
  // never be anything else for ANY input string.
  it.fails("DEFECT-3: parseName only ever returns a #rrggbb string or null", () => {
    for (const key of Object.getOwnPropertyNames(Object.prototype)) {
      const r = parseName(key);
      expect(r === null || (typeof r === "string" && /^#[0-9a-f]{6}$/.test(r))).toBe(true);
    }
  });
});

// ── parseHsl heuristic and the other parsers ─────────────────────────────────

describe("parseHsl bare <= 1 heuristic (pinned v1 behaviour)", () => {
  it("values with a % sign are taken literally", () => {
    expect(parseHsl("hsl(120, 50%, 50%)")).toBe("#40bf40");
    expect(hexToRgb(parseHsl("hsl(120, 1%, 1%)")!).g).toBeLessThan(5);
  });

  it("bare numbers <= 1 are fractions of 100 (0.5 -> 50%)", () => {
    expect(parseHsl("hsl(120, 0.5, 0.5)")).toBe("#40bf40");
    expect(parseHsl("hsl(120, 0.5, 0.5)")).toBe(parseHsl("hsl(120, 50%, 50%)"));
  });

  it("bare 1 means 100%, but '1%' means 1% - and 2 means 2%", () => {
    expect(parseHsl("hsl(120, 1, 1)")).toBe("#ffffff"); // l = 100% -> white
    expect(parseHsl("hsl(120, 1, 0.5)")).toBe("#00ff00"); // s = 100%, l = 50%
    expect(parseHsl("hsl(120, 1%, 50%)")).not.toBe(parseHsl("hsl(120, 1, 50)")); // 1% vs 100%
    const two = hexToRgb(parseHsl("hsl(120, 2, 50)")!);
    expect(Math.abs(two.r - two.g)).toBeLessThan(10); // 2% saturation is nearly grey (100% would be 255)
  });

  it("0 stays 0 (not rescaled)", () => {
    expect(parseHsl("hsl(120, 0, 0)")).toBe("#000000");
    expect(parseHsl("120 0 0")).toBe("#000000");
  });

  it("each of saturation and lightness is judged on its own", () => {
    expect(parseHsl("hsl(120, 50, 0.5)")).toBe("#40bf40"); // 50 literal, 0.5 -> 50
  });

  it("hue units: deg, turn, rad, grad", () => {
    expect(parseHsl("hsl(0.5turn 100% 50%)")).toBe(parseHsl("hsl(180 100% 50%)"));
    expect(parseHsl("hsl(3.14159rad 100% 50%)")).toBe(parseHsl("hsl(180 100% 50%)"));
    expect(parseHsl("hsl(200grad 100% 50%)")).toBe(parseHsl("hsl(180 100% 50%)"));
    expect(parseHsl("hsl(210deg 50% 40% / 80%)")).toBe(parseHsl("hsl(210, 50%, 40%)"));
  });

  it("hue wraps: 360 = 0, -120 = 240, 720 = 0", () => {
    expect(parseHsl("hsl(360, 100%, 50%)")).toBe("#ff0000");
    expect(parseHsl("hsl(-120, 100%, 50%)")).toBe("#0000ff");
    expect(parseHsl("hsl(720, 100%, 50%)")).toBe("#ff0000");
  });

  it("needs three numbers", () => {
    expect(parseHsl("hsl(120, 100%)")).toBeNull();
    expect(parseHsl("")).toBeNull();
  });

  it("out-of-range saturation / lightness are clamped", () => {
    expect(parseHsl("hsl(120, 150%, 50%)")).toBe(parseHsl("hsl(120, 100%, 50%)"));
    expect(parseHsl("hsl(120, 50%, 120%)")).toBe("#ffffff");
  });
});

describe("parseHex / parseRgb", () => {
  it("accepts 3, 4, 6 and 8 digits, with or without '#', any case", () => {
    expect(parseHex("#fff")).toBe("#ffffff");
    expect(parseHex("FFF")).toBe("#ffffff");
    expect(parseHex("#ffff")).toBe("#ffffff"); // alpha dropped
    expect(parseHex("#ABCDEF")).toBe("#abcdef");
    expect(parseHex("abcdef")).toBe("#abcdef");
    expect(parseHex("#abcdef80")).toBe("#abcdef");
    expect(parseHex("  #123456  ")).toBe("#123456");
  });

  it("rejects wrong lengths and non-hex characters", () => {
    for (const s of ["", "#", "#12", "#12345", "#1234567", "#ggg", "#12345g", "0x123456"]) {
      expect(parseHex(s)).toBeNull();
    }
  });

  it("parseRgb: functional, space-separated, percent and bare triples", () => {
    expect(parseRgb("rgb(255, 0, 0)")).toBe("#ff0000");
    expect(parseRgb("rgb(255 0 0 / 50%)")).toBe("#ff0000");
    expect(parseRgb("rgba(1,2,3,.5)")).toBe("#010203");
    expect(parseRgb("rgb(100%, 50%, 0%)")).toBe("#ff8000");
    expect(parseRgb("12 34 56")).toBe("#0c2238");
  });

  it("parseRgb clamps out of range channels and rounds fractions", () => {
    expect(parseRgb("rgb(300, -5, 128)")).toBe("#ff0080");
    expect(parseRgb("rgb(1.5, 2.5, 3.5)")).toBe("#020304");
  });

  it("parseRgb needs three numbers", () => {
    expect(parseRgb("rgb(1, 2)")).toBeNull();
    expect(parseRgb("rgb()")).toBeNull();
  });
});

describe("parseAnyColor", () => {
  it("dispatches by notation", () => {
    expect(parseAnyColor("#f00")).toBe("#ff0000");
    expect(parseAnyColor("rgb(0, 255, 0)")).toBe("#00ff00");
    expect(parseAnyColor("hsl(240, 100%, 50%)")).toBe("#0000ff");
    expect(parseAnyColor("rebeccapurple")).toBe("#663399");
    expect(parseAnyColor("ff0000")).toBe("#ff0000");
    expect(parseAnyColor("255, 128, 0")).toBe("#ff8000");
    expect(parseAnyColor("50% 20% 100%")).not.toBeNull(); // percent triple -> HSL
  });

  it("refuses text holding several colours or a gradient", () => {
    for (const s of [
      "linear-gradient(red, blue)",
      "#fff #000",
      "rgb(1,2,3) rgb(4,5,6)",
      "hsl(10 20% 30%) extra",
    ]) {
      expect(parseAnyColor(s)).toBeNull();
    }
  });

  it("returns null for empty and unparseable text", () => {
    for (const s of ["", "   ", "hello", "transparent", "1", "1 2", "12abc"]) {
      expect(parseAnyColor(s)).toBeNull();
    }
  });
});

// ── Round trips (Phase 0 task 8) ─────────────────────────────────────────────

describe("parse -> format -> parse round trips", () => {
  const hexes = randomHexes(2000, 31);

  it("hex: parseHex(formatHex(x)) === x", () => {
    for (const hex of hexes) {
      expect(formatHex(hex)).toBe(hex.toUpperCase());
      expect(parseHex(formatHex(hex))).toBe(hex);
      expect(parseAnyColor(formatHex(hex))).toBe(hex);
    }
  });

  it("rgb: parseRgb(formatRgb(x)) === x", () => {
    for (const hex of hexes) {
      expect(parseRgb(formatRgb(hex))).toBe(hex);
      expect(parseAnyColor(formatRgb(hex))).toBe(hex);
    }
  });

  it("precise HSL is lossless: hslToHex(hexToHslPrecise(x)) === x", () => {
    for (const hex of hexes) expect(hslToHex(hexToHslPrecise(hex))).toBe(hex);
  });

  it("integer HSL is lossy but bounded (documented ~10% exact, a few levels off)", () => {
    let exact = 0;
    for (const hex of hexes) {
      const back = parseHsl(formatHsl(hex));
      expect(back).not.toBeNull();
      expect(maxChannelError(hex, back!)).toBeLessThanOrEqual(6);
      if (back === hex) exact++;
    }
    expect(exact / hexes.length).toBeLessThan(0.2);
    expect(exact / hexes.length).toBeGreaterThan(0.05);
    for (const hex of hexes.slice(0, 200)) expect(parseAnyColor(formatHsl(hex))).toBe(parseHsl(formatHsl(hex)));
  });

  it("formatHsl output is always parseable and stable after the first trip", () => {
    // Re-encoding an already-rounded colour may still drift by a level or so (the
    // doc comment on rgbToHsl warns about this), but never by more than 1 step.
    for (const hex of hexes.slice(0, 500)) {
      const once = parseHsl(formatHsl(hex))!;
      const twice = parseHsl(formatHsl(once))!;
      expect(maxChannelError(once, twice)).toBeLessThanOrEqual(2);
    }
  });

  it("names: every CSS name round-trips through its hex and back to a name for the same hex", () => {
    for (const [name, hex] of Object.entries(CSS_NAMED_COLORS)) {
      expect(parseName(name)).toBe(hex);
      const m = nearestColorName(hex);
      expect(m.exact).toBe(true);
      expect(CSS_NAMED_COLORS[m.name]).toBe(hex);
      expect(parseName(formatName(hex))).toBe(hex);
      expect(parseAnyColor(formatName(hex))).toBe(hex);
      expect(formatNameDisplay(hex)).toBe(m.name);
    }
  });

  it("aliases resolve to the first-listed spelling (aqua over cyan, gray over grey)", () => {
    expect(nearestColorName("#00ffff").name).toBe("aqua");
    expect(nearestColorName("#808080").name).toBe("gray");
    expect(nearestColorName("#ff00ff").name).toBe("fuchsia");
    expect(nearestColorName("#a9a9a9").name).toBe("darkgray");
  });

  it("non-exact colours get the ~ / nearest: forms, and the ~ form parses back to the NAMED colour", () => {
    const hex = "#123456";
    const m = nearestColorName(hex);
    expect(m).toEqual({ name: "midnightblue", exact: false });
    expect(formatName(hex)).toBe("~midnightblue");
    expect(formatNameDisplay(hex)).toBe("nearest: midnightblue");
    expect(parseName(formatName(hex))).toBe(CSS_NAMED_COLORS.midnightblue);
    expect(parseName(formatNameDisplay(hex))).toBe(CSS_NAMED_COLORS.midnightblue);
  });

  it("nearestColorName is case-insensitive on the hex input", () => {
    expect(nearestColorName("#FF0000")).toEqual({ name: "red", exact: true });
  });
});

// ── HSL conversions ──────────────────────────────────────────────────────────

describe("rgb <-> hsl", () => {
  it("primaries and greys", () => {
    expect(rgbToHslPrecise({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, l: 50 });
    expect(rgbToHslPrecise({ r: 0, g: 255, b: 0 })).toEqual({ h: 120, s: 100, l: 50 });
    expect(rgbToHslPrecise({ r: 0, g: 0, b: 255 })).toEqual({ h: 240, s: 100, l: 50 });
    expect(rgbToHslPrecise({ r: 128, g: 128, b: 128 }).s).toBe(0);
    expect(rgbToHslPrecise({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, l: 0 });
    expect(rgbToHslPrecise({ r: 255, g: 255, b: 255 })).toEqual({ h: 0, s: 0, l: 100 });
  });

  it("rgbToHsl rounds and never returns hue 360", () => {
    // A hue that rounds to 360 must wrap to 0.
    const hsl = rgbToHsl({ r: 255, g: 0, b: 1 });
    expect(hsl.h).toBe(0);
    for (const hex of randomHexes(1000, 41)) {
      const { h, s, l } = hexToHsl(hex);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
      expect(l).toBeGreaterThanOrEqual(0);
      expect(l).toBeLessThanOrEqual(100);
      expect(Number.isInteger(h) && Number.isInteger(s) && Number.isInteger(l)).toBe(true);
    }
  });

  it("hslToRgb normalises hue and clamps s / l", () => {
    expect(hslToRgb({ h: 360, s: 100, l: 50 })).toEqual({ r: 255, g: 0, b: 0 });
    expect(hslToRgb({ h: -120, s: 100, l: 50 })).toEqual({ r: 0, g: 0, b: 255 });
    expect(hslToRgb({ h: 720, s: 100, l: 50 })).toEqual({ r: 255, g: 0, b: 0 });
    expect(hslToRgb({ h: 180, s: 150, l: 50 })).toEqual(hslToRgb({ h: 180, s: 100, l: 50 }));
    expect(hslToRgb({ h: 180, s: -20, l: 50 })).toEqual({ r: 128, g: 128, b: 128 });
    expect(hslToRgb({ h: 90, s: 50, l: 120 })).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("hexToHslPrecise preserves what hexToHsl rounds away", () => {
    const precise = hexToHslPrecise("#336699");
    const rounded = hexToHsl("#336699");
    expect(Math.round(precise.h) % 360).toBe(rounded.h);
    expect(Math.round(precise.s)).toBe(rounded.s);
    expect(Math.round(precise.l)).toBe(rounded.l);
  });
});

describe("formatters", () => {
  it("shapes", () => {
    expect(formatHex("#ff8000")).toBe("#FF8000");
    expect(formatRgb("#ff8000")).toBe("rgb(255, 128, 0)");
    expect(formatHsl("#ff8000")).toBe("hsl(30, 100%, 50%)");
    expect(formatName("#ff0000")).toBe("red");
  });

  it("rgbToOklab / rgbToHex agree through hex for named colours", () => {
    for (const hex of Object.values(CSS_NAMED_COLORS)) {
      expect(rgbToHex(hexToRgb(hex))).toBe(hex);
      expect(Number.isFinite(rgbToOklab(hexToRgb(hex)).L)).toBe(true);
    }
  });
});
