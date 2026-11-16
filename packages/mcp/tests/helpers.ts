import { callTool, type ToolResult } from "../src/handlers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

/** The structured content of a successful result (fails the test run if there is none). */
export function sc(result: ToolResult): Json {
  if (result.isError) throw new Error(`tool returned an error: ${JSON.stringify(result.content)}`);
  if (!result.structuredContent) throw new Error("no structuredContent");
  return result.structuredContent;
}

export const errorText = (r: ToolResult): string => (r.content[0] as { text: string }).text;

export const score = (args: unknown) => callTool("score_gradient", args);
export const refine = (args: unknown) => callTool("refine_gradient", args);
export const complement = (args: unknown) => callTool("complement", args);
export const preview = (args: unknown) => callTool("render_preview", args);

export const RGB_CSS = "a{background:linear-gradient(90deg,#ff0000,#00ff00 50%,#0000ff)}";
export const SMOOTH_CSS = "linear-gradient(135deg, #1e3a8a 0%, #3b82f6 50%, #bfdbfe 100%)";
