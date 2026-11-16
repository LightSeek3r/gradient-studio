// Response helpers shared by every route: security headers on all responses,
// JSON-RPC error bodies, CORS (off unless an allow-list is configured).

/** Applied to every response, including errors and the status page. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-frame-options": "DENY",
  "cross-origin-resource-policy": "same-origin",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "strict-transport-security": "max-age=31536000",
  "x-robots-tag": "noindex",
});

/** JSON-RPC 2.0 error codes used here. */
export const RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_ALLOWED: -32000,
  INTERNAL_ERROR: -32603,
} as const;

/** Adds the security headers (overwriting) and drops anything that could set a cookie. */
export function withSecurityHeaders(headers: Headers): Headers {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  headers.delete("set-cookie");
  headers.delete("set-cookie2");
  return headers;
}

/** A JSON-RPC error response. `message` is a fixed string, never request content. */
export function rpcError(status: number, code: number, message: string, extra?: Record<string, string>): Response {
  const headers = withSecurityHeaders(new Headers({ "content-type": "application/json; charset=utf-8", ...extra }));
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code, message } }), { status, headers });
}

export function textResponse(body: string, contentType: string, status = 200, head = false, extra?: Record<string, string>): Response {
  const headers = withSecurityHeaders(new Headers({ "content-type": contentType, ...extra }));
  return new Response(head ? null : body, { status, headers });
}

// ── CORS ──────────────────────────────────────────────────────────────────────

/**
 * The exact origins in `CORS_ALLOWED_ORIGINS` (comma separated). Empty or unset
 * means none. `*` and anything that is not a bare http(s) origin is ignored.
 */
export function parseAllowedOrigins(value: unknown, max: number): ReadonlySet<string> {
  if (typeof value !== "string") return new Set();
  const out = new Set<string>();
  for (const raw of value.split(",")) {
    const o = raw.trim();
    if (o === "" || out.size >= max) continue;
    try {
      const u = new URL(o);
      if ((u.protocol === "https:" || u.protocol === "http:") && u.origin === o) out.add(o);
    } catch {
      // not a URL: ignored
    }
  }
  return out;
}

const CORS_ALLOW_HEADERS = "content-type, accept, mcp-protocol-version, mcp-method, mcp-name";

/** CORS headers for an allow-listed origin. */
export function corsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": CORS_ALLOW_HEADERS,
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

/** The media type of a Content-Type header value, lower-cased, without parameters. */
export function mediaType(value: string | null): string {
  return (value ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}
