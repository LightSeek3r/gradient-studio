import { describe, expect, it } from "vitest";
import { MAX_DIRECTIONS, type GradientDirection } from "@opal42/gradient";
import { defaultDocument, MAX_STOPS, sameDocument, withSequentialIds, type GradientDocument } from "../src/state/document";
import { documentReducer, widestGapPosition } from "../src/state/reducer";
import { setDirectionCount, widestGapAngle } from "../src/state/directions";
import { createHistory, createHistoryReducer } from "../src/state/history";

const doc = (): GradientDocument => defaultDocument();

describe("documentReducer", () => {
  it("sets a stop colour (lowercased) and ignores invalid colours", () => {
    const d = documentReducer(doc(), { type: "setStopColor", id: 2, color: "#FF0000" });
    expect(d.ticks.find((t) => t.id === 2)?.color).toBe("#ff0000");
    const same = doc();
    expect(documentReducer(same, { type: "setStopColor", id: 2, color: "red" })).toBe(same);
  });

  it("returns the same object for no-op actions", () => {
    const d = doc();
    expect(documentReducer(d, { type: "setStopColor", id: 1, color: "#101b45" })).toBe(d);
    expect(documentReducer(d, { type: "setStopPosition", id: 99, position: 10 })).toBe(d);
    expect(documentReducer(d, { type: "setBlend", blend: "normal" })).toBe(d);
    expect(documentReducer(d, { type: "reset" })).toBe(d);
  });

  it("clamps positions and rejects non-finite ones", () => {
    let d = documentReducer(doc(), { type: "setStopPosition", id: 2, position: 140 });
    expect(d.ticks[1].position).toBe(100);
    d = documentReducer(d, { type: "setStopPosition", id: 2, position: -3 });
    expect(d.ticks[1].position).toBe(0);
    expect(documentReducer(d, { type: "setStopPosition", id: 2, position: NaN })).toBe(d);
  });

  it("moves a stop by a delta, clamped", () => {
    let d = documentReducer(doc(), { type: "moveStop", id: 2, delta: 10 });
    expect(d.ticks[1].position).toBe(60);
    d = documentReducer(d, { type: "moveStop", id: 2, delta: 100 });
    expect(d.ticks[1].position).toBe(100);
  });

  it("adds a stop with a deterministic id, sampling the gradient colour", () => {
    const d = documentReducer(doc(), { type: "addStop", position: 25 });
    expect(d.ticks).toHaveLength(4);
    const added = d.ticks[3];
    expect(added.id).toBe(4);
    expect(added.position).toBe(25);
    expect(added.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(added.color).not.toBe("#101b45");
  });

  it("adds in the widest gap by default and respects the stop cap", () => {
    expect(widestGapPosition(doc().ticks)).toBe(25);
    let d = doc();
    for (let i = 0; i < 20; i++) d = documentReducer(d, { type: "addStop" });
    expect(d.ticks).toHaveLength(MAX_STOPS);
    expect(documentReducer(d, { type: "addStop" })).toBe(d);
  });

  it("removes a stop but never below two", () => {
    const d = documentReducer(doc(), { type: "removeStop", id: 2 });
    expect(d.ticks.map((t) => t.id)).toEqual([1, 3]);
    expect(documentReducer(d, { type: "removeStop", id: 1 })).toBe(d);
  });

  it("normalises angles, clamps weights and keeps one direction enabled", () => {
    let d = documentReducer(doc(), { type: "setAngle", id: 1, angle: -90 });
    expect(d.directions[0].angle).toBe(270);
    d = documentReducer(d, { type: "setWeight", id: 1, weight: 500 });
    expect(d.directions[0].weight).toBe(100);
    expect(documentReducer(d, { type: "setEnabled", id: 1, enabled: false })).toBe(d);
    d = documentReducer(d, { type: "addDirection" });
    d = documentReducer(d, { type: "setEnabled", id: 1, enabled: false });
    expect(d.directions[0].enabled).toBe(false);
  });

  it("adds directions into the widest gap and removes them", () => {
    let d = documentReducer(doc(), { type: "addDirection" });
    expect(d.directions[1]).toMatchObject({ id: 2, angle: 315, enabled: true });
    d = documentReducer(d, { type: "removeDirection", id: 1 });
    expect(d.directions.map((x) => x.id)).toEqual([2]);
    expect(documentReducer(d, { type: "removeDirection", id: 2 })).toBe(d);
  });

  it("spreads directions evenly from the first", () => {
    let d = documentReducer(doc(), { type: "setDirectionCount", count: 3 });
    d = documentReducer(d, { type: "spreadDirections" });
    expect(d.directions.map((x) => x.angle)).toEqual([135, 255, 15]);
  });

  it("sets the blend mode and rejects unknown ones", () => {
    const d = documentReducer(doc(), { type: "setBlend", blend: "screen" });
    expect(d.blend).toBe("screen");
    // @ts-expect-error - runtime guard
    expect(documentReducer(d, { type: "setBlend", blend: "bogus" })).toBe(d);
  });

  it("applies a (partial) suggestion by id", () => {
    const d = documentReducer(doc(), {
      type: "applySuggestion",
      ticks: [{ id: 2, color: "#aabbcc", position: 40 }],
    });
    expect(d.ticks[1]).toEqual({ id: 2, color: "#aabbcc", position: 40 });
    expect(d.ticks[0]).toEqual(doc().ticks[0]);
  });

  it("imports with sequential ids and resets", () => {
    const imported: GradientDocument = {
      ticks: [
        { id: 40, color: "#0000ff", position: 100 },
        { id: 7, color: "#ff0000", position: 0 },
      ],
      directions: [{ id: 9, angle: 90, weight: 100, enabled: true }],
      blend: "normal",
    };
    const d = documentReducer(doc(), { type: "import", document: imported });
    expect(d.ticks).toEqual([
      { id: 1, color: "#ff0000", position: 0 },
      { id: 2, color: "#0000ff", position: 100 },
    ]);
    expect(d.directions[0].id).toBe(1);
    expect(sameDocument(documentReducer(d, { type: "reset" }), defaultDocument())).toBe(true);
  });

  it("withSequentialIds is deterministic", () => {
    const a = withSequentialIds(doc());
    expect(withSequentialIds(a)).toEqual(a);
  });
});

describe("history", () => {
  const reducer = createHistoryReducer(documentReducer, { limit: 100, coalesceMs: 800 });
  const start = () => createHistory(doc());

  it("records, undoes and redoes", () => {
    let h = reducer(start(), { type: "do", action: { type: "setBlend", blend: "screen" }, time: 0 });
    h = reducer(h, { type: "do", action: { type: "setBlend", blend: "multiply" }, time: 10 });
    expect(h.past).toHaveLength(2);
    h = reducer(h, { type: "undo" });
    expect(h.present.blend).toBe("screen");
    h = reducer(h, { type: "undo" });
    expect(h.present.blend).toBe("normal");
    expect(reducer(h, { type: "undo" })).toBe(h);
    h = reducer(h, { type: "redo" });
    expect(h.present.blend).toBe("screen");
    h = reducer(h, { type: "redo" });
    expect(h.present.blend).toBe("multiply");
    expect(reducer(h, { type: "redo" })).toBe(h);
  });

  it("a new edit clears the redo stack", () => {
    let h = reducer(start(), { type: "do", action: { type: "setBlend", blend: "screen" }, time: 0 });
    h = reducer(h, { type: "undo" });
    h = reducer(h, { type: "do", action: { type: "setBlend", blend: "darken" }, time: 5 });
    expect(h.future).toHaveLength(0);
  });

  it("does not record no-ops", () => {
    const h0 = start();
    expect(reducer(h0, { type: "do", action: { type: "removeStop", id: 99 }, time: 0 })).toBe(h0);
  });

  it("coalesces same-key steps within the window: one drag = one step", () => {
    let h = start();
    for (let i = 0; i < 30; i++) {
      h = reducer(h, { type: "do", action: { type: "setStopPosition", id: 2, position: 50 + i }, key: "move:2", time: i * 16 });
    }
    expect(h.past).toHaveLength(1);
    expect(h.present.ticks[1].position).toBe(79);
    h = reducer(h, { type: "undo" });
    expect(h.present.ticks[1].position).toBe(50);
  });

  it("splits runs on a gap longer than the window, a different key, or commit", () => {
    let h = start();
    const move = (p: number, time: number, key = "move:2") =>
      (h = reducer(h, { type: "do", action: { type: "setStopPosition", id: 2, position: p }, key, time }));
    move(51, 0);
    move(52, 900); // > 800 ms later
    expect(h.past).toHaveLength(2);
    move(53, 950, "color:2");
    expect(h.past).toHaveLength(3);
    move(54, 960);
    h = reducer(h, { type: "commit" });
    move(55, 970);
    expect(h.past).toHaveLength(5);
  });

  it("keyless steps never coalesce", () => {
    let h = start();
    h = reducer(h, { type: "do", action: { type: "moveStop", id: 2, delta: 1 }, time: 0 });
    h = reducer(h, { type: "do", action: { type: "moveStop", id: 2, delta: 1 }, time: 1 });
    expect(h.past).toHaveLength(2);
  });

  it("caps the history at the limit", () => {
    const small = createHistoryReducer(documentReducer, { limit: 100 });
    let h = start();
    for (let i = 0; i < 150; i++) {
      h = small(h, { type: "do", action: { type: "setStopPosition", id: 2, position: i % 2 ? 10 : 20 }, time: i * 1000 });
    }
    expect(h.past).toHaveLength(100);
    for (let i = 0; i < 200; i++) h = small(h, { type: "undo" });
    expect(h.past).toHaveLength(0);
    expect(h.future).toHaveLength(100);
  });

  it("load replaces everything without history", () => {
    let h = reducer(start(), { type: "do", action: { type: "setBlend", blend: "screen" }, time: 0 });
    h = reducer(h, { type: "load", present: doc() });
    expect(h.past).toHaveLength(0);
    expect(h.present.blend).toBe("normal");
  });
});

describe("direction count presets (B6)", () => {
  const custom: GradientDirection[] = [
    { id: 1, angle: 10, weight: 30, enabled: true },
    { id: 2, angle: 100, weight: 80, enabled: false },
    { id: 3, angle: 200, weight: 55, enabled: true },
  ];

  it("returns the same array when the count is unchanged", () => {
    expect(setDirectionCount(custom, 3)).toBe(custom);
  });

  it("preserves existing layers when growing; new ones go into the widest gaps", () => {
    const next = setDirectionCount(custom, 5);
    expect(next.slice(0, 3)).toEqual(custom);
    // Widest gap 200 -> 370 (170°), midpoint 285; then 100 -> 200 (or 285->370) etc.
    expect(next[3]).toMatchObject({ id: 4, angle: 285, weight: 100, enabled: true });
    expect(next[4].id).toBe(5);
    const angles = next.map((d) => d.angle);
    expect(new Set(angles).size).toBe(5);
  });

  it("removes from the end when shrinking", () => {
    expect(setDirectionCount(custom, 2)).toEqual(custom.slice(0, 2));
  });

  it("re-enables the first layer if trimming leaves none enabled", () => {
    const allButFirstOff = [
      { id: 1, angle: 0, weight: 50, enabled: false },
      { id: 2, angle: 90, weight: 50, enabled: true },
    ];
    expect(setDirectionCount(allButFirstOff, 1)).toEqual([{ id: 1, angle: 0, weight: 50, enabled: true }]);
  });

  it("clamps to 1..MAX_DIRECTIONS", () => {
    expect(setDirectionCount(custom, 99)).toHaveLength(MAX_DIRECTIONS);
    expect(setDirectionCount(custom, 0)).toHaveLength(1);
  });

  it("round trip grow then shrink restores the original layers", () => {
    expect(setDirectionCount(setDirectionCount(custom, 7), 3)).toEqual(custom);
  });

  it("is undoable through the history wrapper", () => {
    const reducer = createHistoryReducer(documentReducer);
    let h = createHistory<GradientDocument>({ ...defaultDocument(), directions: custom });
    h = reducer(h, { type: "do", action: { type: "setDirectionCount", count: 1 }, time: 0 });
    expect(h.present.directions).toHaveLength(1);
    h = reducer(h, { type: "undo" });
    expect(h.present.directions).toEqual(custom);
  });

  it("widestGapAngle handles empty and single inputs", () => {
    expect(widestGapAngle([])).toBe(135);
    expect(widestGapAngle([135])).toBe(315);
    expect(widestGapAngle([0, 180])).toBe(90);
  });
});
