// Programmatic entry. Not covered by semver before 1.0. The SDK-free handlers
// are also available as "@opal42/mcp/handlers".
export { createServer, serve } from "./server";
export { TOOLS, callTool, SCORE_NOTE, SERVER_INSTRUCTIONS, SERVER_NAME } from "./handlers";
export type { ToolDefinition, ToolResult, ContentBlock } from "./handlers";
