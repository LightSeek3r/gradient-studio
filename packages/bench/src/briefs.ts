// Brief sets: types, a hand-written validator that mirrors
// prompts/briefs.schema.json (no schema library, no dependency), the brief-set
// hash used in provenance, and the shipped default set.

import defaultSet from "../prompts/briefs.json";
import { canonicalJson, shortHash } from "./canon";

export interface Brief {
  id: string;
  category: string;
  brief: string;
  constraints?: string[];
  brandColors?: string[];
}

export interface BriefSet {
  schemaVersion: 1;
  name: string;
  version: string;
  authoringPolicy: string;
  briefs: Brief[];
}

export const BRIEF_LIMITS = {
  idPattern: /^[a-z0-9]+(-[a-z0-9]+)*-\d{2,3}$/,
  categoryPattern: /^[a-z0-9]+(-[a-z0-9]+)*$/,
  versionPattern: /^\d+\.\d+\.\d+$/,
  hexPattern: /^#[0-9a-f]{6}$/,
  briefMin: 20,
  briefMax: 600,
  constraintMax: 4,
  constraintLen: [3, 200] as const,
  colorMax: 4,
  maxBriefs: 1000,
} as const;

export interface BriefIssue {
  path: string;
  message: string;
}

const TOP_KEYS = new Set(["schemaVersion", "name", "version", "authoringPolicy", "briefs"]);
const BRIEF_KEYS = new Set(["id", "category", "brief", "constraints", "brandColors"]);

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Validates a parsed JSON value. Never throws. */
export function validateBriefSet(value: unknown): BriefIssue[] {
  const issues: BriefIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  if (!isObj(value)) return [{ path: "$", message: "must be an object" }];
  for (const k of Object.keys(value)) if (!TOP_KEYS.has(k)) add(`$.${k}`, "unknown property");
  if (value.schemaVersion !== 1) add("$.schemaVersion", "must be 1");
  const str = (key: string, min: number, max: number) => {
    const v = value[key];
    if (typeof v !== "string") add(`$.${key}`, "must be a string");
    else if (v.length < min || v.length > max) add(`$.${key}`, `length must be ${min}-${max}`);
  };
  str("name", 1, 100);
  str("authoringPolicy", 20, 2000);
  if (typeof value.version !== "string" || !BRIEF_LIMITS.versionPattern.test(value.version)) add("$.version", "must look like 1.2.3");
  const briefs = value.briefs;
  if (!Array.isArray(briefs) || briefs.length < 1 || briefs.length > BRIEF_LIMITS.maxBriefs) {
    add("$.briefs", `must be an array of 1-${BRIEF_LIMITS.maxBriefs} briefs`);
    return issues;
  }
  const seen = new Map<string, number>();
  briefs.forEach((b, i) => {
    const p = `$.briefs[${i}]`;
    if (!isObj(b)) return add(p, "must be an object");
    for (const k of Object.keys(b)) if (!BRIEF_KEYS.has(k)) add(`${p}.${k}`, "unknown property");
    if (typeof b.id !== "string" || !BRIEF_LIMITS.idPattern.test(b.id)) add(`${p}.id`, "must look like '<category>-NN'");
    else {
      const first = seen.get(b.id);
      if (first !== undefined) add(`${p}.id`, `duplicate of briefs[${first}]`);
      else seen.set(b.id, i);
    }
    if (typeof b.category !== "string" || !BRIEF_LIMITS.categoryPattern.test(b.category)) add(`${p}.category`, "must be a kebab-case string");
    else if (typeof b.id === "string" && !b.id.startsWith(`${b.category}-`)) add(`${p}.id`, "must start with '<category>-'");
    if (typeof b.brief !== "string") add(`${p}.brief`, "must be a string");
    else if (b.brief.length < BRIEF_LIMITS.briefMin || b.brief.length > BRIEF_LIMITS.briefMax) add(`${p}.brief`, `length must be ${BRIEF_LIMITS.briefMin}-${BRIEF_LIMITS.briefMax}`);
    else if (b.brief !== b.brief.trim()) add(`${p}.brief`, "must not have leading or trailing whitespace");
    const list = (key: "constraints" | "brandColors", test: (s: string) => string | null, max: number) => {
      const v = b[key];
      if (v === undefined) return;
      if (!Array.isArray(v) || v.length < 1 || v.length > max) return add(`${p}.${key}`, `must be an array of 1-${max} strings`);
      v.forEach((s, j) => {
        if (typeof s !== "string") return add(`${p}.${key}[${j}]`, "must be a string");
        const m = test(s);
        if (m) add(`${p}.${key}[${j}]`, m);
      });
    };
    list("constraints", (s) => (s.length < BRIEF_LIMITS.constraintLen[0] || s.length > BRIEF_LIMITS.constraintLen[1] ? "length must be 3-200" : null), BRIEF_LIMITS.constraintMax);
    list("brandColors", (s) => (BRIEF_LIMITS.hexPattern.test(s) ? null : "must be a lower-case #rrggbb colour"), BRIEF_LIMITS.colorMax);
  });
  return issues;
}

/** Hash of the content that matters for comparability (not of name or policy text). */
export function briefSetHash(set: BriefSet): string {
  return shortHash(canonicalJson(set.briefs));
}

/** Parses brief-set JSON text. Returns the set or the reasons it is invalid. */
export function parseBriefSet(text: string): { ok: true; set: BriefSet } | { ok: false; issues: BriefIssue[] } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return { ok: false, issues: [{ path: "$", message: `not valid JSON: ${e instanceof Error ? e.message : String(e)}` }] };
  }
  const issues = validateBriefSet(value);
  return issues.length ? { ok: false, issues } : { ok: true, set: value as BriefSet };
}

/** The brief set shipped with this package (prompts/briefs.json). */
export const DEFAULT_BRIEF_SET: BriefSet = defaultSet as BriefSet;
