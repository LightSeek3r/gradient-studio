import { defineElements, type Opal42GradientPreviewElement, type Opal42GradientScoreElement } from "../src/index";

export const SMOOTH = "linear-gradient(90deg, #1e3a8a 0%, #3b82f6 50%, #bfdbfe 100%)";
export const ROUGH = "linear-gradient(90deg, #ff0000 0%, #00ff00 20%, #0000ff 40%, #ffff00 60%, #ff00ff 80%, #00ffff 100%)";
export const RADIAL = "radial-gradient(circle, #ff0000, #0000ff)";
export const ALPHA = "linear-gradient(90deg, rgb(255 0 0 / 0.5), #0000ff)";
export const VARS = "linear-gradient(90deg, var(--a), #0000ff)";

export function setup(): void {
  defineElements();
}

/** Mounts an element with `attrs` (and optional text content) into the body and renders it at once. */
export function mount<T extends HTMLElement = Opal42GradientScoreElement>(
  attrs: Record<string, string> = {},
  text?: string,
  tag = "opal42-gradient-score",
): T {
  setup();
  const el = document.createElement(tag) as T;
  el.setAttribute("debounce", "0");
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  document.body.append(el);
  return el;
}

export function mountPreview(attrs: Record<string, string> = {}): Opal42GradientPreviewElement {
  return mount<Opal42GradientPreviewElement>(attrs, undefined, "opal42-gradient-preview");
}

export const shadow = (el: HTMLElement): ShadowRoot => el.shadowRoot as ShadowRoot;
export const q = (el: HTMLElement, sel: string): HTMLElement | null => shadow(el).querySelector(sel);
export const qa = (el: HTMLElement, sel: string): HTMLElement[] => [...shadow(el).querySelectorAll<HTMLElement>(sel)];
export const text = (el: HTMLElement): string => shadow(el).textContent ?? "";

/** Lets queued microtasks (first events) run. */
export const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
