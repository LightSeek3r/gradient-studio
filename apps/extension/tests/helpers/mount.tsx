import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

export async function mount(node: React.ReactElement): Promise<HTMLElement> {
  host = document.createElement("div");
  host.id = "test-host";
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

export async function unmount(): Promise<void> {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
}

/** Let timers and promises run inside act until `predicate` holds (or fail after `ms`). */
export async function waitFor(predicate: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("waitFor timed out");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
  }
}

export async function click(el: Element | null): Promise<void> {
  if (!el) throw new Error("element to click not found");
  await act(async () => {
    (el as HTMLElement).click();
  });
}

export function byText<T extends Element = HTMLElement>(container: ParentNode, selector: string, text: string | RegExp): T | null {
  for (const el of container.querySelectorAll<T>(selector)) {
    const t = el.textContent ?? "";
    if (typeof text === "string" ? t.includes(text) : text.test(t)) return el;
  }
  return null;
}
