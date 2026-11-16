// The panel's only setting: the address of the Gradient Studio web app. Kept in
// the panel page's own localStorage (an extension page has one; it needs no
// `storage` permission). Nothing else is persisted, nothing leaves the device.
// Every access is wrapped: storage can be blocked or empty.

import { DEFAULT_STUDIO_URL, normalizeStudioUrl } from "./studio-link";

export const SETTINGS_KEY = "opal42-gradient-score:settings:v1";

export interface Settings {
  studioUrl: string;
}

export const DEFAULT_SETTINGS: Settings = { studioUrl: DEFAULT_STUDIO_URL };

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadSettings(store: StorageLike | null = storage()): Settings {
  try {
    const raw = store?.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const data: unknown = JSON.parse(raw);
    if (typeof data === "object" && data !== null) {
      const url = normalizeStudioUrl((data as { studioUrl?: unknown }).studioUrl);
      if (url) return { studioUrl: url };
    }
  } catch {
    /* fall through to the default */
  }
  return { ...DEFAULT_SETTINGS };
}

/** Saves a studio address. Returns the stored (normalised) settings, or null if the address was refused. */
export function saveSettings(studioUrl: string, store: StorageLike | null = storage()): Settings | null {
  const url = normalizeStudioUrl(studioUrl);
  if (!url) return null;
  const settings = { studioUrl: url };
  try {
    if (url === DEFAULT_STUDIO_URL) store?.removeItem(SETTINGS_KEY);
    else store?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* kept for this session only */
  }
  return settings;
}
