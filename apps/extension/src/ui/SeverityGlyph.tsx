import type { IssueView } from "../lib/analyze";

/**
 * Severity as a shape, not only a colour: a filled diamond (large deduction),
 * a triangle (medium) or a ring (small). Decorative: the points next to it
 * carry the same information as text. Same shapes as the web app.
 */
export function SeverityGlyph({ severity, size = 12 }: { severity: IssueView["severity"]; size?: number }) {
  return (
    <svg className={`sev sev-${severity}`} viewBox="0 0 12 12" width={size} height={size} aria-hidden="true" focusable="false">
      {severity === "error" && <path d="M6 0.6 11.4 6 6 11.4 0.6 6Z" fill="currentColor" />}
      {severity === "warning" && <path d="M6 1.4 11 10.4H1Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />}
      {severity === "info" && <circle cx="6" cy="6" r="3.9" fill="none" stroke="currentColor" strokeWidth="1.8" />}
    </svg>
  );
}
