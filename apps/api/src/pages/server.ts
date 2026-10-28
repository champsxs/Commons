import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { config } from "../config.ts";
import { pool } from "../db/pool.ts";
import { getObject } from "./storage.ts";
import { runtimeDist } from "./paths.ts";
import { RUNTIME_MODULES } from "./runtime.ts";

/**
 * The page origin. Page code runs here, in a sandboxed iframe on a different origin from the app,
 * so it can't touch the app's cookies or DOM. It can only load the shared runtime and its own
 * bundle, and talk to Commons through the GraphQL proxy below using a short-lived page token.
 */
export async function buildPagesServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  const origin = config.pagesOrigin;
  const apiBase = `http://127.0.0.1:${config.apiPort}`;

  const importMap = JSON.stringify({
    imports: Object.fromEntries(Object.entries(RUNTIME_MODULES).map(([spec, file]) => [spec, `${origin}/runtime/${file}`])),
  });
  const importMapHash = createHash("sha256").update(importMap).digest("base64");
  const csp = [
    "default-src 'none'",
    `script-src ${origin} 'sha256-${importMapHash}'`,
    `style-src ${origin} 'unsafe-inline'`,
    `connect-src ${origin}`,
    `img-src ${origin} data: blob:`,
    `font-src ${origin}`,
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${config.webOrigin}`,
  ].join("; ");

  // Sandboxed frames have an opaque ("null") origin, so every response needs open CORS.
  // That's safe: nothing here uses cookies; data requests carry a bearer page token.
  app.addHook("onSend", async (_req, reply) => {
    reply.header("access-control-allow-origin", "*");
    reply.header("x-content-type-options", "nosniff");
  });
  app.options("/*", async (_req, reply) => {
    reply.header("access-control-allow-headers", "authorization, content-type");
    reply.header("access-control-allow-methods", "GET, POST, OPTIONS");
    reply.header("access-control-max-age", "600");
    return reply.status(204).send();
  });

  app.get("/p/:versionId/", async (req, reply) => {
    const { versionId } = req.params as { versionId: string };
    if (!/^[0-9a-f-]{36}$/.test(versionId)) return reply.status(404).send("Not found");
    reply.header("content-security-policy", csp);
    reply.header("referrer-policy", "no-referrer");
    reply.type("text/html");
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script type="importmap">${importMap}</script>
<script type="module" src="${origin}/runtime/boot.js"></script>
</head>
<body><div id="root"></div></body>
</html>`;
  });

  app.get("/runtime/*", async (req, reply) => {
    const rel = normalize((req.params as any)["*"]).replace(/^(\.\.[/\\])+/, "");
    if (!/^[\w./-]+\.js$/.test(rel)) return reply.status(404).send("Not found");
    try {
      const body = await readFile(join(runtimeDist, rel));
      reply.type("text/javascript");
      reply.header("cache-control", rel.startsWith("chunks/") ? "public, max-age=31536000, immutable" : "no-cache");
      return body;
    } catch {
      return reply.status(404).send("Not found");
    }
  });

  app.get("/bundles/:versionId/:file", async (req, reply) => {
    const { versionId, file } = req.params as { versionId: string; file: string };
    if (!/^[0-9a-f-]{36}$/.test(versionId) || !["page.js", "page.css"].includes(file)) return reply.status(404).send("Not found");
    const { rows } = await pool.query("select status from commons.page_versions where id = $1", [versionId]);
    if (rows[0]?.status !== "ready") return reply.status(404).send("Not found");
    const body = await getObject(`pages/${versionId}/${file}`);
    if (!body) return reply.status(404).send("Not found");
    reply.type(file.endsWith(".js") ? "text/javascript" : "text/css");
    // Versions never change once built
    reply.header("cache-control", "public, max-age=31536000, immutable");
    return body;
  });

  const forward = async (reply: FastifyReply, url: string, init: RequestInit) => {
    const res = await fetch(url, init);
    reply.status(res.status);
    reply.type(res.headers.get("content-type") ?? "application/json");
    return Buffer.from(await res.arrayBuffer());
  };

  app.post("/graphql", async (req, reply) =>
    forward(reply, `${apiBase}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: String(req.headers.authorization ?? ""), "x-commons-client": "page" },
      body: JSON.stringify(req.body),
    }),
  );

  app.get("/registry/datasets/:slug", async (req, reply) =>
    forward(reply, `${apiBase}/api/registry/datasets/${encodeURIComponent((req.params as any).slug)}`, {
      headers: { authorization: String(req.headers.authorization ?? "") },
    }),
  );

  return app;
}
