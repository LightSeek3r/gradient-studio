// The runner against a scripted fake page (no DOM): protocol, caps, failures.
import { describe, expect, it } from "vitest";
import { runScan, ScanError, type EvalFn } from "../src/lib/scan-runner";
import type { RawHit, ScanRequest } from "../src/lib/scan-types";

const hit = (n: number, source: RawHit["source"] = "computed"): RawHit => ({
  source,
  property: "background-image",
  value: "linear-gradient(red, blue)",
  selector: `div.n${n}`,
  path: `body > div:nth-child(${n})`,
  origin: "",
});

/** The request is embedded in the expression text as the last JSON argument. */
function requestOf(expression: string): ScanRequest {
  const open = expression.lastIndexOf(")({");
  return JSON.parse(expression.slice(open + 2, expression.length - 1)) as ScanRequest;
}

interface Page {
  elements?: number;
  sheets?: ({ status?: "ok" | "cross-origin" | "error"; label?: string; hits?: RawHit[]; customProps?: string[]; slices?: number; capped?: boolean } | undefined)[];
  readyState?: "loading" | "interactive" | "complete" | "unknown";
  hitsPerElementChunk?: (start: number) => RawHit[];
  override?: (req: ScanRequest) => unknown;
}

function fakePage(page: Page = {}) {
  const requests: ScanRequest[] = [];
  const evalFn: EvalFn = async (expression) => {
    const req = requestOf(expression);
    requests.push(req);
    const custom = page.override?.(req);
    if (custom !== undefined) return custom;
    if (req.op === "info") {
      return { op: "info", elements: page.elements ?? 10, sheets: page.sheets?.length ?? 0, readyState: page.readyState ?? "complete" };
    }
    if (req.op === "sheet") {
      const s = page.sheets![req.index] ?? {};
      const slices = s.slices ?? 1;
      const sliceNo = req.skip === 0 ? 1 : req.skip + 1;
      const last = sliceNo >= slices;
      return {
        op: "sheet",
        index: req.index,
        label: s.label ?? "<style>",
        status: s.status ?? "ok",
        hits: s.status && s.status !== "ok" ? [] : last ? (s.hits ?? []) : [],
        customProps: last ? (s.customProps ?? []) : [],
        rules: sliceNo * 5,
        next: s.status && s.status !== "ok" ? null : last ? null : req.skip + 1 === 0 ? 1 : sliceNo,
        capped: last ? (s.capped ?? false) : false,
      };
    }
    const total = page.elements ?? 10;
    const end = Math.max(req.start + 1, Math.min(total, req.start + req.count));
    return { op: "elements", start: req.start, next: end, total, hits: page.hitsPerElementChunk?.(req.start) ?? [], hitCapReached: false };
  };
  return { evalFn, requests };
}

describe("runScan", () => {
  it("asks info first, then every sheet, then the elements in chunks", async () => {
    const { evalFn, requests } = fakePage({ elements: 600, sheets: [{}, {}] });
    const { stats } = await runScan(evalFn, { limits: { elementChunk: 250 } });
    expect(requests.map((r) => r.op)).toEqual(["info", "sheet", "sheet", "elements", "elements", "elements"]);
    expect(stats.elementsScanned).toBe(600);
    expect(stats.calls).toBe(6);
  });

  it("collects hits from sheets and elements", async () => {
    const { evalFn } = fakePage({
      elements: 5,
      sheets: [{ hits: [hit(1, "stylesheet")] }],
      hitsPerElementChunk: (start) => (start === 0 ? [hit(2), hit(3)] : []),
    });
    const { hits } = await runScan(evalFn);
    expect(hits.map((h) => h.selector)).toEqual(["div.n1", "div.n2", "div.n3"]);
  });

  it("hands the custom property names found in sheets to the element calls", async () => {
    const { evalFn, requests } = fakePage({ sheets: [{ customProps: ["--a", "--b"] }, { customProps: ["--b", "--c"] }] });
    await runScan(evalFn);
    const el = requests.find((r) => r.op === "elements");
    expect(el && el.op === "elements" && el.customProps).toEqual(["--a", "--b", "--c"]);
  });

  it("resumes a sheet where the previous call stopped", async () => {
    const { evalFn, requests } = fakePage({ sheets: [{ slices: 3, hits: [hit(1, "stylesheet")] }] });
    const { hits } = await runScan(evalFn);
    const sheetCalls = requests.filter((r) => r.op === "sheet");
    expect(sheetCalls.map((r) => (r.op === "sheet" ? r.skip : -1))).toEqual([0, 1, 2]);
    expect(hits).toHaveLength(1);
  });

  it("records unreadable sheets and carries on", async () => {
    const { evalFn } = fakePage({ sheets: [{ status: "cross-origin", label: "https://cdn.example/a.css" }, { hits: [hit(1, "stylesheet")] }, { status: "error", label: "" }] });
    const { stats, hits } = await runScan(evalFn);
    expect(stats.sheetsSkipped).toEqual([
      { label: "https://cdn.example/a.css", reason: "cross-origin" },
      { label: "stylesheet 3", reason: "error" },
    ]);
    expect(stats.sheetsScanned).toBe(1);
    expect(hits).toHaveLength(1);
  });

  it("caps the elements and reports it", async () => {
    const { evalFn, requests } = fakePage({ elements: 12_000 });
    const { stats } = await runScan(evalFn, { limits: { maxElements: 5000, elementChunk: 250 } });
    expect(stats.elementCapReached).toBe(true);
    expect(stats.elementsScanned).toBe(5000);
    expect(stats.elementsTotal).toBe(12_000);
    const last = requests.filter((r) => r.op === "elements").at(-1);
    expect(last && last.op === "elements" && last.start + last.count).toBe(5000);
  });

  it("does not report a cap for a page exactly at the limit", async () => {
    const { evalFn } = fakePage({ elements: 5000 });
    const { stats } = await runScan(evalFn, { limits: { maxElements: 5000 } });
    expect(stats.elementCapReached).toBe(false);
  });

  it("caps the number of stylesheets read", async () => {
    const { evalFn, requests } = fakePage({ sheets: Array.from({ length: 10 }, () => ({})) });
    const { stats } = await runScan(evalFn, { limits: { maxSheets: 4 } });
    expect(stats.sheetCapReached).toBe(true);
    expect(requests.filter((r) => r.op === "sheet")).toHaveLength(4);
  });

  it("counts capped sheets", async () => {
    const { evalFn } = fakePage({ sheets: [{ capped: true }, {}] });
    expect((await runScan(evalFn)).stats.sheetsCapped).toBe(1);
  });

  it("stops at the total hit cap", async () => {
    const { evalFn } = fakePage({ elements: 1000, hitsPerElementChunk: () => Array.from({ length: 50 }, (_, i) => hit(i)) });
    const { hits, stats } = await runScan(evalFn, { limits: { maxHits: 120, elementChunk: 100 } });
    expect(hits).toHaveLength(120);
    expect(stats.hitCapReached).toBe(true);
  });

  it("counts truncated values", async () => {
    const { evalFn } = fakePage({ elements: 1, hitsPerElementChunk: () => [{ ...hit(1), truncated: true }] });
    expect((await runScan(evalFn)).stats.truncatedValues).toBe(1);
  });

  it("passes the page's readyState through", async () => {
    const { evalFn } = fakePage({ readyState: "loading" });
    expect((await runScan(evalFn)).stats.readyState).toBe("loading");
  });

  it("reports progress from 0 to 1, never backwards", async () => {
    const { evalFn } = fakePage({ elements: 1000, sheets: [{}] });
    const seen: number[] = [];
    await runScan(evalFn, { onProgress: (f) => seen.push(f), limits: { elementChunk: 100 } });
    expect(seen.at(-1)).toBe(1);
    expect(seen.every((v, i) => i === 0 || v >= seen[i - 1])).toBe(true);
    expect(seen.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it("works on an empty page", async () => {
    const { evalFn } = fakePage({ elements: 0 });
    const { hits, stats } = await runScan(evalFn);
    expect(hits).toEqual([]);
    expect(stats.elementsScanned).toBe(0);
  });

  it("sends the limits it was given", async () => {
    const { evalFn, requests } = fakePage();
    await runScan(evalFn, { limits: { budgetMs: 7, maxValueLength: 123, pseudo: false } });
    const el = requests.find((r) => r.op === "elements");
    expect(el && el.op === "elements" && [el.budgetMs, el.maxValueLength, el.pseudo]).toEqual([7, 123, false]);
  });
});

describe("runScan failures", () => {
  it("turns an eval rejection into a page-error", async () => {
    const evalFn: EvalFn = () => Promise.reject(new Error("Cannot access a chrome:// URL"));
    await expect(runScan(evalFn)).rejects.toMatchObject({ name: "ScanError", code: "page-error", message: "Cannot access a chrome:// URL" });
  });

  it("turns a scanner error object into a page-error", async () => {
    const { evalFn } = fakePage({ override: () => ({ op: "error", message: "page broke it" }) });
    await expect(runScan(evalFn)).rejects.toMatchObject({ code: "page-error", message: "page broke it" });
  });

  it("rejects garbage from the page as bad-result", async () => {
    for (const garbage of ["nonsense", null, { op: "info" }, { hello: 1 }, 7]) {
      const { evalFn } = fakePage({ override: () => garbage });
      await expect(runScan(evalFn)).rejects.toMatchObject({ code: "bad-result" });
    }
  });

  it("rejects a result for the wrong op", async () => {
    const { evalFn } = fakePage({ override: (req) => (req.op === "info" ? { op: "elements", start: 0, next: 1, total: 1, hits: [], hitCapReached: false } : undefined) });
    await expect(runScan(evalFn)).rejects.toMatchObject({ code: "bad-result" });
  });

  it("stops when a sheet makes no progress", async () => {
    const { evalFn } = fakePage({
      sheets: [{}],
      override: (req) => (req.op === "sheet" ? { op: "sheet", index: 0, label: "<style>", status: "ok", hits: [], customProps: [], rules: 0, next: 0, capped: false } : undefined),
    });
    await expect(runScan(evalFn)).rejects.toMatchObject({ code: "bad-result" });
  });

  it("gives up after too many calls instead of looping on a misbehaving page", async () => {
    let n = 0;
    const evalFn: EvalFn = async (expression) => {
      const req = requestOf(expression);
      if (req.op === "info") return { op: "info", elements: 1_000_000, sheets: 0, readyState: "complete" };
      n++;
      return { op: "elements", start: req.op === "elements" ? req.start : 0, next: (req.op === "elements" ? req.start : 0) + 1, total: 1_000_000, hits: [], hitCapReached: false };
    };
    await expect(runScan(evalFn, { limits: { maxElements: 1_000_000, elementChunk: 1 } })).rejects.toMatchObject({ code: "bad-result" });
    expect(n).toBeLessThan(2100);
  });

  it("stops between calls when cancelled", async () => {
    const { evalFn, requests } = fakePage({ elements: 5000 });
    let allowed = 3;
    const error = await runScan(evalFn, { isCancelled: () => --allowed < 0 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ScanError);
    expect((error as ScanError).code).toBe("cancelled");
    expect(requests.length).toBe(3);
  });
});
