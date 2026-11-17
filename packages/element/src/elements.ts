// ── The custom elements ────────────────────────────────────────────────────────
// Importing this module touches no DOM: `HTMLElement` is only read through the
// guarded `Base` below, and `customElements` is only used by `defineElements`
// (define.ts). Under plain Node the classes exist but cannot be constructed.

import { analyzeCss, refineCss, type ElementResult } from "./analyze";
import { createTranslate, parseMessagesJson, type Translate } from "./messages";
import { applyStyles, PREVIEW_CSS, SCORE_CSS } from "./styles";
import { createSkeleton, groupName, liveText, paintSwatch, renderContent, renderPreview, type Skeleton, type ViewOptions } from "./view";

const Base = (typeof HTMLElement === "undefined" ? class {} : HTMLElement) as typeof HTMLElement;

/** Default debounce of attribute and child-text updates, in milliseconds. */
export const DEFAULT_DEBOUNCE_MS = 50;

export interface ScoreEventDetail {
  score: number | null;
  status: ElementResult["status"];
  findings: ElementResult["findings"];
}

export interface ErrorEventDetail {
  /** `too-large`, `no-gradient`, `index-out-of-range` or `internal`. */
  code: string;
  message: string;
}

const FALSE = new Set(["false", "0", "off", "no"]);
/** A boolean attribute that is on when present, unless its value spells "false". */
const flagOn = (value: string | null): boolean => value !== null && !FALSE.has(value.trim().toLowerCase());

function parseIndex(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : -1;
}

/** Shared plumbing: shadow root, source text, debounce, mutation observer. */
abstract class GradientElement extends Base {
  #timer: ReturnType<typeof setTimeout> | undefined;
  #observer: MutationObserver | undefined;
  #connected = false;
  #result: ElementResult | null = null;
  #messages: Record<string, string> | null = null;
  #t: Translate | null = null;

  protected readonly root: ShadowRoot;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
    applyStyles(this.root, this.styleText());
  }

  protected abstract styleText(): string;
  /** Re-renders into the shadow root. */
  protected abstract paint(result: ElementResult, t: Translate): void;
  protected abstract analyzeOptions(): { index: number | null; withFix: boolean };

  /** The CSS text that is analysed: the `css` attribute, else the light-DOM text. */
  get css(): string {
    const attr = this.getAttribute("css");
    return attr !== null ? attr : (this.textContent ?? "");
  }
  set css(value: string | null | undefined) {
    if (value === null || value === undefined) this.removeAttribute("css");
    else this.setAttribute("css", String(value));
  }

  /** 0-based gradient to show; null picks the first scorable one. */
  get index(): number | null {
    return parseIndex(this.getAttribute("index"));
  }
  set index(value: number | null) {
    if (value === null || value === undefined) this.removeAttribute("index");
    else this.setAttribute("index", String(value));
  }

  /** Accessible name prefix. */
  get label(): string | null {
    return this.getAttribute("label") ?? this.getAttribute("aria-label");
  }
  set label(value: string | null) {
    if (value === null) this.removeAttribute("label");
    else this.setAttribute("label", value);
  }

  /** Text overrides (strings only). A property wins over the `messages` attribute. */
  get messages(): Record<string, string> | null {
    return this.#messages ?? parseMessagesJson(this.getAttribute("messages"));
  }
  set messages(value: Record<string, string> | null) {
    this.#messages = value && typeof value === "object" ? { ...value } : null;
    this.#t = null;
    this.update();
  }

  /** Debounce in ms of attribute / child-text updates (`debounce` attribute; 0 = immediate). */
  get debounce(): number {
    const n = Number(this.getAttribute("debounce"));
    return this.hasAttribute("debounce") && Number.isFinite(n) && n >= 0 ? Math.min(n, 5000) : DEFAULT_DEBOUNCE_MS;
  }
  set debounce(value: number) {
    this.setAttribute("debounce", String(value));
  }

  /** The analysis of the current input. Read-only; recomputed on demand, never emits events. */
  get result(): Readonly<ElementResult> {
    return (this.#result ??= Object.freeze(analyzeCss(this.css, this.analyzeOptions())));
  }

  /** The one-click refinement of the shown gradient as CSS, or null when nothing is scorable. */
  refine(): string | null {
    return refineCss(this.css, this.index);
  }

  protected tr(): Translate {
    if (!this.#t || this.getAttribute("messages") !== this.#attrMessages) {
      this.#attrMessages = this.getAttribute("messages");
      this.#t = createTranslate(this.messages);
    }
    return this.#t;
  }
  #attrMessages: string | null = null;

  /** Schedules a debounced re-render; renders at once with `debounce="0"`. */
  update(): void {
    this.#result = null;
    if (!this.#connected) return;
    clearTimeout(this.#timer);
    const ms = this.debounce;
    if (ms <= 0) this.flush();
    else this.#timer = setTimeout(() => this.flush(), ms);
  }

  /** Renders now. */
  flush(): void {
    clearTimeout(this.#timer);
    if (!this.#connected) return;
    this.#result = null;
    this.paint(this.result, this.tr());
    this.afterPaint(this.result);
  }

  protected afterPaint(result: ElementResult): void {
    void result;
  }

  connectedCallback(): void {
    this.#connected = true;
    if (typeof MutationObserver !== "undefined") {
      this.#observer ??= new MutationObserver(() => this.update());
      this.#observer.observe(this, { childList: true, characterData: true, subtree: true });
    }
    this.flush();
  }

  disconnectedCallback(): void {
    this.#connected = false;
    clearTimeout(this.#timer);
    this.#observer?.disconnect();
  }

  attributeChangedCallback(): void {
    this.update();
  }

  #queue: (() => void)[] | null = null;

  /**
   * Dispatches an event. With `defer`, it (and every event after it, in order)
   * waits a microtask, so listeners added right after the element was created
   * or upgraded still hear the first events.
   */
  protected emit<T>(type: string, detail: T, defer = false): void {
    const fire = () => void this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }));
    if (this.#queue) this.#queue.push(fire);
    else if (defer) {
      const q = (this.#queue = [fire]);
      queueMicrotask(() => {
        this.#queue = null;
        for (const f of q) f();
      });
    } else fire();
  }
}

export class Opal42GradientScoreElement extends GradientElement {
  static readonly observedAttributes = ["css", "index", "show-issues", "show-fix", "compact", "label", "aria-label", "messages", "debounce"];

  #frame: Skeleton | null = null;
  #issuesOpen: boolean | null = null;
  #lastScoreSig: string | null = null;
  #lastErrorSig: string | null = null;
  #lastLive = "";

  protected styleText(): string {
    return SCORE_CSS;
  }

  /** Issues list on unless `show-issues="false"`. */
  get showIssues(): boolean {
    const v = this.getAttribute("show-issues");
    return v === null || flagOn(v);
  }
  set showIssues(on: boolean) {
    this.setAttribute("show-issues", on ? "" : "false");
  }

  /** Suggested-fix preview, off by default. */
  get showFix(): boolean {
    return flagOn(this.getAttribute("show-fix"));
  }
  set showFix(on: boolean) {
    if (on) this.setAttribute("show-fix", "");
    else this.removeAttribute("show-fix");
  }

  get compact(): boolean {
    return flagOn(this.getAttribute("compact"));
  }
  set compact(on: boolean) {
    if (on) this.setAttribute("compact", "");
    else this.removeAttribute("compact");
  }

  protected analyzeOptions() {
    return { index: this.index, withFix: this.showFix };
  }

  protected paint(r: ElementResult, t: Translate): void {
    const doc = this.root.ownerDocument;
    const frame = (this.#frame ??= createSkeleton(doc));
    if (frame.card.parentNode !== this.root) this.root.append(frame.card);
    const opts: ViewOptions = {
      showIssues: this.showIssues,
      showFix: this.showFix,
      compact: this.compact,
      label: this.label || t("label.default"),
    };
    const focusKey = (this.root.activeElement as HTMLElement | null)?.getAttribute("data-key") ?? null;
    frame.card.classList.toggle("compact", opts.compact);
    frame.card.setAttribute("aria-label", groupName(r, opts, t));
    frame.content.replaceChildren(
      renderContent(doc, r, opts, t, {
        issuesOpen: this.#issuesOpen,
        onToggle: (open) => {
          this.#issuesOpen = open;
        },
      }),
    );
    if (focusKey) (frame.content.querySelector(`[data-key="${focusKey}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
    const live = liveText(r, t);
    if (live !== this.#lastLive) {
      this.#lastLive = live;
      frame.live.textContent = live;
    }
  }

  protected override afterPaint(r: ElementResult): void {
    const sig = JSON.stringify([r.status, r.score, r.index, r.findings.map((f) => [f.code, f.severity, f.pointsLost])]);
    if (sig !== this.#lastScoreSig) {
      const first = this.#lastScoreSig === null;
      this.#lastScoreSig = sig;
      const detail: ScoreEventDetail = { score: r.score, status: r.status, findings: r.findings.map((f) => ({ ...f })) };
      this.emit("opal42-score", detail, first);
    }
    const err = r.invalid?.code ?? (r.truncated ? "too-large" : null);
    const esig = err === null ? null : `${err}:${r.index}`;
    if (esig !== this.#lastErrorSig) {
      this.#lastErrorSig = esig;
      if (err !== null) {
        const message = r.invalid?.message ?? "input longer than 20 KB; only the first 20 KB were read";
        this.emit<ErrorEventDetail>("opal42-error", { code: err, message }, true);
      }
    }
  }
}

export class Opal42GradientPreviewElement extends GradientElement {
  static readonly observedAttributes = ["css", "index", "label", "aria-label", "messages", "debounce"];

  protected styleText(): string {
    return PREVIEW_CSS;
  }

  protected analyzeOptions() {
    return { index: this.index, withFix: false };
  }

  protected paint(r: ElementResult, t: Translate): void {
    const swatchEl = renderPreview(this.root.ownerDocument, r, t, this.label);
    const old = this.root.querySelector(".swatch");
    if (old) old.replaceWith(swatchEl);
    else this.root.append(swatchEl);
  }
}

export { paintSwatch };
