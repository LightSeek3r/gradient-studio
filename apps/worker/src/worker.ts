// A stateless Cloudflare Worker serving the opal42 gradient MCP tools over
// Streamable HTTP at /mcp.
//
// The protocol is handled by the official SDK's fetch handler
// (`createMcpHandler` from @modelcontextprotocol/server 2.x: MCP revision
// 2026-07-28 with no `initialize`, plus the SDK's stateless fallback for 2025
// clients). Everything around it is ours: routing, the body cap, method and
// content-type gating, Origin/CORS, security headers, the request timeout and
// the guarantee that nothing throws. The tools are the transport-independent
// handlers of @opal42/mcp, so scoring logic lives only in the core.
//
// No storage, no secrets, no logging, no cookies. `onerror` callbacks are
// no-ops on purpose: request content must not reach any log.

import { McpServer, createMcpHandler, fromJsonSchema, type CallToolResult, type JsonSchemaType } from "@modelcontextprotocol/server";
import { SERVER_INSTRUCTIONS, SERVER_NAME, TOOLS, callTool } from "@opal42/mcp/handlers";
import { readCapped } from "./body";
import { overBudget, parseBudget, type Budget } from "./guard";
import { RPC, corsHeaders, mediaType, parseAllowedOrigins, rpcError, textResponse, withSecurityHeaders } from "./http";
import { MAX_ALLOWED_ORIGINS, MAX_BODY_BYTES, REQUEST_TIMEOUT_MS } from "./limits";
import { statusPage } from "./status";

export const WORKER_VERSION = "0.0.0";

export interface Env {
  /** Comma-separated exact origins allowed to call /mcp from a browser. Unset or empty: CORS off. */
  CORS_ALLOWED_ORIGINS?: string;
  /** Total stops one refine_gradient request may contain (default 16; 3 fits the Free plan's 10 ms CPU; 0 disables the tool). */
  REFINE_MAX_STOPS?: string;
}

// The shared handlers describe themselves for the local stdio server ("stateless
// and local"). That is wrong for a hosted endpoint (PLAN D4), so the Worker words
// it itself and strips the local-only phrases from the tool descriptions.
export const HOSTED_INSTRUCTIONS =
  SERVER_INSTRUCTIONS.replace(/\s*All tools are stateless and local[^.]*\.?\s*$/, "") +
  " This is a hosted endpoint: requests leave your device. It is stateless (no storage, no request-body logging, no cookies); Cloudflare, as processor, still sees IP addresses.";

export const hostedDescription = (d: string): string => d.replace(/\s*Read-only and local\./, " Read-only.");

/** A fresh server per request (the handler does this anyway); nothing is shared between requests. */
function createServer(budget: Budget): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: WORKER_VERSION }, { instructions: HOSTED_INSTRUCTIONS });
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: hostedDescription(tool.description),
        inputSchema: fromJsonSchema(tool.inputSchema as unknown as JsonSchemaType),
        outputSchema: fromJsonSchema(tool.outputSchema as unknown as JsonSchemaType),
        annotations: { ...tool.annotations },
      },
      async (args: unknown): Promise<CallToolResult> => {
        // CPU guard first: refuse heavy requests before any scoring runs.
        const refusal = overBudget(tool.name, args, budget);
        if (refusal !== null) return { content: [{ type: "text", text: `Error: ${refusal}` }], isError: true };
        return callTool(tool.name, args) as CallToolResult;
      },
    );
  }
  return server;
}

/** Built per request: the CPU budget comes from this request's env, nothing is shared between requests. */
function mcpHandler(budget: Budget) {
  return createMcpHandler(() => createServer(budget), {
    // 2025-era clients (initialize handshake) are served statelessly by the SDK.
    legacy: "stateless",
    // responseMode stays "auto": a single JSON body unless a tool emits a related
    // message first, which none of these tools does. ("json" makes the SDK log a warning.)
    maxRequestBodySize: MAX_BODY_BYTES,
    onerror: () => {
      // Intentionally empty: errors can carry request content; nothing is logged.
    },
  });
}

const TOOL_NAMES = TOOLS.map((t) => t.name);
const KNOWN_TOOLS: ReadonlySet<string> = new Set(TOOL_NAMES);
const MAX_ID_CHARS = 128;
const MAX_METHOD_CHARS = 128;

/**
 * Checks the parts of a request that the SDK would echo back in an error: the
 * JSON-RPC id, the method and the tool name. Anything odd gets a fixed message
 * here instead, so error bodies stay small and contain no request text.
 */
function precheck(msg: Record<string, unknown>, cors: Record<string, string> | undefined): Response | null {
  const id = msg.id;
  const idOk = id === undefined || (typeof id === "string" && id.length <= MAX_ID_CHARS) || (typeof id === "number" && Number.isFinite(id));
  if (!idOk) return rpcError(400, RPC.INVALID_REQUEST, "Invalid Request: id must be a short string or a number", cors);
  const method = msg.method as string;
  if (method.length > MAX_METHOD_CHARS) return rpcError(400, RPC.INVALID_REQUEST, "Invalid Request: method too long", cors);
  if (method === "tools/call") {
    const params = msg.params;
    const name = typeof params === "object" && params !== null ? (params as Record<string, unknown>).name : undefined;
    if (typeof name !== "string" || !KNOWN_TOOLS.has(name)) {
      const headers = withSecurityHeaders(new Headers({ "content-type": "application/json; charset=utf-8", ...cors }));
      const body = { jsonrpc: "2.0", id: id ?? null, error: { code: -32602, message: `Unknown tool; available: ${TOOL_NAMES.join(", ")}` } };
      return new Response(JSON.stringify(body), { status: 200, headers });
    }
  }
  return null;
}
const NO_ORIGIN_METHODS = "POST, OPTIONS";

function methodNotAllowed(allow: string, head = false): Response {
  if (head) return textResponse("", "text/plain; charset=utf-8", 405, true, { allow });
  return rpcError(405, RPC.METHOD_NOT_ALLOWED, "Method not allowed", { allow });
}

/** Handles POST /mcp after the Origin check. */
async function handleMcp(request: Request, cors: Record<string, string> | null, env: Env): Promise<Response> {
  const extra = cors ?? undefined;
  if (mediaType(request.headers.get("content-type")) !== "application/json") {
    return rpcError(415, RPC.INVALID_REQUEST, "Content-Type must be application/json", extra);
  }
  const encoding = request.headers.get("content-encoding");
  if (encoding !== null && encoding.trim().toLowerCase() !== "identity") {
    return rpcError(415, RPC.INVALID_REQUEST, "Content-Encoding is not supported", extra);
  }

  const body = await readCapped(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return body.reason === "too-large"
      ? rpcError(413, RPC.INVALID_REQUEST, `Request body exceeds ${MAX_BODY_BYTES} bytes`, extra)
      : rpcError(400, RPC.PARSE_ERROR, "Request body could not be read", extra);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    return rpcError(400, RPC.PARSE_ERROR, "Parse error", extra);
  }
  if (Array.isArray(parsed)) return rpcError(400, RPC.INVALID_REQUEST, "Batch requests are not supported", extra);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as Record<string, unknown>).jsonrpc !== "2.0" ||
    typeof (parsed as Record<string, unknown>).method !== "string"
  ) {
    return rpcError(400, RPC.INVALID_REQUEST, "Invalid Request: expected a JSON-RPC 2.0 request or notification", extra);
  }

  const rejected = precheck(parsed as Record<string, unknown>, extra);
  if (rejected) return rejected;

  // The original body stream is consumed: hand the SDK an equivalent request.
  const forward = new Request(request.url, { method: "POST", headers: request.headers, body: body.text });
  const res = await mcpHandler(parseBudget(env.REFINE_MAX_STOPS)).fetch(forward, { parsedBody: parsed });

  const headers = withSecurityHeaders(new Headers(res.headers));
  if (cors) for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.length > 1 && url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  const head = request.method === "HEAD";

  if (path === "/mcp") {
    const origin = request.headers.get("origin");
    let cors: Record<string, string> | null = null;
    if (origin !== null) {
      const allowed = parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS, MAX_ALLOWED_ORIGINS);
      // MCP asks servers to validate Origin (DNS rebinding); CORS is off unless listed.
      if (!allowed.has(origin)) return rpcError(403, RPC.INVALID_REQUEST, "Origin not allowed");
      cors = corsHeaders(origin);
    }
    if (request.method === "OPTIONS") {
      if (!cors) return methodNotAllowed(NO_ORIGIN_METHODS);
      return new Response(null, { status: 204, headers: withSecurityHeaders(new Headers(cors)) });
    }
    if (request.method !== "POST") return methodNotAllowed(NO_ORIGIN_METHODS);
    return handleMcp(request, cors, env);
  }

  if (path === "/healthz") {
    if (request.method !== "GET" && !head) return methodNotAllowed("GET, HEAD");
    return textResponse(JSON.stringify({ status: "ok" }), "application/json; charset=utf-8", 200, head);
  }

  if (path === "/") {
    if (request.method !== "GET" && !head) return methodNotAllowed("GET, HEAD");
    return textResponse(statusPage(TOOL_NAMES, WORKER_VERSION), "text/html; charset=utf-8", 200, head);
  }

  return rpcError(404, RPC.INVALID_REQUEST, "Not found");
}

/** Never rejects: every failure, including a timeout, is a JSON-RPC error response. */
export async function handleRequest(request: Request, env: Env = {}): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Response>((resolve) => {
    timer = setTimeout(() => resolve(rpcError(504, RPC.INTERNAL_ERROR, "Request timed out")), REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([route(request, env ?? {}), timeout]);
  } catch {
    return rpcError(500, RPC.INTERNAL_ERROR, "Internal error");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handleRequest(request, env),
};
