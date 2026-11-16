// The stdio MCP server: the handlers of handlers.ts registered on the official
// SDK (@modelcontextprotocol/server v2, MCP spec revision 2026-07-28).
//
// Stateless: `createServer` builds a fresh McpServer per connection and nothing
// is kept between requests. serveStdio (stdio.ts of the SDK) accepts both the
// 2026-07-28 opening (no `initialize`; the protocol version travels in each
// request's `_meta`) and the older `initialize` handshake.

import { McpServer, fromJsonSchema, type CallToolResult, type JsonSchemaType } from "@modelcontextprotocol/server";
import { serveStdio, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import { SERVER_INSTRUCTIONS, SERVER_NAME, TOOLS, callTool } from "./handlers";

/** A new server with all tools registered. Cheap; call once per connection. */
export function createServer(version: string): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version }, { instructions: SERVER_INSTRUCTIONS });
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: fromJsonSchema(tool.inputSchema as unknown as JsonSchemaType),
        outputSchema: fromJsonSchema(tool.outputSchema as unknown as JsonSchemaType),
        annotations: { ...tool.annotations },
      },
      async (args: unknown): Promise<CallToolResult> => callTool(tool.name, args) as CallToolResult,
    );
  }
  return server;
}

/** Serves the process's stdin/stdout. Resolves to a handle that closes the connection. */
export function serve(version: string): StdioServerHandle {
  return serveStdio(() => createServer(version), {
    onerror: (err) => {
      // stdout carries the protocol; diagnostics go to stderr only.
      process.stderr.write(`opal42-mcp: ${err.message}\n`);
    },
  });
}
