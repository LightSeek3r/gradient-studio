import { describe, expect, it } from "vitest";
import { TOOLS, callTool, SERVER_INSTRUCTIONS } from "../src/handlers";
import { MAX_COLOR_CHARS, MAX_CSS_CHARS, MAX_PREVIEW_SIZE, MAX_STOPS, MIN_PREVIEW_SIZE } from "../src/limits";
import { PREVIEW_INPUT, SCORE_INPUT } from "../src/schemas";
import { validate, type JsonSchema } from "../src/validate";
import { RGB_CSS } from "./helpers";

const byName = (n: string) => TOOLS.find((t) => t.name === n)!;

describe("tool registry", () => {
  it("exposes exactly the four documented tools", () => {
    expect(TOOLS.map((t) => t.name)).toEqual(["score_gradient", "refine_gradient", "complement", "render_preview"]);
  });

  it("is frozen and JSON-serialisable (no functions, no cycles)", () => {
    expect(Object.isFrozen(TOOLS)).toBe(true);
    expect(JSON.parse(JSON.stringify(TOOLS))).toEqual(TOOLS);
  });

  it("marks every tool read-only, idempotent and closed-world", () => {
    for (const t of TOOLS) {
      expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
      expect(t.title.length).toBeGreaterThan(3);
      expect(t.description.length).toBeGreaterThan(40);
    }
  });

  it("describes every input property and closes every input object", () => {
    const walk = (s: JsonSchema, path: string) => {
      if (s.type === "object") {
        expect(s.additionalProperties, path).toBe(false);
        for (const [k, v] of Object.entries(s.properties ?? {})) {
          expect(v.description, `${path}.${k}`).toBeTruthy();
          walk(v, `${path}.${k}`);
        }
      }
      if (s.items) walk(s.items, `${path}[]`);
    };
    for (const t of TOOLS) walk(t.inputSchema, t.name);
  });

  it("keeps the schema limits equal to the enforced limits", () => {
    const p = SCORE_INPUT.properties;
    expect(p.css.maxLength).toBe(MAX_CSS_CHARS);
    expect(p.stops.maxItems).toBe(MAX_STOPS);
    expect(p.stops.items.properties.color.maxLength).toBe(MAX_COLOR_CHARS);
    expect(PREVIEW_INPUT.properties.width.minimum).toBe(MIN_PREVIEW_SIZE);
    expect(PREVIEW_INPUT.properties.height.maximum).toBe(MAX_PREVIEW_SIZE);
    expect(MAX_CSS_CHARS).toBe(20_000);
  });

  it("uses neutral wording in tool text and server instructions", () => {
    const text = TOOLS.map((t) => `${t.title} ${t.description}`).join(" ") + SERVER_INSTRUCTIONS;
    expect(text).not.toMatch(/\b(excellent|good|great|poor|bad|ugly|beautiful)\b/i);
    expect(SERVER_INSTRUCTIONS).toMatch(/not a quality verdict/);
  });

  it("states the local, stateless privacy stance", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/stateless and local: no network, no storage/);
  });
});

describe("outputs conform to their output schemas", () => {
  const samples: [string, unknown][] = [
    ["score_gradient", { css: RGB_CSS }],
    ["score_gradient", { css: "radial-gradient(red, blue)" }],
    ["score_gradient", { css: "nothing here" }],
    ["refine_gradient", { css: RGB_CSS }],
    ["refine_gradient", { css: "linear-gradient(#000, #fff)" }],
    ["complement", { color: "tomato" }],
    ["complement", { color: "rgb(255 0 0 / .4)" }],
    ["render_preview", { css: RGB_CSS }],
    ["render_preview", { stops: [{ color: "red" }, { color: "blue" }], interpolation: "oklab" }],
  ];
  it.each(samples)("%s %j", (name, args) => {
    const r = callTool(name, args);
    expect(r.isError).toBeUndefined();
    expect(validate(byName(name).outputSchema, r.structuredContent, "output")).toBeNull();
  });

  it("returns no structured content on errors", () => {
    const r = callTool("score_gradient", {});
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toBeUndefined();
    expect(r.content).toHaveLength(1);
  });
});

describe("schema validation of tool inputs", () => {
  const bad: [string, unknown, RegExp][] = [
    ["score_gradient", { css: "" }, /at least 1 character/],
    ["score_gradient", { css: ["a"] }, /expected a string/],
    ["score_gradient", { stops: "red,blue" }, /expected an array/],
    ["score_gradient", { stops: [{ color: "red" }, "blue"] }, /stops\[1\]: expected an object/],
    ["score_gradient", { stops: [{ position: 1 }, { color: "blue" }] }, /stops\[0\]: missing required property "color"/],
    ["score_gradient", { stops: [{ color: "red" }, { color: "blue" }], interpolation: "lab" }, /interpolation: must be one of/],
    ["refine_gradient", { css: "x", angle: 1e9 }, /angle: must be at most 3600/],
    ["refine_gradient", { css: "x", extra: 1 }, /unknown property "extra"/],
    ["complement", { color: "" }, /at least 1 character/],
    ["render_preview", { css: "x", index: 1.5 }, /index: expected an integer/],
    ["render_preview", { css: "x", index: 1001 }, /index: must be at most 1000/],
  ];
  it.each(bad)("%s rejects %j", (name, args, pattern) => {
    const r = callTool(name, args);
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toMatch(pattern);
  });
});
