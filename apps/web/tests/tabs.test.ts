import { tEn } from "../src/i18n/translator";
import { describe, expect, it } from "vitest";
import { TAB_IDS, badgeText, issueSuffix, nextTab, type TabId } from "../src/layout/tabs";

describe("nextTab", () => {
  it("moves right and wraps from the last tab to the first", () => {
    expect(nextTab("stops", "ArrowRight")).toBe("score");
    expect(nextTab("directions", "ArrowRight")).toBe("export");
    expect(nextTab("export", "ArrowRight")).toBe("stops");
  });

  it("moves left and wraps from the first tab to the last", () => {
    expect(nextTab("score", "ArrowLeft")).toBe("stops");
    expect(nextTab("stops", "ArrowLeft")).toBe("export");
  });

  it("Home and End jump to the ends", () => {
    expect(nextTab("directions", "Home")).toBe("stops");
    expect(nextTab("stops", "End")).toBe("export");
  });

  it("ignores keys that are not tab navigation", () => {
    expect(nextTab("stops", "Enter")).toBeNull();
    expect(nextTab("stops", "a")).toBeNull();
    expect(nextTab("stops", "Tab")).toBeNull();
  });

  it("returns null for a tab that is not in the list", () => {
    expect(nextTab("export", "ArrowRight", ["stops", "score"])).toBeNull();
  });

  it("cycles through every tab exactly once", () => {
    const seen: string[] = [];
    let t: TabId = TAB_IDS[0];
    for (let i = 0; i < TAB_IDS.length; i++) {
      seen.push(t);
      t = nextTab(t, "ArrowRight")!;
    }
    expect(seen).toEqual([...TAB_IDS]);
    expect(t).toBe(TAB_IDS[0]);
  });
});

describe("issueSuffix / badgeText", () => {
  it("is spoken after the visible label", () => {
    expect(issueSuffix(3, tEn)).toBe(", 3 issues");
    expect(issueSuffix(1, tEn)).toBe(", 1 issue");
  });

  it("is empty without a badge", () => {
    expect(issueSuffix(null, tEn)).toBe("");
    expect(issueSuffix(0, tEn)).toBe("");
  });

  it("caps long badges", () => {
    expect(badgeText(4)).toBe("4");
    expect(badgeText(12)).toBe("9+");
  });
});
