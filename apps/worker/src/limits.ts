// Request limits of the Worker. The tool handlers (@opal42/mcp/handlers) have
// their own, tighter per-argument caps (20,000 css characters, 32 gradients,
// 32 stops, ...); these protect the layers in front of them.

/** Largest accepted POST body, in bytes. 20,000 css characters plus JSON framing fit with room to spare. */
export const MAX_BODY_BYTES = 32 * 1024;

/** Wall-clock budget for one request, in milliseconds. A guard against a hung stream, not a CPU limit. */
export const REQUEST_TIMEOUT_MS = 8_000;

/** Longest `CORS_ALLOWED_ORIGINS` list honoured, so a mis-set var cannot make header handling expensive. */
export const MAX_ALLOWED_ORIGINS = 16;

// ── CPU guards ────────────────────────────────────────────────────────────────
// Measured in Node (`npm run bench`, docs/worker.md): scoring costs ~0.015 ms per
// stop, so the handlers' maximum (32 gradients x 32 stops) takes 10-15 ms, over
// the Workers Free plan's 10 ms CPU limit. refine_gradient is far heavier: ~6 ms
// for a 2-stop gradient and ~190 ms for 32 stops. These caps, on the total number
// of stops in one request, keep the work bounded. They are tighter than the
// handlers' own caps and apply before any scoring happens.

/** score_gradient and render_preview: total stops across all gradients in one request (about 1.5-3 ms in Node). */
export const MAX_STOPS_PER_REQUEST = 128;

/** refine_gradient default when `REFINE_MAX_STOPS` is unset. Free-plan setting: 8 (see wrangler.jsonc). 0 disables the tool. */
export const DEFAULT_REFINE_MAX_STOPS = 16;
