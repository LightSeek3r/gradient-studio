// The installed app's "Import CSS" shortcut (site.webmanifest) opens
// `/?action=import`. Pure helpers so the URL handling is testable.

/** Does this `location.search` ask for the import dialog? */
export function wantsImportDialog(search: string): boolean {
  return new URLSearchParams(search).get("action") === "import";
}

/** The same URL without the one-shot `action` parameter (hash and other params kept). */
export function withoutLaunchAction(href: string): string {
  const url = new URL(href);
  url.searchParams.delete("action");
  return url.pathname + url.search + url.hash;
}
