// Secondary options shared by the rules, and the `properties` filter.

/** A property filter entry: an exact name, or `/regex/flags` as a string, or a RegExp. */
export type PropertyPattern = string | RegExp;

export interface SharedOptions {
  /** Report gradients that could not be scored instead of ignoring them. Default true (= ignore). */
  ignoreUnscorable: boolean;
  /** Do not judge gradients with hard stops (stripes). Default true. */
  skipHardStops: boolean;
  /** Do not judge gradients with translucent stops. Default true. */
  skipAlpha: boolean;
  /** Only look at these properties (names or `/regex/`). Default: every declaration. */
  properties: PropertyPattern[] | null;
}

export const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";
export const isPatternValue = (v: unknown): v is PropertyPattern => typeof v === "string" || v instanceof RegExp;

/** `possible` for stylelint's validateOptions. */
export const sharedPossible = {
  ignoreUnscorable: [isBoolean],
  skipHardStops: [isBoolean],
  skipAlpha: [isBoolean],
  properties: [isPatternValue],
};

export function readOptions(secondary: unknown): SharedOptions {
  const o = (typeof secondary === "object" && secondary !== null ? secondary : {}) as Record<string, unknown>;
  const props = o.properties;
  return {
    ignoreUnscorable: o.ignoreUnscorable !== false,
    skipHardStops: o.skipHardStops !== false,
    skipAlpha: o.skipAlpha !== false,
    properties: props === undefined ? null : [props].flat().filter(isPatternValue),
  };
}

function toRegExp(p: string): RegExp | null {
  const m = /^\/(.+)\/([a-z]*)$/s.exec(p);
  if (!m) return null;
  try {
    return new RegExp(m[1], m[2]);
  } catch {
    return null;
  }
}

/** True when `prop` passes the filter (always, without a filter). */
export function propertyMatches(prop: string, patterns: PropertyPattern[] | null): boolean {
  if (patterns === null) return true;
  for (const p of patterns) {
    if (p instanceof RegExp) {
      p.lastIndex = 0;
      if (p.test(prop)) return true;
      continue;
    }
    const re = toRegExp(p);
    if (re) {
      if (re.test(prop)) return true;
    } else if (prop.startsWith("--") || prop.startsWith("$") || prop.startsWith("@") ? prop === p : prop.toLowerCase() === p.toLowerCase()) {
      return true;
    }
  }
  return false;
}
