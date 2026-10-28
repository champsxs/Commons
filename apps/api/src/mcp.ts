import type { FastifyInstance } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createCommonsMcpServer } from "@commons/mcp/tools";
import { Commons } from "@commons/cli/client";
import { config } from "./config.ts";
import { HttpError } from "./util/errors.ts";

/**
 * Remote MCP over HTTP, so agents can connect by URL:
 *   claude mcp add --transport http commons http://localhost:4000/mcp --header "Authorization: Bearer cmn_..."
 * Stateless: every request builds a fresh server whose tools call this API with the caller's own
 * token, so scopes and row-level security apply exactly as they do for the CLI.
 */
export function registerMcpRoute(app: FastifyInstance) {
  app.post("/mcp", async (req, reply) => {
    const a = req.auth;
    if (!a || a.kind !== "token") {
      throw new HttpError(401, "Connect with an API token: add the header Authorization: Bearer cmn_... (create one under Settings → API tokens)");
    }
    const token = String(req.headers.authorization).slice(7).trim();
    const client = `mcp-http${a.client && a.client !== "web" ? `:${a.client}` : ""}`;
    // Call back into this same API instance (whatever port it listens on)
    const port = req.socket.localPort ?? config.apiPort;
    const server = createCommonsMcpServer(async () => new Commons({ url: `http://127.0.0.1:${port}`, token }, client));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });

  // Stateless servers have no event stream to resume or session to end
  const notAllowed = async (_req: unknown, reply: any) =>
    reply.status(405).header("allow", "POST").send({ jsonrpc: "2.0", error: { code: -32000, message: "Use POST for MCP requests" }, id: null });
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);
}
