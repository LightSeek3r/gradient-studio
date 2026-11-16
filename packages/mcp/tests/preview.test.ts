import { describe, expect, it } from "vitest";
import { base64Ascii, gradientLine, hex, num, renderSvg } from "../src/svg";
import { callTool, type ToolResult } from "../src/handlers";
import { errorText, preview, sc } from "./helpers";

const N = String.raw`-?\d{1,12}(?:\.\d{1,4})?`;
/** The whole document must match this: fixed template, hex colours and decimals only. */
const SAFE_SVG = new RegExp(
  String.raw`^<svg xmlns="http://www\.w3\.org/2000/svg" width="\d+" height="\d+" viewBox="0 0 \d+ \d+" role="img" aria-label="Gradient preview">` +
    String.raw`<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="${N}" y1="${N}" x2="${N}" y2="${N}">` +
    String.raw`(?:<stop offset="\d(?:\.\d{1,4})?" stop-color="#[0-9a-f]{6}"(?: stop-opacity="\d(?:\.\d{1,4})?")?/>)+` +
    String.raw`</linearGradient></defs><rect width="\d+" height="\d+" fill="url\(#g\)"/></svg>$`,
);

const svgOf = (r: ToolResult): string => {
  expect(r.isError).toBeUndefined();
  const t = r.content[1];
  if (t.type !== "text") throw new Error("expected a text block");
  return t.text;
};

describe("render_preview: output", () => {
  const r = preview({ stops: [{ color: "#ff0000" }, { color: "#0000ff" }], angle: 90, width: 200, height: 100 });

  it("returns an SVG image block plus the SVG source as text", () => {
    expect(r.content).toHaveLength(2);
    const [img, txt] = r.content;
    expect(img.type).toBe("image");
    if (img.type === "image") {
      expect(img.mimeType).toBe("image/svg+xml");
      expect(atob(img.data)).toBe(svgOf(r));
    }
    expect(txt.type).toBe("text");
  });

  it("produces a document that matches the fixed template", () => {
    expect(svgOf(r)).toMatch(SAFE_SVG);
    expect(svgOf(r)).toContain('width="200" height="100" viewBox="0 0 200 100"');
    expect(svgOf(r)).toContain('<stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/>');
  });

  it("describes what was drawn in structuredContent", () => {
    const out = sc(r);
    expect(out).toMatchObject({ mimeType: "image/svg+xml", width: 200, height: 100, angle: 90, interpolation: "srgb" });
    expect(out.stops).toEqual([{ color: "#ff0000", positionPercent: 0 }, { color: "#0000ff", positionPercent: 100 }]);
    expect(typeof out.smoothnessScore).toBe("number");
  });

  it("defaults to 480 x 270", () => {
    expect(svgOf(preview({ stops: [{ color: "red" }, { color: "blue" }] }))).toContain('width="480" height="270"');
  });

  it("draws the gradient line for the CSS angle", () => {
    const line = (a: number) => gradientLine(200, 100, a);
    const east = line(90);
    expect([east.x1, east.y1, east.x2, east.y2].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 50, 200, 50]);
    expect(line(180).y1).toBeCloseTo(0);
    expect(line(180).y2).toBeCloseTo(100);
    expect(line(0).y1).toBeCloseTo(100);
    expect(line(0).y2).toBeCloseTo(0);
    const sq = gradientLine(100, 100, 45);
    expect(sq.x1).toBeCloseTo(0);
    expect(sq.y1).toBeCloseTo(100);
    expect(sq.x2).toBeCloseTo(100);
    expect(sq.y2).toBeCloseTo(0);
  });

  it("keeps positions and hard stops, and writes stop-opacity for translucent stops", () => {
    const s = svgOf(preview({ css: "linear-gradient(90deg, #ff0000 0%, #ff0000 50%, rgb(0 0 255 / 0.25) 50%, rgb(0 0 255 / 0.25) 100%)" }));
    expect(s).toMatch(SAFE_SVG);
    expect(s).toContain('<stop offset="0.5" stop-color="#ff0000"/><stop offset="0.5" stop-color="#0000ff" stop-opacity="0.25"/>');
  });

  it("pre-samples oklab and oklch gradients so the picture matches the CSS", () => {
    const s = svgOf(preview({ css: "linear-gradient(90deg in oklch, #ff0000, #0000ff)" }));
    expect(s).toMatch(SAFE_SVG);
    expect(s.match(/<stop /g)!.length).toBeGreaterThan(10);
    expect(sc(preview({ css: "linear-gradient(in oklab, red, blue)" })).interpolation).toBe("oklab");
  });

  it("picks the gradient by index when css holds several", () => {
    const css = "a{background:linear-gradient(red, blue)} b{background:linear-gradient(#00ff00, #ffff00)}";
    expect(svgOf(preview({ css, index: 1 }))).toContain('stop-color="#00ff00"');
    expect(svgOf(preview({ css }))).toContain('stop-color="#ff0000"');
  });

  it("is deterministic", () => {
    const a = JSON.stringify(preview({ css: "linear-gradient(in oklch, red, blue)" }));
    expect(JSON.stringify(preview({ css: "linear-gradient(in oklch, red, blue)" }))).toBe(a);
  });

  it("reports parser warnings (corner keywords depend on the box)", () => {
    const out = sc(preview({ css: "linear-gradient(to top right, red, blue)" }));
    expect(out.warnings.map((w: { code: string }) => w.code)).toContain("corner-angle");
  });
});

describe("render_preview: refusals", () => {
  it.each([
    ["radial gradients", { css: "radial-gradient(red, blue)" }, /unsupported-kind/],
    ["var()", { css: "linear-gradient(var(--a), blue)" }, /var/],
    ["repeating gradients", { css: "repeating-linear-gradient(red 0%, blue 20%)" }, /repeating/],
    ["text with no gradient", { css: "color: red" }, /no gradient function was found/],
    ["an index past the end", { css: "linear-gradient(red, blue)", index: 3 }, /index: 3 is out of range \(1 gradient\(s\) found\)/],
    ["positions outside 0-100%", { css: "linear-gradient(red -10%, blue 120%)" }, /outside 0-100%/],
    ["css and stops together", { css: "x", stops: [{ color: "red" }, { color: "blue" }] }, /not both/],
    ["neither css nor stops", {}, /give `css`/],
    ["width below 16", { css: "linear-gradient(red, blue)", width: 15 }, /width: must be at least 16/],
    ["width above 2048", { css: "linear-gradient(red, blue)", width: 2049 }, /width: must be at most 2048/],
    ["a fractional height", { css: "linear-gradient(red, blue)", height: 100.5 }, /height: expected an integer/],
    ["a negative index", { css: "linear-gradient(red, blue)", index: -1 }, /index: must be at least 0/],
  ])("refuses %s with a clear message", (_n, args, pattern) => {
    const r = preview(args);
    expect(r.isError).toBe(true);
    expect(errorText(r)).toMatch(pattern);
  });
});

describe("render_preview: SVG injection", () => {
  const hostile = [
    '"><script>alert(1)</script>',
    'red" onload="alert(1)',
    "red;}</style><script>alert(1)</script>",
    '#ff0000"/><script>alert(1)</script>',
    "javascript:alert(1)",
    "url(javascript:alert(1))",
    "red\n<svg onload=alert(1)>",
    "</stop></linearGradient><script>",
    "&lt;script&gt;",
    "\u0000",
    "<!--",
    "]]>",
    "#ff0000 \"/><image href=x onerror=1/>",
    "x".repeat(150),
  ];

  it.each(hostile)("rejects %j as a structured-stop colour", (bad) => {
    const r = preview({ stops: [{ color: bad }, { color: "blue" }] });
    expect(r.isError).toBe(true);
    expect(errorText(r)).not.toMatch(/<script>/);
  });

  it.each(hostile)("never lets %j reach the SVG when it is inside css", (bad) => {
    const inside = callTool("render_preview", { css: `linear-gradient(${bad}, blue)` });
    expect(inside.isError).toBe(true);
    const after = callTool("render_preview", { css: `a{background:linear-gradient(red, blue)}${bad}` });
    if (!after.isError) {
      const s = svgOf(after);
      expect(s).toMatch(SAFE_SVG);
      expect(s).not.toMatch(/script|onload|onerror|javascript|<image|CDATA|<!--/i);
    }
  });

  it.each([
    ['480"><script>alert(1)</script>', "width"],
    ["100%", "width"],
    ["1e3", "height"],
    [1e21, "width"],
    [Infinity, "height"],
    [NaN, "width"],
    [-5, "height"],
    [null, "width"],
    [{ toString: () => '1"><script>' }, "height"],
    [[100], "width"],
  ])("rejects %j as %s", (bad, key) => {
    const r = preview({ css: "linear-gradient(red, blue)", [key as string]: bad });
    expect(r.isError).toBe(true);
  });

  it.each([
    ['90deg"><script>', "angle"],
    ['"><script>', "interpolation"],
    ["srgb", "interpolation-unknown-key"],
    ['0"><script>', "index"],
    [Infinity, "angle"],
  ])("rejects %j as %s", (bad, key) => {
    const r = preview({ stops: [{ color: "red" }, { color: "blue" }], [key as string]: bad });
    expect(r.isError).toBe(true);
  });

  it("rejects unknown properties that could smuggle attributes", () => {
    for (const key of ["onload", "fill", "title", "style", "id", "href", "__proto__"]) {
      const args = JSON.parse(`{"css":"linear-gradient(red, blue)","${key}":"x\\"><script>"}`);
      expect(preview(args).isError).toBe(true);
    }
  });

  it("copies nothing the caller wrote into the document: output differs only in allow-listed values", () => {
    const marker = "MARKER_" + "ZZ".repeat(8);
    const r = preview({ css: `/* ${marker} */ .${marker}{background:linear-gradient(red, blue)} /* ${marker} */` });
    const s = svgOf(r);
    expect(s).not.toContain(marker);
    expect(JSON.stringify(r)).not.toContain(marker);
  });

  it("survives a randomised barrage and only ever emits template-conforming SVG", () => {
    let seed = 99;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const atoms = ['"', "'", "<", ">", "&", "/", "script", "onload=", "javascript:", "#", "red", "blue", "(", ")", ",", " ", "50%", "90deg", "\n", "\u0000", "oklch(", "url(", "var(--x)", "linear-gradient(", "\\", "${", "-->", "]]>"];
    let ok = 0;
    for (let i = 0; i < 400; i++) {
      let css = "";
      for (let k = 0, n = 3 + Math.floor(rnd() * 14); k < n; k++) css += atoms[Math.floor(rnd() * atoms.length)];
      const r = callTool("render_preview", { css: i % 3 === 0 ? css : `linear-gradient(red, blue ${css})`, width: 20 + (i % 50) });
      if (r.isError) continue;
      ok++;
      expect(svgOf(r)).toMatch(SAFE_SVG);
    }
    expect(ok).toBeGreaterThanOrEqual(0);
  });
});

describe("svg primitives", () => {
  it("num formats plain decimals and refuses anything else", () => {
    expect(num(0)).toBe("0");
    expect(num(-0)).toBe("0");
    expect(num(12.34567)).toBe("12.3457");
    expect(num(100)).toBe("100");
    expect(num(0.5)).toBe("0.5");
    expect(() => num(NaN)).toThrow();
    expect(() => num(Infinity)).toThrow();
    expect(() => num(1e21)).toThrow();
    expect(() => num("1" as unknown as number)).toThrow();
  });

  it("hex accepts only #rrggbb in lower case", () => {
    expect(hex("#0a1b2c")).toBe("#0a1b2c");
    for (const bad of ["#0A1B2C", "#abc", "red", "#0a1b2c ", "#0a1b2c\"", "#0a1b2g", "", "url(#x)"]) expect(() => hex(bad)).toThrow();
  });

  it("renderSvg refuses values outside the allow-list", () => {
    const ok = { width: 100, height: 100, angle: 90, stops: [{ color: "#000000", offset: 0 }, { color: "#ffffff", offset: 1 }] };
    expect(renderSvg(ok)).toMatch(SAFE_SVG);
    expect(() => renderSvg({ ...ok, stops: [{ color: '#000000"/><script>', offset: 0 }] })).toThrow();
    expect(() => renderSvg({ ...ok, stops: [{ color: "#000000", offset: NaN }] })).toThrow();
    expect(() => renderSvg({ ...ok, stops: [{ color: "#000000", offset: 2 }] })).toThrow();
    expect(() => renderSvg({ ...ok, width: "100\"><script>" as unknown as number })).toThrow();
    expect(() => renderSvg({ ...ok, height: 1.5 })).toThrow();
    expect(() => renderSvg({ ...ok, width: 5000 })).toThrow();
    expect(() => renderSvg({ ...ok, angle: NaN })).toThrow();
    expect(() => renderSvg({ ...ok, stops: [] })).toThrow();
  });

  it("base64Ascii encodes ASCII and refuses anything else", () => {
    expect(base64Ascii("<svg/>")).toBe(btoa("<svg/>"));
    expect(() => base64Ascii("café")).toThrow();
  });
});
