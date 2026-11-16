import { describe, expect, it } from "vitest";
import { parseGradient, type GradientDocument } from "@opal42/gradient";
import { DEFAULT_STUDIO_URL, MAX_STUDIO_STOPS, normalizeStudioBase, studioHash, studioUrl } from "../src/studio";
// The web app's own decoder: the link must be one it accepts.
import { decodeDocument } from "../../web/src/persist/url-codec";
import { ROUGH } from "./helpers";

const docOf = (css: string): GradientDocument => parseGradient(css).gradients[0].document!;
const hashOf = (doc: GradientDocument): string => {
  const h = studioHash(doc);
  if (!h.ok) throw new Error(h.reason);
  return h.hash;
};

describe("studio hash", () => {
  it("encodes stops, angle and defaults in the documented format", () => {
    expect(hashOf(docOf(ROUGH))).toBe("#v1;s=ff0000@0,00ff00@50,0000ff@100;d=90:100:1;b=normal");
  });

  it("is accepted by the web app's decoder", () => {
    const decoded = decodeDocument(hashOf(docOf(ROUGH)));
    expect(decoded).not.toBeNull();
    expect(decoded!.ticks.map((t) => [t.color, t.position])).toEqual([
      ["#ff0000", 0],
      ["#00ff00", 50],
      ["#0000ff", 100],
    ]);
    expect(decoded!.directions[0]).toMatchObject({ angle: 90, weight: 100, enabled: true });
  });

  it("resolves automatic positions the way CSS does", () => {
    expect(hashOf(docOf("linear-gradient(#ff0000, #00ff00, #0000ff, #ffffff)"))).toContain("s=ff0000@0,00ff00@33.33,0000ff@66.67,ffffff@100");
  });

  it("defaults the angle to 180", () => {
    expect(hashOf(docOf("linear-gradient(#ff0000, #0000ff)"))).toContain("d=180:100:1");
  });

  it("normalises angles into 0-359", () => {
    const base = docOf("linear-gradient(#ff0000, #0000ff)");
    for (const [angle, expected] of [[450, 90], [-90, 270], [360, 0], [89.6, 90], [359.6, 0]] as const) {
      expect(hashOf({ ...base, angle })).toContain(`d=${expected}:100:1`);
    }
  });

  it("uses 180 for a non-finite angle", () => {
    const base = docOf("linear-gradient(#ff0000, #0000ff)");
    expect(hashOf({ ...base, angle: Number.NaN })).toContain("d=180:100:1");
  });

  it("clamps positions outside 0-100%", () => {
    expect(hashOf(docOf("linear-gradient(#ff0000 -10%, #0000ff 120%)"))).toContain("s=ff0000@0,0000ff@100");
  });

  it("rounds positions to two decimals like the app", () => {
    expect(hashOf(docOf("linear-gradient(#ff0000 12.3456%, #0000ff 99.999%)"))).toContain("ff0000@12.35,0000ff@100");
  });

  it("round-trips every fragment through the app decoder", () => {
    for (const css of [
      "linear-gradient(to right, #101b45, #3f1d63 40%, #9333ea)",
      "linear-gradient(45deg, #ff0000 5%, #00ff00 33.33%, #0000ff 90%)",
      "linear-gradient(#ffffff, #000000)",
    ]) {
      expect(decodeDocument(hashOf(docOf(css)))).not.toBeNull();
    }
  });

  it("refuses more stops than the link format holds", () => {
    const stops = Array.from({ length: MAX_STUDIO_STOPS + 1 }, (_, i) => `#${(i * 20).toString(16).padStart(2, "0")}0000`).join(", ");
    const h = studioHash(docOf(`linear-gradient(${stops})`));
    expect(h.ok).toBe(false);
  });

  it("accepts exactly the maximum number of stops", () => {
    const stops = Array.from({ length: MAX_STUDIO_STOPS }, (_, i) => `#${(i * 20).toString(16).padStart(2, "0")}0000`).join(", ");
    expect(studioHash(docOf(`linear-gradient(${stops})`)).ok).toBe(true);
  });

  it("refuses repeating, single-stop and invalid documents", () => {
    expect(studioHash({ ...docOf("linear-gradient(#ff0000, #0000ff)"), repeating: true }).ok).toBe(false);
    expect(studioHash(docOf("linear-gradient(#ff0000)")).ok).toBe(false);
    expect(studioHash(null).ok).toBe(false);
    expect(studioHash({ kind: "linear", angle: 0, stops: [{ color: "red" }, { color: "#fff" }] }).ok).toBe(false);
  });
});

describe("studio base url", () => {
  it("defaults to the public app", () => {
    expect(DEFAULT_STUDIO_URL).toBe("https://gradient-studio-al4.pages.dev/");
    expect(normalizeStudioBase(undefined)).toBe(DEFAULT_STUDIO_URL);
    expect(normalizeStudioBase("")).toBe(DEFAULT_STUDIO_URL);
  });

  it("accepts http and https only", () => {
    expect(normalizeStudioBase("https://example.org/app/")).toBe("https://example.org/app/");
    expect(normalizeStudioBase("http://localhost:5173/")).toBe("http://localhost:5173/");
    for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "ftp://x/", "vscode://x", "not a url"]) {
      expect(normalizeStudioBase(bad)).toBe(DEFAULT_STUDIO_URL);
    }
  });

  it("drops an existing fragment", () => {
    expect(normalizeStudioBase("https://example.org/#old")).toBe("https://example.org/");
  });

  it("builds the full link with the fragment", () => {
    const r = studioUrl(undefined, docOf(ROUGH));
    expect(r).toEqual({ ok: true, url: "https://gradient-studio-al4.pages.dev/#v1;s=ff0000@0,00ff00@50,0000ff@100;d=90:100:1;b=normal" });
  });

  it("keeps a custom path and query", () => {
    const r = studioUrl("https://example.org/studio/?x=1", docOf(ROUGH));
    expect(r.ok && r.url.startsWith("https://example.org/studio/?x=1#v1;")).toBe(true);
  });

  it("explains why there is no link", () => {
    const r = studioUrl(undefined, null);
    expect(r.ok).toBe(false);
  });
});
