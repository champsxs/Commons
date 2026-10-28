import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Commons } from "@commons/cli/client";
import { createCommonsMcpServer } from "./tools.ts";

/**
 * Local MCP server for Claude Code, Codex and other agents, started by the agent over stdio.
 * Uses the same sign-in as the commons CLI (~/.commons/config.json, or COMMONS_URL + COMMONS_TOKEN).
 */
let commons: Commons | undefined;
const server = createCommonsMcpServer(async () => (commons ??= await Commons.connect("mcp")));
await server.connect(new StdioServerTransport());
