import { handleRequest, type Env } from "../src/worker";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export const ORIGIN = "https://mcp.test";
export const MODERN = "2026-07-28";

export const META = {
  "io.modelcontextprotocol/protocolVersion": MODERN,
  "io.modelcontextprotocol/clientInfo": { name: "opal42-worker-tests", version: "0.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

export const RGB_CSS = "a{background:linear-gradient(90deg,#ff0000,#00ff00 50%,#0000ff)}";

const JSON_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };

export function req(path: string, init: RequestInit = {}): Request {
  return new Request(`${ORIGIN}${path}`, init);
}

export function send(path: string, init: RequestInit = {}, env: Env = {}): Promise<Response> {
  return handleRequest(req(path, init), env);
}

/** A 2026-07-28 request: no initialize; version in `_meta` and in the header. */
export function modernInit(method: string, params: Record<string, unknown> = {}, id: number | string = 1, extra: Record<string, string> = {}): RequestInit {
  const name: Record<string, string> = typeof params.name === "string" ? { "mcp-name": params.name } : {};
  return {
    method: "POST",
    headers: { ...JSON_HEADERS, "mcp-protocol-version": MODERN, "mcp-method": method, ...name, ...extra },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params: { ...params, _meta: META } }),
  };
}

export async function modern(method: string, params: Record<string, unknown> = {}, env: Env = {}): Promise<{ res: Response; body: Json }> {
  const res = await send("/mcp", modernInit(method, params), env);
  return { res, body: await res.json() };
}

export const callTool = (name: string, args: unknown, env: Env = {}) => modern("tools/call", { name, arguments: args }, env);

export function postRaw(body: BodyInit | null, headers: Record<string, string> = JSON_HEADERS, env: Env = {}): Promise<Response> {
  return send("/mcp", { method: "POST", headers, body }, env);
}

export function postJson(value: unknown, headers: Record<string, string> = JSON_HEADERS, env: Env = {}): Promise<Response> {
  return postRaw(JSON.stringify(value), headers, env);
}

export { JSON_HEADERS };
