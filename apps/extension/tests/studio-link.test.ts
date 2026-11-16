import { describe, expect, it } from "vitest";
import { parseGradient, type GradientDocument } from "@opal42/gradient";
// The real decoder of the web app: our hashes must be accepted by it.
import { decodeDocument } from "../../web/src/persist/url-codec";
import { DEFAULT_STUDIO_URL, normalizeStudioUrl, studioHash, studioLink } from "../src/lib/studio-link";

const doc = (css: string): GradientDocument => {
  const parsed = parseGradient(css).gradients[0];
  if (!parsed?.document) throw new Error("no document for " + css);
  return parsed.document;
};

describe("studioHash", () => {
  it("encodes stops, angle and defaults in the v1 format", () => {
    expect(studioHash(doc("linear-gradient(90deg, #101b45, #9333ea 50%, #ffffff)"))).toEqual({
      ok: true,
      hash: "v1;s=101b45@0,9333ea@50,ffffff@100;d=90:100:1;b=normal",
    });
  });

  it("resolves automatic positions as CSS does", () => {
    const r = studioHash(doc("linear-gradient(red, lime, blue, white)"));
    expect(r.ok && r.hash).toContain("ff0000@0,00ff00@33.33,0000ff@66.67,ffffff@100");
  });

  it("rounds positions to two decimals, as the format allows", () => {
    const r = studioHash(doc("linear-gradient(red 0%, blue 33.3333%, lime 100%)"));
    expect(r.ok && r.hash).toContain("0000ff@33.33");
  });

  it("uses the default CSS angle (180) when none is given", () => {
    const r = studioHash(doc("linear-gradient(red, blue)"));
    expect(r.ok && r.hash).toContain("d=180:100:1");
  });

  it("normalises angles into 0–359", () => {
    expect((studioHash(doc("linear-gradient(450deg, red, blue)")) as { hash: string }).hash).toContain("d=90:");
    expect((studioHash(doc("linear-gradient(-90deg, red, blue)")) as { hash: string }).hash).toContain("d=270:");
    expect((studioHash(doc("linear-gradient(360deg, red, blue)")) as { hash: string }).hash).toContain("d=0:");
    expect((studioHash(doc("linear-gradient(to right, red, blue)")) as { hash: string }).hash).toContain("d=90:");
  });

  it("produces hashes the web app's own decoder accepts, with the same stops", () => {
    const cases = [
      "linear-gradient(90deg, #101b45, #9333ea 50%, #ffffff)",
      "linear-gradient(red, lime, blue, white)",
      "linear-gradient(45deg, #000 0%, #888 33.33%, #fff 100%)",
      "linear-gradient(red 10%, blue 90%)",
    ];
    for (const css of cases) {
      const r = studioHash(doc(css));
      expect(r.ok, css).toBe(true);
      if (!r.ok) continue;
      const decoded = decodeDocument(`#${r.hash}`);
      expect(decoded, css).not.toBeNull();
      expect(decoded!.ticks.length).toBe(doc(css).stops.length);
      expect(decoded!.directions[0].weight).toBe(100);
      expect(decoded!.blend).toBe("normal");
    }
  });

  it("accepts the maximum of 10 stops and refuses 11", () => {
    const stops = (n: number) => Array.from({ length: n }, (_, i) => `#${(i + 1).toString(16).padStart(2, "0")}0000`).join(", ");
    expect(studioHash(doc(`linear-gradient(${stops(10)})`)).ok).toBe(true);
    const eleven = studioHash(doc(`linear-gradient(${stops(11)})`));
    expect(eleven.ok).toBe(false);
    expect(!eleven.ok && eleven.reason).toMatch(/at most 10/);
  });

  it("refuses translucent stops, out-of-range positions, repeating and too few stops, with a reason", () => {
    const refuse = (css: string) => {
      const r = studioHash(doc(css));
      expect(r.ok, css).toBe(false);
      return r.ok ? "" : r.reason;
    };
    expect(refuse("linear-gradient(rgba(255,0,0,0.5), blue)")).toMatch(/opaque/);
    expect(refuse("linear-gradient(red -10%, blue)")).toMatch(/0–100/);
    expect(refuse("linear-gradient(red, blue 120%)")).toMatch(/0–100/);
    expect(refuse("repeating-linear-gradient(red 0%, blue 10%)")).toMatch(/linear/);
    expect(refuse("linear-gradient(red)")).toMatch(/at least 2/);
  });

  it("never throws on a malformed document", () => {
    expect(() => studioHash({ kind: "linear", angle: 0, stops: [{ color: "nope" }, { color: "#fff" }] })).not.toThrow();
    expect(studioHash({ kind: "linear", angle: 0, stops: [{ color: "nope" }, { color: "#ffffff" }] }).ok).toBe(false);
  });
});

describe("normalizeStudioUrl", () => {
  it.each([
    ["https://gradient-studio-al4.pages.dev/", "https://gradient-studio-al4.pages.dev/"],
    ["  https://example.com/studio  ", "https://example.com/studio"],
    ["https://example.com/app/?x=1#frag", "https://example.com/app/"],
    ["http://localhost:5173/", "http://localhost:5173/"],
    ["http://127.0.0.1:4173", "http://127.0.0.1:4173/"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeStudioUrl(input)).toBe(expected);
  });

  it.each([
    "http://example.com/",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "chrome://settings",
    "https://user:pass@example.com/",
    "ftp://example.com",
    "example.com",
    "",
    "https://" + "a".repeat(600) + ".com",
  ])("refuses %s", (input) => {
    expect(normalizeStudioUrl(input)).toBeNull();
  });

  it("refuses non-strings", () => {
    expect(normalizeStudioUrl(undefined)).toBeNull();
    expect(normalizeStudioUrl(42)).toBeNull();
  });
});

describe("studioLink", () => {
  it("appends the hash to the studio address", () => {
    expect(studioLink("https://example.com/s/", "v1;s=ff0000@0,0000ff@100")).toBe("https://example.com/s/#v1;s=ff0000@0,0000ff@100");
  });

  it("falls back to the default address when the configured one is invalid", () => {
    expect(studioLink("javascript:alert(1)", "v1;s=x")).toBe(`${DEFAULT_STUDIO_URL}#v1;s=x`);
  });
});
