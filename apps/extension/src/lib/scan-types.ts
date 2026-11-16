// Serialisable types shared by the in-page scanner (scanner.ts), the result
// validator (scan-result.ts) and the scan runner (scan-runner.ts).
//
// Everything here crosses the boundary between the inspected page and the
// panel as JSON. The page controls its side of that boundary (it can patch
// built-ins, so even the scanner's output is UNTRUSTED): scan-result.ts
// validates every field before the panel uses it.

/** Where a gradient text was found. */
export type HitSource =
  /** A tracked property of an element's computed style (values are resolved: var() is substituted). */
  | "computed"
  /** A declaration in a same-origin stylesheet rule (the text as written, var() unresolved). */
  | "stylesheet"
  /** A custom property whose value holds a gradient, read from computed style at the element that declares it. */
  | "custom-property";

export interface RawHit {
  source: HitSource;
  /** CSS property (`background-image`) or custom property (`--hero`) the text came from. */
  property: string;
  /** The declaration value; contains at least one `gradient(`. Clipped to the request's maxValueLength. */
  value: string;
  /** True when `value` was clipped. */
  truncated?: boolean;
  /** Short readable label: `div.card`, `main > h1::before` (elements) or the rule's selector text (stylesheets). */
  selector: string;
  /** A selector that matches exactly the element again (for highlighting); empty for stylesheet hits. */
  path: string;
  /** Stylesheet hits: the sheet (URL without query, or `<style>`). Empty for element hits. */
  origin: string;
}

export type ScanRequest =
  | { op: "info" }
  | {
      op: "sheet";
      /** Index into document.styleSheets followed by document.adoptedStyleSheets. */
      index: number;
      /** Rules already visited in earlier calls for this sheet. */
      skip: number;
      /** Stop (and report `capped`) after this many rules in total for this sheet. */
      maxRules: number;
      /** Time budget for this call in ms; the call returns early with `next` set. */
      budgetMs: number;
      maxValueLength: number;
    }
  | {
      op: "elements";
      /** Index into document.getElementsByTagName("*"). */
      start: number;
      /** At most this many elements in this call. */
      count: number;
      budgetMs: number;
      /** Custom property names (`--x`) whose declared value holds a gradient. */
      customProps: string[];
      /** Also read ::before and ::after of elements that generate them. */
      pseudo: boolean;
      maxValueLength: number;
      /** Stop the call once this many hits were collected. */
      maxHits: number;
    };

export interface InfoResult {
  op: "info";
  /** Elements in the document right now. */
  elements: number;
  /** Stylesheets: document.styleSheets plus document.adoptedStyleSheets. */
  sheets: number;
  readyState: "loading" | "interactive" | "complete" | "unknown";
}

export type SheetStatus = "ok" | "cross-origin" | "error";

export interface SheetResult {
  op: "sheet";
  index: number;
  /** URL without query/hash, `<style>` or `<constructed stylesheet>`. */
  label: string;
  status: SheetStatus;
  hits: RawHit[];
  /** Custom property names declared with a gradient value in this sheet. */
  customProps: string[];
  /** Rules visited so far for this sheet (cumulative). */
  rules: number;
  /** Resume point (`skip` of the next call), or null when the sheet is done. */
  next: number | null;
  /** The sheet has more rules than `maxRules`; the rest was not read. */
  capped: boolean;
}

export interface ElementsResult {
  op: "elements";
  start: number;
  /** First element index not processed yet (> start). */
  next: number;
  /** Elements in the document at the time of the call. */
  total: number;
  hits: RawHit[];
  /** The call stopped early because `maxHits` was reached. */
  hitCapReached: boolean;
}

export interface ErrorResult {
  op: "error";
  message: string;
}

export type ScanResult = InfoResult | SheetResult | ElementsResult | ErrorResult;

/** Limits of one scan. The numbers are documented in docs/extension.md. */
export interface ScanLimits {
  /** Elements examined; more are reported as not scanned (5000). */
  maxElements: number;
  /** Elements per in-page call (250); each call is also time-boxed. */
  elementChunk: number;
  /** In-page time budget per call, ms (12). */
  budgetMs: number;
  /** Rules per stylesheet (60000). */
  maxRulesPerSheet: number;
  /** Stylesheets read (200). */
  maxSheets: number;
  /** Characters kept of one declaration value (20000). */
  maxValueLength: number;
  /** Hits kept over the whole scan (20000). */
  maxHits: number;
  /** Read ::before / ::after too. */
  pseudo: boolean;
}

export const DEFAULT_LIMITS: ScanLimits = {
  maxElements: 5000,
  elementChunk: 250,
  budgetMs: 12,
  maxRulesPerSheet: 60000,
  maxSheets: 200,
  maxValueLength: 20000,
  maxHits: 20000,
  pseudo: true,
};
