import { Opal42GradientPreviewElement, Opal42GradientScoreElement } from "./elements";

export const SCORE_TAG = "opal42-gradient-score";
export const PREVIEW_TAG = "opal42-gradient-preview";

export interface DefineOptions {
  /** Tag for the score element (default `opal42-gradient-score`). */
  scoreTag?: string;
  /** Tag for the preview element (default `opal42-gradient-preview`). */
  previewTag?: string;
  /** Registry to define in (default `globalThis.customElements`). */
  registry?: CustomElementRegistry;
}

export interface DefineResult {
  scoreTag: string;
  previewTag: string;
  /** False outside a browser (no `customElements`): nothing was defined and nothing threw. */
  defined: boolean;
}

// A constructor can be registered once per registry, so a second tag name for
// the same element gets a trivial subclass.
const used = new WeakMap<CustomElementRegistry, Set<CustomElementConstructor>>();

function defineOne(registry: CustomElementRegistry, tag: string, Ctor: CustomElementConstructor): void {
  const existing = registry.get(tag);
  if (existing) {
    if (existing === Ctor || Object.prototype.isPrototypeOf.call(Ctor.prototype, existing.prototype)) return; // already ours: idempotent
    throw new Error(`<${tag}> is already defined by another element class`);
  }
  let set = used.get(registry);
  if (!set) used.set(registry, (set = new Set()));
  if (!set.has(Ctor)) {
    registry.define(tag, Ctor);
    set.add(Ctor);
  } else {
    registry.define(tag, class extends (Ctor as typeof HTMLElement) {});
  }
}

/**
 * Registers `<opal42-gradient-score>` and `<opal42-gradient-preview>`. Safe to
 * call any number of times (a tag that already holds these classes is left
 * alone), safe under Node (returns `defined: false`), and the tag names can be
 * overridden. Throws only when a tag name is taken by an unrelated element.
 */
export function defineElements(options: DefineOptions = {}): DefineResult {
  const scoreTag = options.scoreTag ?? SCORE_TAG;
  const previewTag = options.previewTag ?? PREVIEW_TAG;
  const registry = options.registry ?? (typeof customElements === "undefined" ? undefined : customElements);
  if (!registry || typeof HTMLElement === "undefined") return { scoreTag, previewTag, defined: false };
  defineOne(registry, scoreTag, Opal42GradientScoreElement);
  defineOne(registry, previewTag, Opal42GradientPreviewElement);
  return { scoreTag, previewTag, defined: true };
}
