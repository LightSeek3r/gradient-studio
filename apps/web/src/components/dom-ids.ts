/** DOM id of a stop's hex field (the stop bar's Enter key focuses it). */
export function stopHexFieldId(id: number): string {
  return `stop-${id}-hex`;
}

/** DOM id of a stop's editor card (chips and the bar move focus to it). */
export function stopCardId(id: number): string {
  return `stop-card-${id}`;
}

/** DOM id of a ledger row's toggle button (the issue lane moves focus to it). */
export function ledgerToggleId(code: string): string {
  return `ledger-${code.replace(/[^a-z0-9]+/gi, "-")}`;
}
