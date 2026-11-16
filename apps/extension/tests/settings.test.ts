import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, SETTINGS_KEY } from "../src/lib/settings";
import { DEFAULT_STUDIO_URL } from "../src/lib/studio-link";

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

describe("settings", () => {
  it("defaults to the public studio", () => {
    expect(loadSettings(memory())).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.studioUrl).toBe(DEFAULT_STUDIO_URL);
  });

  it("saves and loads a custom address (normalised)", () => {
    const store = memory();
    expect(saveSettings("https://studio.example.org/app/?q=1", store)).toEqual({ studioUrl: "https://studio.example.org/app/" });
    expect(loadSettings(store).studioUrl).toBe("https://studio.example.org/app/");
  });

  it("refuses an invalid address and stores nothing", () => {
    const store = memory();
    expect(saveSettings("javascript:alert(1)", store)).toBeNull();
    expect(store.data.size).toBe(0);
  });

  it("removes the stored value when set back to the default", () => {
    const store = memory();
    saveSettings("https://studio.example.org/", store);
    saveSettings(DEFAULT_STUDIO_URL, store);
    expect(store.data.has(SETTINGS_KEY)).toBe(false);
  });

  it("ignores corrupt or hostile stored data", () => {
    for (const raw of ["{", "null", "[]", '{"studioUrl":5}', '{"studioUrl":"javascript:alert(1)"}', '{"studioUrl":"http://evil.example/"}']) {
      expect(loadSettings(memory({ [SETTINGS_KEY]: raw })), raw).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("works when storage is unavailable or throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings("https://studio.example.org/", broken)).toEqual({ studioUrl: "https://studio.example.org/" });
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings("https://studio.example.org/", null)).not.toBeNull();
  });
});
