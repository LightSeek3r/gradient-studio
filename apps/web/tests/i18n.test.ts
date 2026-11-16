import { describe, expect, it } from "vitest";
import { exportAll } from "@opal42/gradient/export";
import { V1_MODEL, proposeFixes, scoreGradient, type GradientTick } from "@opal42/gradient";
import { en } from "../src/i18n/en";
import { fr } from "../src/i18n/fr";
import { formatMessage, messageError, placeholdersOf } from "../src/i18n/icu";
import { detectLocale } from "../src/i18n/locale-browser";
import {
  isLocale,
  matchLanguages,
  parseHashLang,
  resolveLocale,
  LOCALES,
} from "../src/i18n/locale";
import { CATALOGUES, createI18n, hasMessageKey, i18nEn, tEn, type MessageKey } from "../src/i18n/translator";
import { renderRich } from "../src/i18n/rich";
import { baseDocument, localiseCoreNote, localiseUnsupported } from "../src/export/export-model";
import { fixLabel } from "../src/explain/fix-label";
import { RULE_CODES, findingMessage, ruleText } from "../src/explain/explain";
import { parseLinearGradient, syntaxReason } from "../src/import/adapter";
import { decodeDocument, decodeLang, encodeDocument } from "../src/persist/url-codec";
import { issueHash, issueLink, parseIssueHash } from "../src/persist/issue-link";
import { defaultDocument } from "../src/state/document";

const i18nFr = createI18n("fr");
const tFr = i18nFr.t;
const keys = Object.keys(en) as MessageKey[];

describe("ICU-lite formatting", () => {
  const ctx = (locale: string) => ({ locale, plurals: new Intl.PluralRules(locale), numbers: new Intl.NumberFormat(locale) });
  const f = (msg: string, params: Record<string, string | number> | undefined, locale = "en") => formatMessage(msg, params, ctx(locale));

  it("substitutes values and keeps unknown placeholders visible", () => {
    expect(f("a {x} b {y}", { x: 1 })).toBe("a 1 b {y}");
  });
  it("selects plural branches per locale (French: 0 and 1 are singular)", () => {
    const m = "{n, plural, =0 {none} one {# item} other {# items}}";
    expect([0, 1, 2].map((n) => f(m, { n }))).toEqual(["none", "1 item", "2 items"]);
    const fr1 = "{n, plural, one {# palier} other {# paliers}}";
    expect([0, 1, 1.5, 2].map((n) => f(fr1, { n }, "fr"))).toEqual(["0 palier", "1 palier", "1,5 palier", "2 paliers"]);
  });
  it("formats # for the locale", () => {
    expect(f("{n, plural, other {# x}}", { n: 1234.5 }, "fr")).toMatch(/^1\s234,5 x$/u);
  });
  it("supports select and nesting", () => {
    const m = "{k, select, a {A{n, plural, one { one} other { many}}} other {other}}";
    expect(f(m, { k: "a", n: 1 })).toBe("A one");
    expect(f(m, { k: "z", n: 1 })).toBe("other");
  });
  it("supports escapes and apostrophes as plain text", () => {
    expect(f("l'arrêt \\{x\\}", {})).toBe("l'arrêt {x}");
  });
  it("never throws on a malformed message", () => {
    expect(f("oops {", {})).toBe("oops {");
    expect(messageError("{n, plural, one {x}}")).toMatch(/other/);
    expect(messageError("{n, foo, other {x}}")).toMatch(/unknown/);
    expect(messageError("fine {x}")).toBeNull();
  });
  it("lists placeholders including plural and select variables", () => {
    expect(placeholdersOf("{a} {n, plural, one {# {b}} other {#}} {k, select, x {y} other {z}}")).toEqual(["a", "b", "k", "n"]);
  });
});

describe("catalogue completeness", () => {
  it("has exactly the same keys in every locale", () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
    expect(LOCALES.every((l) => Object.keys(CATALOGUES[l]).length === keys.length)).toBe(true);
  });

  it("has no empty or whitespace-only value, and every message parses", () => {
    for (const locale of LOCALES) {
      for (const key of keys) {
        const text = CATALOGUES[locale][key];
        expect(text.trim().length, `${locale}:${key} is empty`).toBeGreaterThan(0);
        expect(messageError(text), `${locale}:${key} does not parse`).toBeNull();
      }
    }
  });

  it("uses the same placeholders in every locale", () => {
    for (const key of keys) {
      expect(placeholdersOf(fr[key]), key).toEqual(placeholdersOf(en[key]));
    }
  });

  it("keeps markup tags in step between locales", () => {
    const tags = (s: string) => [...s.matchAll(/<\/?(\w+)>/g)].map((m) => m[0]).sort();
    for (const key of keys) expect(tags(fr[key]), key).toEqual(tags(en[key]));
  });

  /** Strings that legitimately read the same in French: brand, notation names, formats, language names. */
  const SAME_AS_ENGLISH = new Set<MessageKey>([
    "app.name",
    "notation.hex",
    "notation.rgb",
    "notation.hsl",
    "field.hex",
    "field.rgb",
    "field.hsl",
    "toast.fixApplied",
    "header.toolbar", // "Document"
    "toast.region", // "Notification"
    "tabs.directions",
    "tabs.export",
    "tabs.score",
    "export.title",
    "directions.title",
    "directions.add",
    "suggest.original",
    "suggest.score",
    "ledger.fixLine",
    "lane.markTitle",
    "directions.summaryMany",
    "export.tab.css",
    "export.tab.css-oklab",
    "export.tab.tailwind",
    "export.tab.scss",
    "export.tab.svg",
    "export.tab.swiftui",
    "export.tab.compose",
    "export.tab.flutter",
    "export.tab.godot",
    "export.tab.figma",
    "import.err.unknownColor",
    "stage.scoreWord",
    // Cognates: the French word is the English word.
    "channel.saturation",
    "ledger.plusSr",
    "curves.chroma",
    "directions.active",
  ]);

  it("translates every message: identical text is only allowed on the technical allow-list", () => {
    const offenders = keys.filter((k) => fr[k] === en[k] && !SAME_AS_ENGLISH.has(k) && /\p{L}/u.test(en[k].replace(/\{[^}]*\}/g, "")));
    expect(offenders).toEqual([]);
  });

  it("French values carry no obvious English leftovers", () => {
    // Whole English function words that never occur in French prose.
    const english = /\b(the|and|with|from|your|this|that|please|click|stops?|score of|are|is not|cannot|can't|you)\b/i;
    const allowed = new Set<MessageKey>([
      "meta.ogImageAlt", // contains the product name only
      "import.err.relativeColor", // quotes the CSS syntax rgb(from …)
      "export.note.tailwindNoNative", // quotes the Tailwind utilities from/via/to
    ]);
    const offenders: string[] = [];
    for (const key of keys) {
      if (allowed.has(key)) continue;
      // Code samples, CSS keywords and formulas are quoted from the platform.
      const prose = fr[key].replace(/<code>.*?<\/code>/g, "").replace(/<accent>.*?<\/accent>/g, "").replace(/\{[^}]*\}/g, "");
      const m = english.exec(prose);
      if (m) offenders.push(`${key}: "${m[0]}"`);
    }
    expect(offenders).toEqual([]);
  });

  it("applies French spacing before high punctuation", () => {
    const bad = keys.filter((k) => /[^\s  ][:;?!]( |$)/.test(fr[k].replace(/\{[^}]*\}/g, "").replace(/https?:\/\/\S+/g, "").replace(/\b\w+:\s/g, (m) => (m.startsWith("background") ? "" : m))));
    // Allowed exceptions: code like "background:" in markup and "to {corner}".
    expect(bad.filter((k) => !["import.label"].includes(k))).toEqual([]);
  });

  it("keeps D5: no verdict words in either language", () => {
    const verdict = /\b(excellent|good|poor|bad|ugly|quality verdict)\b|\b(excellent|mauvais|médiocre|qualité)\b/i;
    for (const key of keys.filter((k) => k.startsWith("band.") || k.startsWith("rule.") || k.startsWith("score."))) {
      // "It is not a verdict on quality" is the disclaimer itself.
      if (key === "score.scope") continue;
      expect(`${en[key]} ${fr[key]}`, key).not.toMatch(verdict);
    }
  });

  it("uses the glossary terms consistently", () => {
    const text = Object.values(fr).join("\n");
    expect(text).not.toMatch(/\b(arrêt de couleur|point d’arrêt|luminosité de|taquet)\b/i);
    expect(text).not.toMatch(/\bstops?\b(?![-/])/i);
  });
});

describe("findings, rules and tiers", () => {
  /** Every (code, severity, message) tier of the model, found by walking it. */
  function tiers() {
    const out: { code: string; severity: string; message: string }[] = [];
    const walk = (node: unknown, code: string | null) => {
      if (!node || typeof node !== "object") return;
      const o = node as Record<string, unknown>;
      const codes = Object.entries(o).filter(([k, v]) => /code$/i.test(k) && typeof v === "string") as [string, string][];
      for (const [name, child] of Object.entries(o)) {
        if (!child || typeof child !== "object") continue;
        // A rule node names its code (`code`, or `wideCode` / `narrowCode` when it holds two rules).
        const own = codes.length === 1 ? codes[0][1] : (codes.find(([k]) => (name === "narrow" ? k === "narrowCode" : k === "wideCode"))?.[1] ?? code);
        const c = child as Record<string, unknown>;
        if (own && typeof c.severity === "string") {
          const message = typeof c.message === "string" ? c.message : typeof c.messageTemplate === "string" ? c.messageTemplate : null;
          if (message) out.push({ code: own, severity: c.severity, message });
        } else walk(child, own);
      }
      // The rule node itself carries severity + messageTemplate (lightness/reversal).
      if (code === null && typeof o.severity === "string" && typeof o.messageTemplate === "string" && typeof o.code === "string") {
        out.push({ code: o.code, severity: o.severity, message: o.messageTemplate });
      }
    };
    walk(V1_MODEL, null);
    // `lightness/reversal` keeps severity and template on the rule node.
    const rev = (V1_MODEL as unknown as { lightness: { reversal: { code: string; severity: string; messageTemplate: string } } }).lightness.reversal;
    if (!out.some((t) => t.code === rev.code)) out.push({ code: rev.code, severity: rev.severity, message: rev.messageTemplate });
    return out;
  }

  it("has a message in both catalogues for every tier of the model", () => {
    const list = tiers();
    expect(list.length).toBe(keys.filter((k) => k.startsWith("finding.")).length);
    for (const t of list) {
      const key = `finding.${t.code}.${t.severity}`;
      expect(hasMessageKey(key), key).toBe(true);
    }
  });

  it("keeps the English catalogue word for word equal to core's messages", () => {
    for (const t of tiers()) {
      const key = `finding.${t.code}.${t.severity}` as MessageKey;
      const rendered = t.message.includes("{count}")
        ? tEn(key, { count: 2 })
        : tEn(key);
      const expected = t.message.replace("{count}", "2").replace("{plural}", "s");
      expect(rendered, key).toBe(expected);
    }
  });

  it("localises the message of a real finding and falls back to core's for an unknown tier", () => {
    const s = scoreGradient([
      { id: 1, color: "#ff0000", position: 0 },
      { id: 2, color: "#00ff00", position: 50 },
      { id: 3, color: "#0000ff", position: 100 },
    ]);
    expect(s.findings.length).toBeGreaterThan(0);
    for (const f of s.findings) {
      expect(findingMessage(f, tEn)).toBe(f.message);
      expect(findingMessage(f, tFr)).not.toBe(f.message);
    }
    const unknown = { code: "future/new-rule", severity: "info" as const, message: "Core says so" };
    expect(findingMessage(unknown, tFr)).toBe("Core says so");
  });

  it("counts the reversals of the lightness tier", () => {
    const f = { code: "lightness/reversal", severity: "error" as const, message: "Lightness fluctuates (3 reversals) — creates visual noise" };
    expect(findingMessage(f, tEn)).toContain("3 reversals");
    expect(findingMessage(f, tFr)).toContain("3 inversions");
  });

  it("names rules in French with short lower-case names", () => {
    for (const code of RULE_CODES) {
      const n = ruleText(code, tFr).name;
      expect(n, code).toBe(n.toLowerCase());
      expect(n.length, code).toBeLessThanOrEqual(32);
    }
  });
});

describe("locale detection", () => {
  it("prefers the URL, then the stored choice, then the browser, then English", () => {
    expect(resolveLocale({ hash: "#v1;s=a;lang=fr", stored: "en", languages: ["en-US"] })).toEqual({ locale: "fr", source: "url" });
    expect(resolveLocale({ hash: "#v1;s=a", stored: "fr", languages: ["en-US"] })).toEqual({ locale: "fr", source: "stored" });
    expect(resolveLocale({ hash: "", stored: null, languages: ["de", "fr-CA"] })).toEqual({ locale: "fr", source: "browser" });
    expect(resolveLocale({ hash: "", stored: "xx", languages: ["de"] })).toEqual({ locale: "en", source: "default" });
    expect(resolveLocale({})).toEqual({ locale: "en", source: "default" });
  });
  it("maps fr* to French and everything else to English", () => {
    expect(matchLanguages(["fr"])).toBe("fr");
    expect(matchLanguages(["FR_ch"])).toBe("fr");
    expect(matchLanguages(["en-GB", "fr"])).toBe("en");
    expect(matchLanguages(["de", "es"])).toBeNull();
    expect(matchLanguages(undefined)).toBeNull();
  });
  it("reads lang= from any fragment shape and ignores unsupported values", () => {
    expect(parseHashLang("#lang=fr")).toBe("fr");
    expect(parseHashLang("#issue=hue/wide-arc;lang=en")).toBe("en");
    expect(parseHashLang("#v1;s=aaaaaa@0,bbbbbb@100;lang=FR")).toBe("fr");
    expect(parseHashLang("#v1;lang=de")).toBeNull();
    expect(parseHashLang("#v1;s=a")).toBeNull();
    expect(parseHashLang(42)).toBeNull();
    expect(isLocale("fr") && !isLocale("de")).toBe(true);
  });
  it("detectLocale is safe without a browser", () => {
    expect(detectLocale().locale).toBe("en");
  });
});

describe("URL fragment with lang", () => {
  const doc = defaultDocument();
  it("appends lang only when asked, and the document is the same with or without it", () => {
    const plain = encodeDocument(doc);
    const withLang = encodeDocument(doc, "fr");
    expect(withLang).toBe(`${plain};lang=fr`);
    expect(decodeDocument(withLang)).toEqual(decodeDocument(plain));
    expect(decodeLang(withLang)).toBe("fr");
    expect(decodeLang(plain)).toBeNull();
  });
  it("accepts lang in any position and survives an unsupported language", () => {
    expect(decodeDocument(`v1;lang=en;s=101b45@0,9333ea@100`)).not.toBeNull();
    expect(decodeDocument(`${encodeDocument(doc)};lang=de`)).not.toBeNull();
    expect(decodeLang(`${encodeDocument(doc)};lang=de`)).toBeNull();
  });
  it("still rejects duplicates and unknown keys", () => {
    expect(decodeDocument(`${encodeDocument(doc)};lang=fr;lang=en`)).toBeNull();
    expect(decodeDocument(`${encodeDocument(doc)};zz=1`)).toBeNull();
  });
  it("issue links carry lang and still parse", () => {
    expect(issueHash("hue/wide-arc", "fr")).toBe("#issue=hue/wide-arc;lang=fr");
    expect(parseIssueHash("#issue=hue/wide-arc;lang=fr")).toBe("hue/wide-arc");
    expect(parseIssueHash("#issue=hue/wide-arc;x=1")).toBeNull();
    expect(issueLink("hue/wide-arc", { origin: "https://x", pathname: "/", search: "" }, "fr")).toBe("https://x/#issue=hue/wide-arc;lang=fr");
  });
});

describe("rich messages", () => {
  it("turns known tags into nodes and leaves other angle brackets alone", () => {
    const out = renderRich("a <b>x</b> <120° c", { b: (c) => `[${c}]` }) as unknown[];
    expect(out).toHaveLength(3);
    expect(out[0]).toBe("a ");
    expect(out[2]).toBe(" <120° c");
  });
});

describe("localised helpers", () => {
  const ticks: GradientTick[] = [
    { id: 1, color: "#fde68a", position: 0 },
    { id: 2, color: "#b45309", position: 50 },
    { id: 3, color: "#fdba74", position: 100 },
  ];

  it("rebuilds every fix label in the active language", () => {
    const fixes = proposeFixes(ticks);
    expect(fixes.length).toBeGreaterThan(0);
    for (const fix of fixes) {
      expect(fixLabel(fix, ticks, i18nEn), fix.code).toBe(fix.label);
      const label = fixLabel(fix, ticks, i18nFr);
      expect(label, fix.code).not.toBe(fix.label);
      expect(label).toMatch(/palier/);
    }
  });

  it("French import errors and warnings read in French", () => {
    const err = parseLinearGradient("linear-gradient(red, blue", tFr);
    expect(err.ok).toBe(false);
    if (!err.ok) expect(err.error).toMatch(/parenthèses/);
    const warn = parseLinearGradient("linear-gradient(in oklch, red, 30%, blue)", tFr);
    expect(warn.ok).toBe(true);
    if (warn.ok) expect(warn.warnings.join()).toMatch(/interpolation/i);
    for (const input of ["radial-gradient(red, blue)", "linear-gradient(var(--a), blue)", "linear-gradient(red, , blue)", "linear-gradient(notacolour, blue)"]) {
      const r = parseLinearGradient(input, tFr);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error, input).not.toMatch(/\b(isn't|can't|the|is not)\b/);
    }
  });

  it("matches every known syntax reason and passes unknown ones through", () => {
    const reasons = [
      "the gradient direction is not an angle",
      "'to' must be followed by a side",
      "'to top top' is not a corner",
      "'in' must be followed by a colour space",
      "'cmyk' is not a colour space",
      "malformed hue interpolation method",
      "malformed gradient direction",
      "malformed number",
      "stop position 5 has no unit",
      "'em' is not a position unit",
      "a gradient cannot contain another gradient",
      "empty argument",
      "a colour hint must sit between two colour stops",
      "a colour stop is a colour and at most two positions",
      "no colour stops",
    ];
    for (const r of reasons) expect(syntaxReason(r, tFr), r).not.toBe(r);
    expect(syntaxReason("something new", tFr)).toBe("something new");
  });

  it("re-says every export note the app can show, and passes unknown ones through", () => {
    const docs = [
      baseDocument(ticks, [{ id: 1, angle: 135, weight: 100, enabled: true }]),
      baseDocument(ticks.slice(0, 2), [{ id: 1, angle: 90, weight: 100, enabled: true }]),
      baseDocument([...ticks, { id: 4, color: "#000000", position: 100 }], [{ id: 1, angle: 0, weight: 100, enabled: true }]),
    ];
    for (const doc of docs) {
      for (const [key, r] of Object.entries(exportAll(doc))) {
        // The CSS (OKLAB) tab shows the app's own notes, not core's.
        if (r.status !== "ok" || key === "css-oklab") continue;
        for (const note of r.notes.filter((n) => n !== "Untested on device.")) {
          expect(localiseCoreNote(note, tEn), `${key}: ${note}`).toBe(note);
          expect(localiseCoreNote(note, tFr), `${key}: ${note}`).not.toBe(note);
        }
      }
    }
    expect(localiseCoreNote("Something new.", tFr)).toBe("Something new.");
    expect(localiseUnsupported({ code: "repeating", reason: "x" }, tFr)).toMatch(/répété/);
    expect(localiseUnsupported({ code: "other", reason: "raw" } as never, tFr)).toBe("raw");
  });
});

describe("formatting", () => {
  it("formats decimals, percents and lists for the locale", () => {
    expect(i18nEn.number(0.1234)).toBe("0.12");
    expect(i18nFr.number(0.1234)).toBe("0,12");
    expect(i18nEn.percent(33.5)).toBe("33.5%");
    expect(i18nFr.percent(33.5).replace(/\s/gu, " ")).toBe("33,5 %");
    expect(i18nEn.list([1, 2, 3])).toBe("1, 2 and 3");
    expect(i18nFr.list([1, 2, 3])).toBe("1, 2 et 3");
  });
  it("falls back to English for a key a catalogue lacks (defence in depth)", () => {
    expect(tFr("app.name")).toBe("Gradient Studio");
  });
});
