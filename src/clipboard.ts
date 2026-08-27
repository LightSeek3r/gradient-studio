// ── Clipboard ─────────────────────────────────────────────────────────────────
// The async Clipboard API needs a secure context and, for reads, a permission
// grant — both of which can fail. Every entry point resolves rather than throws
// so callers can just show a failure flash.

export async function readClipboardText(): Promise<string | null> {
  try {
    if (navigator.clipboard?.readText) return await navigator.clipboard.readText();
  } catch {
    // Denied, unsupported, or non-secure context.
  }
  return null;
}

export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy selection-based path.
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
