import type { ScanStats } from "./scan-runner";

/** Plain-language notices for everything the scan could not cover. */
export function scanNotices(stats: ScanStats | null, droppedGroups: number): string[] {
  if (!stats) return [];
  const notices: string[] = [];
  if (stats.elementCapReached) {
    notices.push(
      `This page has ${stats.elementsTotal.toLocaleString("en")} elements. Only the first ${stats.elementsScanned.toLocaleString("en")} were examined, so gradients on later elements are missing.`,
    );
  }
  const cross = stats.sheetsSkipped.filter((s) => s.reason === "cross-origin");
  if (cross.length > 0) {
    const names = cross.slice(0, 3).map((s) => s.label);
    notices.push(
      `${cross.length} cross-origin ${cross.length === 1 ? "stylesheet was" : "stylesheets were"} not readable (${names.join(", ")}${cross.length > 3 ? ", …" : ""}). Gradients they define still appear when an element uses them.`,
    );
  }
  const failed = stats.sheetsSkipped.filter((s) => s.reason === "error");
  if (failed.length > 0) notices.push(`${failed.length} ${failed.length === 1 ? "stylesheet" : "stylesheets"} could not be read.`);
  if (stats.sheetCapReached) notices.push("The page has more stylesheets than the panel reads; the rest were left out.");
  if (stats.sheetsCapped > 0) notices.push(`${stats.sheetsCapped} ${stats.sheetsCapped === 1 ? "stylesheet is" : "stylesheets are"} so long that only its first rules were read.`);
  if (stats.hitCapReached) notices.push("The page has a very large number of gradient declarations; collection stopped early.");
  if (stats.truncatedValues > 0) notices.push(`${stats.truncatedValues} very long ${stats.truncatedValues === 1 ? "value was" : "values were"} cut short and not parsed.`);
  if (droppedGroups > 0) notices.push(`${droppedGroups} further distinct ${droppedGroups === 1 ? "gradient is" : "gradients are"} not listed (limit reached).`);
  if (stats.readyState === "loading") notices.push("The page was still loading; the panel will scan again shortly.");
  return notices;
}
