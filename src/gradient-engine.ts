// ── Gradient Engine ────────────────────────────────────────────────────────────
// Pure functions for gradient color math, quality scoring, and suggestion.
// Zero dependencies — no React, no DOM, no side effects.

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface OklabColor {
  L: number;
  a: number;
  b: number;
}

export interface LchColor {
  L: number;
  C: number;
  h: number;
}

export interface GradientTick {
  id: number;
  color: string;
  position: number;
}

export interface ScoreDetails {
  lightness: number;
  hue: number;
  chroma: number;
  spacing: number;
}

export interface GradientScore {
  score: number;
  issues: string[];
  details: ScoreDetails;
}

// ── OKLAB color math ──────────────────────────────────────────────────────────

export function srgbToLinear(c: number): number {
  c = c / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  const clamped = clamp(c, 0, 1);
  return Math.round(
    255 *
      (clamped <= 0.0031308
        ? 12.92 * clamped
        : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055),
  );
}

export function hexToRgb(hex: string): RGB {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

export function rgbToHex({ r, g, b }: RGB): string {
  return (
    "#" +
    [r, g, b]
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

export function rgbToOklab({ r, g, b }: RGB): OklabColor {
  const lr = srgbToLinear(r),
    lg = srgbToLinear(g),
    lb = srgbToLinear(b);

  const l = Math.cbrt(
    0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
  );
  const m = Math.cbrt(
    0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb,
  );
  const s = Math.cbrt(
    0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb,
  );

  return {
    L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  };
}

/**
 * OKLAB → *linear* sRGB, without clamping or gamma encoding.
 * Values outside 0..1 mean the color falls outside the sRGB gamut, so this is
 * the primitive gamut-mapping code needs (see `gamutFitOklch`).
 */
export function oklabToLinearRgb({ L, a, b }: OklabColor): RGB {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ * l_ * l_,
    m = m_ * m_ * m_,
    s = s_ * s_ * s_;

  return {
    r: +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

export function oklabToRgb(lab: OklabColor): RGB {
  const { r, g, b } = oklabToLinearRgb(lab);
  return { r: linearToSrgb(r), g: linearToSrgb(g), b: linearToSrgb(b) };
}

// ── Convenience conversions ───────────────────────────────────────────────────

/** Hex string → OKLCH in one step. */
export function hexToOklch(hex: string): LchColor {
  return oklabToLch(rgbToOklab(hexToRgb(hex)));
}

/** OKLCH → hex string in one step. */
export function oklchToHex(lch: LchColor): string {
  return rgbToHex(oklabToRgb(lchToOklab(lch)));
}

export function oklabToLch({ L, a, b }: OklabColor): LchColor {
  const C = Math.sqrt(a * a + b * b);
  const h = Math.atan2(b, a) * (180 / Math.PI);
  return { L, C, h: ((h % 360) + 360) % 360 };
}

export function lchToOklab({ L, C, h }: LchColor): OklabColor {
  const hr = h * (Math.PI / 180);
  return { L, a: C * Math.cos(hr), b: C * Math.sin(hr) };
}

// ── Gradient quality scoring ──────────────────────────────────────────────────

/** Euclidean distance in OKLAB — perceptually uniform. */
function oklabDeltaE(a: OklabColor, b: OklabColor): number {
  return Math.sqrt(
    (a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2,
  );
}

export function scoreGradient(ticks: GradientTick[]): GradientScore {
  if (ticks.length < 2) {
    return {
      score: 0,
      issues: [],
      details: { lightness: 0, hue: 0, chroma: 0, spacing: 0 },
    };
  }

  const oklabs = ticks.map((t) => rgbToOklab(hexToRgb(t.color)));
  const lchs = oklabs.map((lab) => oklabToLch(lab));
  const issues: string[] = [];
  const details: ScoreDetails = { lightness: 0, hue: 0, chroma: 0, spacing: 0 };

  // ── 1. Lightness flow (0-30 pts) ────────────────────────────────────────
  //    - Monotonicity: penalise reversals (interior local extrema)
  //    - Helmholtz–Kohlrausch: perceived brightness ≠ measured L for vivid stops
  //    - Perceptual contrast: penalise near-identical stops (gradient = solid)
  //    - Transition abruptness: penalise big color jumps squeezed into tiny %
  //    - Velocity uniformity: ΔE per position-% should be roughly constant

  const lightnesses = lchs.map((l) => l.L);
  let lightnessScore = 30;

  // 1a. Monotonicity (only meaningful for 3+ stops; 2 stops are trivially monotonic)
  let dips = 0;
  for (let i = 1; i < lightnesses.length - 1; i++) {
    const prev = lightnesses[i - 1],
      cur = lightnesses[i],
      next = lightnesses[i + 1];
    if ((cur < prev && cur < next) || (cur > prev && cur > next)) dips++;
  }
  if (dips > 0) {
    lightnessScore -= dips * 12;
    issues.push(
      `Lightness fluctuates (${dips} reversal${dips > 1 ? "s" : ""}) — creates visual noise`,
    );
  }

  // 1a′. Helmholtz–Kohlrausch perceived-brightness check.
  //      Saturated colors appear brighter than their measured OKLAB L.
  //      A gradient monotonic in L may be non-monotonic in *perceived*
  //      lightness when chroma varies, creating subtle brightness wobble.
  //      First-order model: L_apparent ≈ L + 0.25·C
  const apparentL = lchs.map((l) => l.L + 0.25 * l.C);
  let hkDips = 0;
  for (let i = 1; i < apparentL.length - 1; i++) {
    const prev = apparentL[i - 1],
      cur = apparentL[i],
      next = apparentL[i + 1];
    if ((cur < prev && cur < next) || (cur > prev && cur > next)) hkDips++;
  }
  if (dips === 0 && hkDips > 0) {
    lightnessScore -= 6;
    issues.push(
      "Saturated stops create perceived brightness reversals (Helmholtz–Kohlrausch effect)",
    );
  }

  // 1b. Perceptual contrast — is the gradient visually distinguishable from
  //     a solid color? Compute max OKLAB ΔE between any two stops.
  let maxDeltaE = 0;
  for (let i = 0; i < oklabs.length; i++) {
    for (let j = i + 1; j < oklabs.length; j++) {
      maxDeltaE = Math.max(maxDeltaE, oklabDeltaE(oklabs[i], oklabs[j]));
    }
  }
  // ΔE < 0.02 ≈ imperceptible, 0.05 ≈ barely noticeable
  if (maxDeltaE < 0.02) {
    lightnessScore -= 15;
    issues.push("Stops are nearly identical — gradient is invisible");
  } else if (maxDeltaE < 0.05) {
    lightnessScore -= 8;
    issues.push("Very low contrast between stops — gradient barely visible");
  }

  // 1c. Transition abruptness — large perceptual jump in a tiny position gap.
  //     Neighbouring stops with a big ΔE but squeezed into ≤10% create a harsh
  //     visible edge rather than a smooth transition.
  const sortedByPos = [...ticks]
    .map((t, idx) => ({ tick: t, oklab: oklabs[idx] }))
    .sort((a, b) => a.tick.position - b.tick.position);
  for (let i = 0; i < sortedByPos.length - 1; i++) {
    const gap = sortedByPos[i + 1].tick.position - sortedByPos[i].tick.position;
    const de = oklabDeltaE(sortedByPos[i].oklab, sortedByPos[i + 1].oklab);
    if (gap > 0 && gap <= 10 && de > 0.15) {
      lightnessScore -= 8;
      issues.push("Abrupt color jump between closely-spaced stops");
      break; // one penalty is enough
    }
  }

  // 1d. Perceptual velocity uniformity — ΔE per position-% should be roughly
  //     constant across consecutive stop pairs.  High variance means some
  //     transitions race while others crawl, producing unbalanced rhythm.
  if (sortedByPos.length >= 3) {
    const velocities: number[] = [];
    for (let i = 0; i < sortedByPos.length - 1; i++) {
      const posGap =
        sortedByPos[i + 1].tick.position - sortedByPos[i].tick.position;
      if (posGap > 0) {
        const de = oklabDeltaE(sortedByPos[i].oklab, sortedByPos[i + 1].oklab);
        velocities.push(de / posGap);
      }
    }
    if (velocities.length >= 2) {
      const avgV = velocities.reduce((a, v) => a + v, 0) / velocities.length;
      if (avgV > 0) {
        const variance =
          velocities.reduce((a, v) => a + (v - avgV) ** 2, 0) /
          velocities.length;
        const cv = Math.sqrt(variance) / avgV;
        if (cv > 0.8) {
          lightnessScore -= 8;
          issues.push(
            "Uneven perceptual speed — some transitions race while others crawl",
          );
        } else if (cv > 0.5) {
          lightnessScore -= 4;
          issues.push("Slightly uneven transition speed across the gradient");
        }
      }
    }
  }

  details.lightness = Math.max(0, lightnessScore);

  // ── 2. Hue harmony (0-30 pts) ──────────────────────────────────────────
  //    - Enclosing arc: minimum arc spanning all chromatic hues
  //    - Direction consistency: hue should progress CW or CCW, not zigzag
  const chromaticLchs = lchs.filter((l) => l.C > 0.02);
  let hueScore = 30;
  if (chromaticLchs.length >= 2) {
    const sortedHues = chromaticLchs.map((l) => l.h).sort((a, b) => a - b);
    let maxGap = sortedHues[0] + 360 - sortedHues[sortedHues.length - 1];
    for (let i = 1; i < sortedHues.length; i++) {
      maxGap = Math.max(maxGap, sortedHues[i] - sortedHues[i - 1]);
    }
    const enclosingArc = 360 - maxGap;

    if (enclosingArc > 180) {
      hueScore -= 20;
      issues.push("Hue arc spans >180° — colors clash unexpectedly");
    } else if (enclosingArc > 120) {
      hueScore -= 8;
      issues.push("Wide hue arc (>120°) risks muddy midpoints");
    } else if (enclosingArc < 15) {
      hueScore -= 5;
    }
  }

  // 2b. Hue direction consistency — for 3+ chromatic stops sorted by
  //     gradient position, the hue should progress consistently clockwise
  //     or counter-clockwise.  Reversals in hue direction cause the browser's
  //     sRGB interpolation to cross through muddy intermediate tones.
  const chromaticByPos = sortedByPos
    .map((s) => ({ ...s, lch: oklabToLch(s.oklab) }))
    .filter((s) => s.lch.C > 0.02);
  if (chromaticByPos.length >= 3) {
    const posHues = chromaticByPos.map((s) => s.lch.h);
    let cwCount = 0,
      ccwCount = 0;
    for (let i = 0; i < posHues.length - 1; i++) {
      let delta = posHues[i + 1] - posHues[i];
      delta = (((delta + 180) % 360) + 360) % 360 - 180; // shortest arc
      if (delta > 5) cwCount++;
      else if (delta < -5) ccwCount++;
    }
    if (cwCount > 0 && ccwCount > 0) {
      hueScore -= 10;
      issues.push(
        "Hue path reverses direction — risk of muddy in-between tones",
      );
    }
  }

  details.hue = Math.max(0, hueScore);

  // ── 3. Saturation balance (0-20 pts) ───────────────────────────────────
  //    - Stop-level chroma consistency
  //    - Chroma coherence (achromatic stops among chromatic ones)
  //    - sRGB midpoint desaturation
  //    - Banding risk: 8-bit quantization with low colour resolution
  const chromas = lchs.map((l) => l.C);
  const maxC = Math.max(...chromas),
    minC = Math.min(...chromas);
  const chromaRange = maxC - minC;
  let chromaScore = 20;

  // 3a. Stop-level chroma consistency
  if (chromaRange > 0.20) {
    chromaScore -= 12;
    issues.push("Saturation spikes dramatically — looks unintentional");
  } else if (chromaRange > 0.12) {
    chromaScore -= 5;
    issues.push("Uneven saturation across stops");
  }

  // 3b. Chroma coherence — a near-achromatic stop among vivid chromatic
  //     stops creates a desaturated "hole" that looks off. This is distinct
  //     from just having a wide chroma range; it's a specific visual flaw.
  if (lchs.length >= 3) {
    const achromatic = lchs.filter((l) => l.C < 0.04);
    const chromatic = lchs.filter((l) => l.C >= 0.08);
    if (achromatic.length > 0 && chromatic.length > 0) {
      // Severity: how far apart the achromatic and chromatic extremes are
      const maxChromatic = Math.max(...chromatic.map((l) => l.C));
      const minAchromatic = Math.min(...achromatic.map((l) => l.C));
      const ratio = minAchromatic / maxChromatic; // 0 = total mismatch
      if (ratio < 0.15) {
        chromaScore -= 8;
        issues.push("Grey/desaturated stop among vivid colors — creates a dead zone");
      } else if (ratio < 0.3) {
        chromaScore -= 4;
        issues.push("Noticeable saturation gap between some stops");
      }
    }
  }

  // 3c. Midpoint desaturation check — browsers interpolate in sRGB, which
  //     can produce a muddy grey/brown between two vivid stops.
  let worstDip = 0;
  for (let i = 0; i < sortedByPos.length - 1; i++) {
    const rgb1 = hexToRgb(sortedByPos[i].tick.color);
    const rgb2 = hexToRgb(sortedByPos[i + 1].tick.color);
    const midRgb: RGB = {
      r: Math.round((rgb1.r + rgb2.r) / 2),
      g: Math.round((rgb1.g + rgb2.g) / 2),
      b: Math.round((rgb1.b + rgb2.b) / 2),
    };
    const midLch = oklabToLch(rgbToOklab(midRgb));
    const lch1 = oklabToLch(rgbToOklab(rgb1));
    const lch2 = oklabToLch(rgbToOklab(rgb2));
    const avgEndpointChroma = (lch1.C + lch2.C) / 2;
    if (avgEndpointChroma > 0.04) {
      const dip = 1 - midLch.C / avgEndpointChroma;
      worstDip = Math.max(worstDip, dip);
    }
  }
  if (worstDip > 0.5) {
    chromaScore -= 10;
    issues.push("Colors produce a muddy/grey midpoint when blended");
  } else if (worstDip > 0.3) {
    chromaScore -= 5;
    issues.push("Slight desaturation in gradient midpoints");
  }

  // 3d. Banding risk — when adjacent stops differ by very few 8-bit RGB
  //     levels, the sRGB quantization produces visible "staircase" bands.
  //     max(|ΔR|, |ΔG|, |ΔB|) ≈ number of distinct output colors in a span.
  for (let i = 0; i < sortedByPos.length - 1; i++) {
    const c1 = hexToRgb(sortedByPos[i].tick.color);
    const c2 = hexToRgb(sortedByPos[i + 1].tick.color);
    const rgbSteps = Math.max(
      Math.abs(c1.r - c2.r),
      Math.abs(c1.g - c2.g),
      Math.abs(c1.b - c2.b),
    );
    const posSpan =
      sortedByPos[i + 1].tick.position - sortedByPos[i].tick.position;
    if (rgbSteps < 16 && posSpan > 25) {
      chromaScore -= 6;
      issues.push("Low color resolution between stops — visible banding likely");
      break;
    } else if (rgbSteps < 8 && posSpan > 10) {
      chromaScore -= 4;
      issues.push("Subtle transition may produce banding artifacts on screen");
      break;
    }
  }

  details.chroma = Math.max(0, chromaScore);

  // ── 4. Stop spacing (0-20 pts) ─────────────────────────────────────────
  //    - Edge coverage: first stop near 0%, last stop near 100%
  //    - Transition span: stops should cover a wide range
  //    - Rhythm: gaps between stops should be fairly even (3+ stops)

  const positions = [...ticks.map((t) => t.position)].sort((a, b) => a - b);
  const firstPos = positions[0];
  const lastPos = positions[positions.length - 1];
  let spacingScore = 20;

  // 4a. Edge coverage — how close the outermost stops are to 0% and 100%.
  //     Stops far from the edges create solid-color "dead zones".
  const edgeGap = firstPos + (100 - lastPos); // total uncovered %
  if (edgeGap > 40) {
    spacingScore -= 12;
    issues.push("Stops are bunched in the middle — large solid-color edges");
  } else if (edgeGap > 20) {
    spacingScore -= 6;
    issues.push("Stops don't reach the edges — visible solid-color zones");
  } else if (edgeGap > 10) {
    spacingScore -= 3;
  }

  // 4b. Transition span — the distance between first and last stop.
  //     A very short span means the transition is a thin stripe in the gradient.
  const span = lastPos - firstPos;
  if (span < 20) {
    spacingScore -= 8;
    issues.push("Transition squeezed into a narrow band");
  } else if (span < 40) {
    spacingScore -= 4;
  }

  // 4c. Rhythm — for 3+ stops, check gap evenness via coefficient of variation.
  if (ticks.length > 2) {
    const gaps: number[] = [];
    for (let i = 1; i < positions.length; i++) {
      gaps.push(positions[i] - positions[i - 1]);
    }
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (avgGap > 0) {
      const variance =
        gaps.reduce((a, g) => a + Math.pow(g - avgGap, 2), 0) / gaps.length;
      const cv = Math.sqrt(variance) / avgGap;
      if (cv > 0.5) {
        spacingScore -= 10;
        issues.push("Stop positions are unevenly clustered");
      } else if (cv > 0.25) {
        spacingScore -= 4;
      }
    }
  }
  details.spacing = Math.max(0, spacingScore);

  const total = details.lightness + details.hue + details.chroma + details.spacing;
  return { score: total, issues, details };
}

// ── Gradient suggestion engine ────────────────────────────────────────────────

export function suggestGradient(ticks: GradientTick[]): GradientTick[] {
  if (ticks.length < 2) return ticks;

  // Work in position order so we respect the user's spatial layout.
  const byPos = [...ticks].sort((a, b) => a.position - b.position);
  let lchs = byPos.map((t) => oklabToLch(rgbToOklab(hexToRgb(t.color))));

  // Step 1: Smooth lightness monotonically along the existing direction.
  const firstL = lchs[0].L;
  const lastL = lchs[lchs.length - 1].L;
  lchs = lchs.map((c, i) => {
    const t = i / (lchs.length - 1);
    const targetL = firstL + t * (lastL - firstL);
    return { ...c, L: c.L * 0.3 + targetL * 0.7 };
  });

  // Step 2: Compress hue arc to ≤80° so the gradient scores well and avoids muddy midpoints.
  //   Find the circular mean hue of chromatic stops, then scale each stop's angular
  //   deviation from that mean down until the enclosing arc fits inside 80°.
  const chromatic = lchs.filter((c) => c.C > 0.02);
  if (chromatic.length >= 2) {
    // Circular mean
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const toDeg = (rad: number) => (rad * 180) / Math.PI;
    const meanX = chromatic.reduce((a, c) => a + Math.cos(toRad(c.h)), 0) / chromatic.length;
    const meanY = chromatic.reduce((a, c) => a + Math.sin(toRad(c.h)), 0) / chromatic.length;
    const meanHue = (toDeg(Math.atan2(meanY, meanX)) + 360) % 360;

    // Measure enclosing arc
    const hues = chromatic.map((c) => c.h);
    const sortedH = [...hues].sort((a, b) => a - b);
    let maxGap = sortedH[0] + 360 - sortedH[sortedH.length - 1];
    for (let i = 1; i < sortedH.length; i++) {
      maxGap = Math.max(maxGap, sortedH[i] - sortedH[i - 1]);
    }
    const arc = 360 - maxGap;

    if (arc > 80) {
      const scale = 80 / arc;
      lchs = lchs.map((c) => {
        if (c.C <= 0.02) return c;
        // Signed shortest-path delta from the circular mean
        let delta = c.h - meanHue;
        delta = ((delta + 180) % 360 + 360) % 360 - 180;
        return { ...c, h: ((meanHue + delta * scale) + 360) % 360 };
      });
    }
  }

  // Step 3: Smooth chroma — gentle envelope peaking in the middle.
  const avgC = lchs.reduce((a, c) => a + c.C, 0) / lchs.length;
  lchs = lchs.map((c, i) => {
    const t = i / (lchs.length - 1);
    const envelope = 1 + 0.3 * Math.sin(Math.PI * t);
    return { ...c, C: Math.min(0.4, avgC * envelope) };
  });

  // Step 4: Redistribute stops evenly.
  return lchs.map((lch, i) => ({
    id: byPos[i]?.id ?? i,
    position: Math.round((i / (lchs.length - 1)) * 100),
    color: rgbToHex(oklabToRgb(lchToOklab(lch))),
  }));
}

// ── Gradient CSS builder ──────────────────────────────────────────────────────

export function buildGradientCSS(ticks: GradientTick[], angle: number): string {
  if (ticks.length === 0) return "#ccc";
  const sorted = [...ticks].sort((a, b) => a.position - b.position);
  const stops = sorted.map((t) => `${t.color} ${t.position}%`).join(", ");
  return `linear-gradient(${angle}deg, ${stops})`;
}

// ── Multi-angle gradients ─────────────────────────────────────────────────────

/** Hard ceiling on simultaneous gradient directions. */
export const MAX_DIRECTIONS = 7;

export interface GradientDirection {
  id: number;
  /** CSS angle in degrees: 0 = to top, increasing clockwise. */
  angle: number;
  /** Relative influence of this direction, 1-100. */
  weight: number;
  enabled: boolean;
}

export type GradientBlendMode =
  | "normal"
  | "screen"
  | "multiply"
  | "overlay"
  | "soft-light"
  | "hard-light"
  | "difference"
  | "lighten"
  | "darken";

export interface GradientStyle {
  background: string;
  backgroundBlendMode: string;
}

/** `#rrggbb` + alpha → `rgba(r, g, b, a)`. */
function rgbaString(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.round(clamp(alpha, 0, 1) * 1000) / 1000})`;
}

/**
 * Compose the same stop list into up to `MAX_DIRECTIONS` stacked linear-gradient
 * layers, one per direction, producing a single multi-angle field.
 *
 * With `blend: "normal"` the layers are alpha-composited so the result is the
 * exact weighted average of every direction. Painting bottom-to-top with
 * `alpha_k = w_k / (w_1 + … + w_k)` makes layer k contribute exactly
 * `w_k / Σw` — the standard progressive-average trick. Other blend modes hand
 * the layers to `background-blend-mode` instead, with alpha scaled against the
 * heaviest direction so weights still read as intensity.
 *
 * Note that CSS lists background layers top-first, so the emitted lists are
 * reversed relative to the paint order reasoned about above.
 */
export function buildMultiGradientStyle(
  ticks: GradientTick[],
  directions: GradientDirection[],
  blend: GradientBlendMode = "normal",
): GradientStyle {
  if (ticks.length === 0) return { background: "#ccc", backgroundBlendMode: "normal" };

  const active = directions.filter((d) => d.enabled && d.weight > 0);
  if (active.length === 0) {
    // Nothing to project — fall back to a flat wash of the first stop.
    const sorted = [...ticks].sort((a, b) => a.position - b.position);
    return { background: sorted[0].color, backgroundBlendMode: "normal" };
  }

  const sorted = [...ticks].sort((a, b) => a.position - b.position);
  const maxWeight = Math.max(...active.map((d) => d.weight));

  let cumulative = 0;
  const layers = active.map((d) => {
    cumulative += d.weight;
    const alpha = blend === "normal" ? d.weight / cumulative : d.weight / maxWeight;
    const stops = sorted
      .map((t) => `${rgbaString(t.color, alpha)} ${t.position}%`)
      .join(", ");
    return `linear-gradient(${d.angle}deg, ${stops})`;
  });

  // The bottom layer has nothing beneath it to blend with, so it stays normal.
  const modes = active.map((_, i) => (i === 0 ? "normal" : blend));

  return {
    background: layers.reverse().join(", "),
    backgroundBlendMode: modes.reverse().join(", "),
  };
}

/** `n` directions spread evenly around the circle, starting at `start`. */
export function spreadDirectionAngles(n: number, start = 135): number[] {
  const count = Math.max(1, Math.min(MAX_DIRECTIONS, n));
  return Array.from({ length: count }, (_, i) =>
    Math.round((start + (i * 360) / count) % 360),
  );
}

// ── Gradient interpolation ────────────────────────────────────────────────────

/**
 * Sample `n` evenly-spaced colors from a gradient, interpolated in OKLAB space.
 * Returns an array of hex color strings.
 */
export function interpolateGradient(ticks: GradientTick[], n: number): string[] {
  if (ticks.length === 0) return [];
  if (ticks.length === 1 || n <= 1) return [ticks[0].color];

  const sorted = [...ticks].sort((a, b) => a.position - b.position);
  const labs = sorted.map((t) => ({
    pos: t.position / 100,
    lab: rgbToOklab(hexToRgb(t.color)),
  }));

  const result: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1); // 0..1

    // Find the two stops that bracket t
    let lo = 0;
    let hi = labs.length - 1;
    for (let j = 0; j < labs.length - 1; j++) {
      if (labs[j + 1].pos >= t) {
        lo = j;
        hi = j + 1;
        break;
      }
    }

    const span = labs[hi].pos - labs[lo].pos;
    const frac = span === 0 ? 0 : (t - labs[lo].pos) / span;

    const a = labs[lo].lab;
    const b = labs[hi].lab;
    const mixed: OklabColor = {
      L: a.L + (b.L - a.L) * frac,
      a: a.a + (b.a - a.a) * frac,
      b: a.b + (b.b - a.b) * frac,
    };

    result.push(rgbToHex(oklabToRgb(mixed)));
  }
  return result;
}
