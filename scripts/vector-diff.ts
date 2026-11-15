// ── Vector diff: prove every changed vector is explained by a defect fix ───────
// Run with:  npm run vectors:diff [-- <git-ref>]   (default ref: HEAD)
//
// Compares spec/vectors/v1-*.json on disk with the same files at <git-ref>,
// case by case (score/suggest/interpolate/css/findings by `name`, colour cases
// by kind + input). Each changed case is classified by which pre-freeze defect
// fix(es) explain it, using INPUT predicates (and, for D5, the old vector's own
// scores) — never the new output — plus field-level rules: e.g. a D4-only
// score case may differ only by the inserted formerly-silent messages, a D2
// case only in `samples`, and colorAtPosition / CSS / colour vectors may not
// change at all. Unchanged cases are compared as serialised JSON, i.e. their
// line in the file is byte-identical. Exits 1 if any change is unexplained.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { V1_MODEL } from "../src/scoring-model-v1";
import {
  hasDegenerateHueMean,
  hasGreyOrHardStop,
  isD2Region,
  isUnsorted,
  silentPenalties,
  type Measurements,
  type Stop,
} from "./vector-lib";

type Json = Record<string, unknown>;
type Defect = "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | "D7";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const ref = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "HEAD";
const markdown = process.argv.includes("--markdown");

const FILES = ["v1-score.json", "v1-suggest.json", "v1-interpolate.json", "v1-css.json", "v1-color.json", "v1-findings.json"];

const D4_MESSAGES = new Set<string>([
  V1_MODEL.hue.arc.narrow.message,
  V1_MODEL.rhythm.edge.slight.message,
  V1_MODEL.rhythm.span.narrow.message,
  V1_MODEL.rhythm.gaps.uneven.message,
]);

/** Rules 1a / 1a' (the only ones that walked the stops in array order). */
const D6_MESSAGE = new RegExp(
  `^(${V1_MODEL.lightness.reversal.messageTemplate.split("(")[0].trim()}|${V1_MODEL.lightness.perceivedReversal.tier.message.split("(")[0].trim()})`,
);

function loadOld(file: string): Json | null {
  try {
    const text = execFileSync("git", ["show", `${ref}:spec/vectors/${file}`], {
      cwd: root,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(text) as Json;
  } catch {
    return null;
  }
}

function loadNew(file: string): Json | null {
  const p = resolve(root, "spec/vectors", file);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf-8")) as Json) : null;
}

const caseId = (file: string, c: Json): string =>
  file === "v1-color.json" ? `${String(c.kind)} ${JSON.stringify(c.input)}` : String(c.name);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function sortedStops(stops: Stop[]): Stop[] {
  return [...stops].sort((a, b) => a.position - b.position).map((s) => ({ id: s.id, color: s.color, position: s.position }));
}

/** Tag changes are fine when every added/removed tag is one of the explanations. */
function tagsExplained(o: Json, n: Json, why: Set<Defect>): boolean {
  const a = new Set((o.defects as string[]) ?? []);
  const b = new Set((n.defects as string[]) ?? []);
  for (const t of [...a, ...b]) if (a.has(t) !== b.has(t) && !why.has(t as Defect)) return false;
  return true;
}

interface Verdict {
  explained: boolean;
  defects: Set<Defect>;
  fields: string[];
  note?: string;
}

function classify(file: string, o: Json, n: Json): Verdict {
  const fields = [...new Set([...Object.keys(o), ...Object.keys(n)])].filter((k) => !same(o[k], n[k]));
  const why = new Set<Defect>();
  const stops = o.stops as Stop[];
  const fail = (note: string): Verdict => ({ explained: false, defects: why, fields, note });
  const allowOnly = (allowed: string[]): Verdict | null => {
    const bad = fields.filter((f) => !allowed.includes(f));
    return bad.length ? fail(`fields not explainable: ${bad.join(", ")}`) : null;
  };

  if (!same(o.stops, n.stops) || !same(o.name, n.name)) return fail("input changed");

  switch (file) {
    case "v1-score.json": {
      if (isUnsorted(stops)) why.add("D6");
      if (o.measurements && silentPenalties(o.measurements as Measurements, stops)) why.add("D4");
      if (!why.size) return fail("no defect region");
      const allowed = why.has("D6") ? ["score", "details", "issues", "defects"] : ["issues", "defects"];
      const r = allowOnly(allowed);
      if (r) return r;
      if (!why.has("D6")) {
        const stripped = (n.issues as string[]).filter((m) => !D4_MESSAGES.has(m));
        if (!same(stripped, o.issues)) return fail("issues differ by more than the D4 messages");
      } else {
        // D6 only moved rules 1a/1a' (reversal, Helmholtz–Kohlrausch), which used
        // to walk array order: every other dimension and message must be intact.
        const od = o.details as Json;
        const nd = n.details as Json;
        for (const k of ["hue", "chroma", "spacing"]) if (od[k] !== nd[k]) return fail(`D6 changed details.${k}`);
        if ((n.score as number) - (o.score as number) !== (nd.lightness as number) - (od.lightness as number)) {
          return fail("D6 score change is not the lightness change");
        }
        const strip = (xs: string[]) => xs.filter((m) => !D4_MESSAGES.has(m) && !D6_MESSAGE.test(m));
        if (!same(strip(n.issues as string[]), strip(o.issues as string[]))) {
          return fail("D6 changed issues other than reversal / H-K");
        }
      }
      break;
    }
    case "v1-suggest.json": {
      const unsorted = isUnsorted(stops);
      if (unsorted) why.add("D6");
      const greyOrHard = hasGreyOrHardStop(stops);
      const lowered = (o.scoreAfter as number) < (o.scoreBefore as number);
      if (greyOrHard || lowered) why.add("D5");
      if (hasDegenerateHueMean(stops)) why.add("D7");
      if (!why.size) return fail("no defect region");
      const r = allowOnly(["scoreBefore", "suggested", "scoreAfter", "defects"]);
      if (r) return r;
      if (fields.includes("scoreBefore") && !unsorted) return fail("scoreBefore changed without D6");
      const declined = same(n.suggested, sortedStops(stops));
      // Only "old refine lowered the score" (or D6 moving the baseline) can
      // explain the new output; then it must be the declined (unchanged) input.
      if (fields.includes("suggested") && !greyOrHard && !why.has("D7") && !declined) {
        return fail("suggestion changed but is not the declined input");
      }
      if ((n.scoreAfter as number) < (n.scoreBefore as number)) return fail("refine lowers the score");
      break;
    }
    case "v1-interpolate.json": {
      if (isD2Region(stops)) why.add("D2");
      if (!why.size) return fail("no defect region");
      const r = allowOnly(["samples", "defects"]);
      if (r) return r;
      const ps = stops.map((s) => s.position);
      const spans = Math.min(...ps) <= 0 && Math.max(...ps) >= 100;
      if (spans) {
        // Spanning, but tied at the last position: only the t = 1 sample may move.
        const os = o.samples as Record<string, string[]>;
        const ns = n.samples as Record<string, string[]>;
        for (const k of Object.keys(os)) {
          if (!same(os[k].slice(0, -1), ns[k].slice(0, -1))) return fail("interior samples moved for spanning stops");
        }
      }
      break;
    }
    default:
      return fail("this file may not change");
  }
  if (!tagsExplained(o, n, why)) return fail("defect tags changed beyond the explanation");
  return { explained: true, defects: why, fields };
}

interface FileReport {
  file: string;
  status: "new" | "compared" | "missing";
  total: number;
  unchanged: number;
  added: string[];
  removed: string[];
  changed: { id: string; v: Verdict }[];
  header: string[];
}

function compare(file: string): FileReport {
  const oldF = loadOld(file);
  const newF = loadNew(file);
  const rep: FileReport = { file, status: "compared", total: 0, unchanged: 0, added: [], removed: [], changed: [], header: [] };
  if (!newF) return { ...rep, status: "missing" };
  const newCases = newF.cases as Json[];
  rep.total = newCases.length;
  if (!oldF) return { ...rep, status: "new", added: newCases.map((c) => caseId(file, c)) };

  for (const k of new Set([...Object.keys(oldF), ...Object.keys(newF)])) {
    if (k !== "cases" && !same(oldF[k], newF[k])) rep.header.push(k);
  }
  const oldById = new Map((oldF.cases as Json[]).map((c) => [caseId(file, c), c]));
  const newById = new Map(newCases.map((c) => [caseId(file, c), c]));
  if (oldById.size !== (oldF.cases as Json[]).length || newById.size !== newCases.length) {
    throw new Error(`${file}: case ids are not unique`);
  }
  for (const id of oldById.keys()) if (!newById.has(id)) rep.removed.push(id);
  for (const [id, n] of newById) {
    const o = oldById.get(id);
    if (!o) rep.added.push(id);
    else if (same(o, n)) rep.unchanged++;
    else rep.changed.push({ id, v: classify(file, o, n) });
  }
  return rep;
}

const reports = FILES.map(compare);
let ok = true;
const lines: string[] = [];
const out = (s = "") => lines.push(s);

out(`Vector diff against ${ref}`);
for (const r of reports) {
  out();
  out(`## ${r.file} (${r.status})`);
  if (r.status !== "compared") {
    out(`  ${r.total} cases${r.status === "new" ? " (new file, nothing to compare)" : ""}`);
    continue;
  }
  const unexplained = r.changed.filter((c) => !c.v.explained);
  out(`  cases: ${r.total}; byte-identical: ${r.unchanged}; changed: ${r.changed.length}; added: ${r.added.length}; removed: ${r.removed.length}; unexplained: ${unexplained.length}`);
  if (r.header.length) out(`  header keys changed: ${r.header.join(", ")}`);
  const perDefect = new Map<string, number>();
  const combos = new Map<string, number>();
  for (const c of r.changed) {
    for (const d of c.v.defects) perDefect.set(d, (perDefect.get(d) ?? 0) + 1);
    const key = [...c.v.defects].sort().join("+") + " → " + c.v.fields.join(",");
    combos.set(key, (combos.get(key) ?? 0) + 1);
  }
  for (const [d, k] of [...perDefect].sort()) out(`  ${d}: ${k} changed case(s)`);
  for (const [k, v] of [...combos].sort()) out(`    ${v} × ${k}`);
  if (r.added.length) out(`  added: ${r.added.map((a) => JSON.stringify(a)).join(", ")}`);
  for (const id of r.removed) {
    ok = false;
    out(`  REMOVED (not allowed): ${id}`);
  }
  for (const c of unexplained) {
    ok = false;
    out(`  UNEXPLAINED: ${c.id} — ${c.v.note} [fields: ${c.v.fields.join(", ")}]`);
  }
}

if (markdown) {
  out();
  out("| file | cases | byte-identical | changed | added | D2 | D4 | D5 | D6 | D7 | unexplained |");
  out("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const r of reports) {
    const count = (d: Defect) => r.changed.filter((c) => c.v.defects.has(d)).length;
    const un = r.changed.filter((c) => !c.v.explained).length;
    out(
      r.status === "compared"
        ? `| ${r.file} | ${r.total} | ${r.unchanged} | ${r.changed.length} | ${r.added.length} | ${count("D2")} | ${count("D4")} | ${count("D5")} | ${count("D6")} | ${count("D7")} | ${un} |`
        : `| ${r.file} | ${r.total} | — | — | ${r.total} (new file) | | | | | | |`,
    );
  }
}

out();
out(ok ? "OK: every changed case is explained by a defect fix; all other cases are byte-identical." : "FAIL: unexplained vector changes.");
console.log(lines.join("\n"));
process.exit(ok ? 0 : 1);
