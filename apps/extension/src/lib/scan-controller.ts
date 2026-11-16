// The scan lifecycle without React: first scan, manual re-scan, debounced
// re-scan on navigation, and a follow-up while the page is still loading.
// A plain object with a subscribe/getState pair, so the hook is a thin
// `useSyncExternalStore` and the lifecycle is testable on its own.

import { analyzeGroup, groupHits, summarize, summaryText, type Entry, type GroupResult, type Summary } from "./analyze";
import { makeEvalFn, type DevtoolsApi } from "./devtools-api";
import { runScan, ScanError, type ScanStats } from "./scan-runner";

export type ScanPhase = "idle" | "scanning" | "done" | "error";

export interface ScanState {
  phase: ScanPhase;
  /** 0..1 while scanning. */
  progress: number;
  entries: Entry[];
  stats: ScanStats | null;
  group: Pick<GroupResult, "droppedGroups" | "unparsedHits"> | null;
  summary: Summary;
  /** Sentence for the polite live region. */
  announcement: string;
  error: string | null;
  /** Increments with every finished scan. */
  scanId: number;
}

const EMPTY_SUMMARY: Summary = { total: 0, scored: 0, notScored: 0, withIssues: 0 };

export const INITIAL_STATE: ScanState = {
  phase: "idle",
  progress: 0,
  entries: [],
  stats: null,
  group: null,
  summary: EMPTY_SUMMARY,
  announcement: "",
  error: null,
  scanId: 0,
};

/** Wait before re-scanning after a navigation, so a burst of events costs one scan. */
export const NAVIGATION_DEBOUNCE_MS = 700;
/** Follow-up scans while the page reports it is still loading, and the wait between them. */
export const MAX_LOADING_RETRIES = 2;
export const LOADING_RETRY_MS = 1200;
/** Gradients analysed per batch before yielding to the UI. */
const BATCH = 20;

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export class ScanController {
  private readonly api: DevtoolsApi;
  private state: ScanState = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  /** Identifies the current scan loop; a newer loop (or `stop`) makes older ones stop. */
  private loop = 0;
  private navTimer: ReturnType<typeof setTimeout> | undefined;
  private started = false;
  private readonly onNavigated = () => {
    clearTimeout(this.navTimer);
    this.navTimer = setTimeout(() => this.rescan(), NAVIGATION_DEBOUNCE_MS);
  };

  constructor(api: DevtoolsApi) {
    this.api = api;
  }

  /** Stable arrow functions: usable directly with useSyncExternalStore. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  readonly getState = (): ScanState => this.state;

  private set(patch: Partial<ScanState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** First scan and navigation listener. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.api.network?.onNavigated?.addListener(this.onNavigated);
    this.rescan();
  }

  /** Stops everything: pending timers, the running scan, the navigation listener. */
  stop(): void {
    this.started = false;
    this.loop++;
    clearTimeout(this.navTimer);
    this.api.network?.onNavigated?.removeListener(this.onNavigated);
  }

  /** Scan now (cancelling any scan in progress). */
  rescan(): void {
    clearTimeout(this.navTimer);
    const mine = ++this.loop;
    void this.runLoop(mine);
  }

  private async runLoop(mine: number): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      const readyState = await this.scanOnce(mine);
      if (readyState !== "loading" || attempt >= MAX_LOADING_RETRIES) return;
      await new Promise<void>((resolve) => setTimeout(resolve, LOADING_RETRY_MS));
      if (this.loop !== mine) return;
    }
  }

  /** One scan; resolves to the page's readyState, or null if it failed or was superseded. */
  private async scanOnce(mine: number): Promise<string | null> {
    const cancelled = () => this.loop !== mine;
    this.set({ phase: "scanning", progress: 0, error: null, announcement: "Scanning the page for gradients." });
    try {
      const outcome = await runScan(makeEvalFn(this.api), {
        isCancelled: cancelled,
        onProgress: (fraction) => {
          if (!cancelled()) this.set({ progress: fraction * 0.8 });
        },
      });
      const grouped = groupHits(outcome.hits);
      const entries: Entry[] = [];
      for (let i = 0; i < grouped.groups.length; i += BATCH) {
        if (cancelled()) return null;
        for (const g of grouped.groups.slice(i, i + BATCH)) entries.push(analyzeGroup(g));
        this.set({ progress: 0.8 + Math.min(1, (i + BATCH) / Math.max(1, grouped.groups.length)) * 0.2 });
        await yieldToUi();
      }
      if (cancelled()) return null;
      const summary = summarize(entries);
      this.set({
        phase: "done",
        progress: 1,
        entries,
        stats: outcome.stats,
        group: { droppedGroups: grouped.droppedGroups, unparsedHits: grouped.unparsedHits },
        summary,
        announcement: summaryText(summary),
        error: null,
        scanId: this.state.scanId + 1,
      });
      return outcome.stats.readyState;
    } catch (e) {
      if (cancelled() || (e instanceof ScanError && e.code === "cancelled")) return null;
      this.set({ phase: "error", progress: 0, error: e instanceof Error ? e.message : String(e), announcement: "The scan failed." });
      return null;
    }
  }
}
