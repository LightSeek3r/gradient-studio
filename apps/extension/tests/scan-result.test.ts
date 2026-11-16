// The page is untrusted, so what it returns is validated field by field.
import { describe, expect, it } from "vitest";
import { BOUNDS, normalizeEvalResult, parseElements, parseHit, parseInfo, parseScanResult, parseSheet } from "../src/lib/scan-result";

const hit = { source: "computed", property: "background-image", value: "linear-gradient(red, blue)", selector: "div.a", path: "html > body:nth-child(2)", origin: "" };
const sheet = { op: "sheet", index: 0, label: "<style>", status: "ok", hits: [hit], customProps: ["--g"], rules: 3, next: null, capped: false };
const elements = { op: "elements", start: 0, next: 10, total: 10, hits: [hit], hitCapReached: false };
const info = { op: "info", elements: 5, sheets: 1, readyState: "complete" };

describe("parseHit", () => {
  it("accepts a valid hit and keeps only known fields", () => {
    expect(parseHit({ ...hit, extra: "x", __proto__: { evil: 1 } })).toEqual(hit);
  });

  it("keeps the truncated flag only when true", () => {
    expect(parseHit({ ...hit, truncated: true })?.truncated).toBe(true);
    expect(parseHit({ ...hit, truncated: false })).not.toHaveProperty("truncated");
    expect(parseHit({ ...hit, truncated: "yes" })).toBeNull();
  });

  it.each([
    ["not an object", 5],
    ["null", null],
    ["an array", []],
    ["unknown source", { ...hit, source: "network" }],
    ["missing property", { ...hit, property: undefined }],
    ["empty property", { ...hit, property: "" }],
    ["number value", { ...hit, value: 5 }],
    ["value without a gradient", { ...hit, value: "red" }],
    ["selector over the bound", { ...hit, selector: "x".repeat(BOUNDS.selector + 1) }],
    ["path over the bound", { ...hit, path: "x".repeat(BOUNDS.path + 1) }],
    ["value over the bound", { ...hit, value: "gradient(" + "x".repeat(BOUNDS.value) }],
    ["origin not a string", { ...hit, origin: null }],
  ])("rejects %s", (_name, value) => {
    expect(parseHit(value)).toBeNull();
  });
});

describe("parseSheet / parseElements / parseInfo", () => {
  it("accept well-formed results", () => {
    expect(parseSheet(sheet)).toEqual(sheet);
    expect(parseElements(elements)).toEqual(elements);
    expect(parseInfo(info)).toEqual(info);
  });

  it("reject one bad hit in a list as a whole (no partial trust)", () => {
    expect(parseSheet({ ...sheet, hits: [hit, { ...hit, source: "x" }] })).toBeNull();
    expect(parseElements({ ...elements, hits: [{}] })).toBeNull();
  });

  it("reject more hits than one chunk may hold", () => {
    expect(parseElements({ ...elements, hits: Array.from({ length: BOUNDS.hitsPerChunk + 1 }, () => hit) })).toBeNull();
  });

  it("require an elements chunk to make progress (next > start), so the runner cannot loop forever", () => {
    expect(parseElements({ ...elements, start: 5, next: 5 })).toBeNull();
    expect(parseElements({ ...elements, start: 5, next: 4 })).toBeNull();
  });

  it("reject non-integer, negative and huge counts", () => {
    expect(parseElements({ ...elements, total: -1 })).toBeNull();
    expect(parseElements({ ...elements, total: 1.5 })).toBeNull();
    expect(parseElements({ ...elements, total: Number.MAX_SAFE_INTEGER })).toBeNull();
    expect(parseInfo({ ...info, elements: NaN })).toBeNull();
  });

  it("validate custom property names", () => {
    expect(parseSheet({ ...sheet, customProps: ["--ok-name"] })).not.toBeNull();
    expect(parseSheet({ ...sheet, customProps: ["color"] })).toBeNull();
    expect(parseSheet({ ...sheet, customProps: ["--has space"] })).toBeNull();
    expect(parseSheet({ ...sheet, customProps: Array.from({ length: BOUNDS.customProps + 1 }, (_, i) => `--p${i}`) })).toBeNull();
  });

  it("validate the sheet status, next and capped fields", () => {
    expect(parseSheet({ ...sheet, status: "weird" })).toBeNull();
    expect(parseSheet({ ...sheet, next: "3" })).toBeNull();
    expect(parseSheet({ ...sheet, next: 7 })?.next).toBe(7);
    expect(parseSheet({ ...sheet, capped: 1 })).toBeNull();
  });

  it("validate readyState", () => {
    expect(parseInfo({ ...info, readyState: "ready" })).toBeNull();
    expect(parseInfo({ ...info, readyState: "loading" })?.readyState).toBe("loading");
  });
});

describe("parseScanResult", () => {
  it("dispatches on op", () => {
    expect(parseScanResult(info)?.op).toBe("info");
    expect(parseScanResult(sheet)?.op).toBe("sheet");
    expect(parseScanResult(elements)?.op).toBe("elements");
    expect(parseScanResult({ op: "error", message: "boom" })).toEqual({ op: "error", message: "boom" });
  });

  it("accepts the same data as JSON text", () => {
    expect(parseScanResult(JSON.stringify(elements))).toEqual(elements);
  });

  it.each([undefined, null, 42, "not json", "{", [], {}, { op: "other" }, { op: "error", message: 5 }, { op: "error", message: "x".repeat(1001) }])(
    "returns null for %j",
    (value) => {
      expect(parseScanResult(value)).toBeNull();
    },
  );

  it("is not fooled by a prototype-polluted lookalike", () => {
    const evil = JSON.parse('{"op":"elements","start":0,"next":1,"total":1,"hits":[],"hitCapReached":false,"__proto__":{"op":"info"}}');
    expect(parseScanResult(evil)?.op).toBe("elements");
  });

  it("never throws, whatever it is given", () => {
    const hostile = [
      new Proxy({}, { get: () => { throw new Error("trap"); } }),
      Object.create(null),
      { get op(): string { throw new Error("getter"); } },
      Symbol("x"),
      () => 1,
    ];
    for (const h of hostile) expect(parseScanResult(h)).toBeNull();
  });

  it("normalizeEvalResult refuses oversized JSON text", () => {
    expect(normalizeEvalResult("x".repeat(50_000_001))).toBeNull();
  });
});
