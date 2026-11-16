import { describe, expect, it } from "vitest";
import postcss from "postcss";
import postcssScss from "postcss-scss";
import { locate, parseValue, valueSlot, type ValueNode } from "../src/analyze";
import { planFix } from "../src/fix";
import { propertyMatches, readOptions } from "../src/options";
import { ROUGH, SMOOTH } from "./helpers";

function firstDecl(css: string, syntax?: unknown): ValueNode {
  let found: ValueNode | undefined;
  ((syntax ?? postcss) as typeof postcss).parse(css).walkDecls((d) => {
    found ??= d as unknown as ValueNode;
  });
  if (!found) throw new Error("no declaration");
  return found;
}

describe("valueSlot / locate", () => {
  it("skips values without a gradient function", () => {
    expect(valueSlot(firstDecl("a { color: red }"))).toBeNull();
  });

  it("finds the value offset from the node start", () => {
    const slot = valueSlot(firstDecl(`a {  background :  ${ROUGH} }`));
    expect(slot?.text).toBe(ROUGH);
    expect(slot?.base).toBe("background :  ".length);
    expect(locate(slot!, { start: 0, end: 3 })).toEqual({ index: 14, endIndex: 17 });
  });

  it("uses the original text of a value with comments", () => {
    const node = firstDecl(`a { background: /* c */ ${ROUGH} /* d */; }`);
    const slot = valueSlot(node);
    expect(slot?.kind).toBe("raw");
    expect(slot?.text).toBe(`${ROUGH} /* d */`);
  });

  it("uses the // original of an SCSS value", () => {
    const slot = valueSlot(firstDecl(`a { b: linear-gradient(red, // x\n blue); }`, postcssScss));
    expect(slot?.kind).toBe("scss");
    expect(slot?.text).toContain("// x");
  });

  it("falls back to the whole node (base null) when the source offsets are missing", () => {
    const node = firstDecl(`a { background: ${ROUGH}; }`);
    delete (node.source!.start as { offset?: number }).offset;
    const slot = valueSlot(node);
    expect(slot?.text).toBe(ROUGH);
    expect(slot?.base).toBeNull();
    expect(locate(slot!, { start: 0, end: 5 })).toBeNull();
  });

  it("parseValue ignores gradients in strings but keeps the ones around them", () => {
    const node = firstDecl(`a { background: "linear-gradient(red, blue)", ${ROUGH}; }`);
    const parsed = parseValue(node);
    expect(parsed?.gradients).toHaveLength(1);
    expect(parsed?.slot.text.slice(parsed.gradients[0].range.start, parsed.gradients[0].range.end)).toBe(ROUGH);
  });
});

describe("planFix", () => {
  it("returns null for text with two gradients", () => {
    expect(planFix(`${ROUGH}, ${ROUGH}`, { kind: "min", min: 70 })).toBeNull();
  });

  it("returns null when nothing is below the minimum", () => {
    expect(planFix(SMOOTH, { kind: "min", min: 100 })).toBeNull();
  });

  it("returns the before/after text and scores", () => {
    const plan = planFix(`x ${ROUGH} y`, { kind: "min", min: 70 });
    expect(plan).toMatchObject({
      before: `x ${ROUGH} y`,
      text: "x linear-gradient(90deg, #00a600, #00ff00 50%, #006900) y",
      scoreBefore: 58,
    });
    expect(plan!.scoreAfter).toBeGreaterThanOrEqual(70);
  });

  it("lists the resolved codes for a codes goal", () => {
    const plan = planFix(ROUGH, { kind: "codes", codes: new Set(["hue/wide-arc"]) });
    expect(plan?.resolvedCodes).toEqual(["hue/wide-arc"]);
  });

  it("never throws on junk", () => {
    for (const t of ["", "linear-gradient(", "linear-gradient()", "\u0000", "linear-gradient(red)"]) {
      expect(planFix(t, { kind: "min", min: 100 })).toBeNull();
    }
  });
});

describe("options", () => {
  it("defaults", () => {
    expect(readOptions(undefined)).toEqual({ ignoreUnscorable: true, skipHardStops: true, skipAlpha: true, properties: null });
  });

  it("only an explicit false turns a default off", () => {
    expect(readOptions({ skipAlpha: false, skipHardStops: 0 })).toMatchObject({ skipAlpha: false, skipHardStops: true });
  });

  it("propertyMatches handles strings, /regex/ strings and RegExps; an invalid regex matches nothing", () => {
    expect(propertyMatches("Background", ["background"])).toBe(true);
    expect(propertyMatches("--A", ["--a"])).toBe(false);
    expect(propertyMatches("mask-image", ["/image$/"])).toBe(true);
    expect(propertyMatches("mask-image", ["/(/"])).toBe(false);
    expect(propertyMatches("mask-image", [/^mask/])).toBe(true);
    expect(propertyMatches("x", null)).toBe(true);
  });
});
