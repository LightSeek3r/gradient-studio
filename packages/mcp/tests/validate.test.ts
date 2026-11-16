import { describe, expect, it } from "vitest";
import { excerpt, validate, type JsonSchema } from "../src/validate";
import { COMPLEMENT_INPUT, PREVIEW_INPUT, SCORE_INPUT } from "../src/schemas";

describe("validate", () => {
  const s = (schema: JsonSchema, v: unknown) => validate(schema, v, "x");

  it("checks strings: type, length and enum", () => {
    expect(s({ type: "string" }, "a")).toBeNull();
    expect(s({ type: "string" }, 1)).toMatch(/expected a string/);
    expect(s({ type: "string", minLength: 2 }, "a")).toMatch(/at least 2/);
    expect(s({ type: "string", maxLength: 2 }, "abc")).toMatch(/too long \(3 characters, the limit is 2\)/);
    expect(s({ type: "string", enum: ["a", "b"] }, "c")).toMatch(/must be one of "a", "b"/);
  });

  it("checks numbers: finite, integer, bounds", () => {
    expect(s({ type: "number" }, 1.5)).toBeNull();
    expect(s({ type: "number" }, NaN)).toMatch(/finite/);
    expect(s({ type: "number" }, Infinity)).toMatch(/finite/);
    expect(s({ type: "number" }, "1")).toMatch(/finite/);
    expect(s({ type: "integer" }, 1.5)).toMatch(/integer/);
    expect(s({ type: "number", minimum: 0 }, -1)).toMatch(/at least 0/);
    expect(s({ type: "number", maximum: 5 }, 6)).toMatch(/at most 5/);
  });

  it("checks arrays and their items with indexed paths", () => {
    const schema: JsonSchema = { type: "array", minItems: 1, maxItems: 2, items: { type: "string" } };
    expect(s(schema, ["a"])).toBeNull();
    expect(s(schema, [])).toMatch(/at least 1/);
    expect(s(schema, ["a", "b", "c"])).toMatch(/too many items/);
    expect(s(schema, ["a", 2])).toBe("x[1]: expected a string");
    expect(s(schema, "a")).toMatch(/expected an array/);
  });

  it("checks objects: required, unknown properties, nested paths", () => {
    const schema: JsonSchema = {
      type: "object",
      additionalProperties: false,
      required: ["a"],
      properties: { a: { type: "string" }, b: { type: "object", properties: { c: { type: "number" } } } },
    };
    expect(s(schema, { a: "1" })).toBeNull();
    expect(s(schema, {})).toMatch(/missing required property "a"/);
    expect(s(schema, { a: "1", z: 1 })).toMatch(/unknown property "z"/);
    expect(s(schema, { a: "1", b: { c: "no" } })).toBe("x.b.c: expected a finite number");
    expect(s(schema, [])).toMatch(/expected an object/);
    expect(s(schema, null)).toMatch(/expected an object/);
  });

  it("treats undefined properties as absent and ignores prototype keys", () => {
    const schema: JsonSchema = { type: "object", additionalProperties: false, properties: { a: { type: "string" } } };
    expect(s(schema, { a: undefined })).toBeNull();
    expect(s(schema, JSON.parse('{"__proto__": 1}'))).toMatch(/unknown property/);
    expect(s({ type: "object", required: ["toString"] }, {})).toMatch(/missing required/);
  });

  it("excerpt flattens control characters and cuts long values", () => {
    expect(excerpt("a\nb")).toBe('"a b"');
    expect(excerpt("x".repeat(100), 10)).toBe(`"${"x".repeat(10)}..."`);
  });

  it("applies the real tool schemas", () => {
    expect(validate(SCORE_INPUT, { css: "linear-gradient(red, blue)" })).toBeNull();
    expect(validate(SCORE_INPUT, { stops: [{ color: "red" }, { color: "blue", position: 100 }], angle: 90 })).toBeNull();
    expect(validate(SCORE_INPUT, { stops: [{ color: "red" }] })).toMatch(/at least 2/);
    expect(validate(SCORE_INPUT, { stops: [{ color: "red" }, { color: "blue", position: 101 }] })).toMatch(/stops\[1\]\.position: must be at most 100/);
    expect(validate(SCORE_INPUT, { stops: [{ color: "red" }, { color: "blue", extra: 1 }] })).toMatch(/unknown property/);
    expect(validate(SCORE_INPUT, { interpolation: "hsl", css: "x" })).toMatch(/interpolation: must be one of/);
    expect(validate(COMPLEMENT_INPUT, {})).toMatch(/missing required property "color"/);
    expect(validate(PREVIEW_INPUT, { css: "x", width: 15 })).toMatch(/width: must be at least 16/);
    expect(validate(PREVIEW_INPUT, { css: "x", width: 2049 })).toMatch(/width: must be at most 2048/);
    expect(validate(PREVIEW_INPUT, { css: "x", height: 20.5 })).toMatch(/height: expected an integer/);
  });
});
