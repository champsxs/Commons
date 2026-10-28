import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { ZodError } from "zod";
import { config } from "../config.ts";
import { asUser, pool } from "../db/pool.ts";
import { HttpError, badRequest } from "../util/errors.ts";
import { authenticate, createApiToken, requireAuth, setSessionCookie, signSession, SESSION_COOKIE } from "../auth/auth.ts";
import { mountGraphql, rebuildSchema, schemaSDL, graphqlNames } from "../graphql/schema.ts";
import { registerGraphqlGuard } from "../graphql/guard.ts";
import {
  addField, createDataset, deleteDataset, dropField, getDataset, listDatasets, updateDataset, updateField, usage,
} from "../registry/datasets.ts";
import type { Dataset } from "../registry/model.ts";
import { search, suggest } from "../registry/search.ts";
import { inferFields, parseFile } from "../ingest/parse.ts";
import { ingest } from "../ingest/ingest.ts";

export function withGraphql(ds: Dataset) {
  return {
    ...ds,
    graphql: graphqlNames(
      ds.typeName,
      ds.fields.map((f) => ({ name: f.name, column: f.column, reference: f.type === "reference" })),
    ),
  };
}

async function readUpload(req: any): Promise<{ buf: Buffer; filename: string; fields: Record<string, string> }> {
  const fields: Record<string, string> = {};
  let buf: Buffer | undefined;
  let filename = "";
  for await (const part of req.parts()) {
    if (part.type === "file") {
      buf = await part.toBuffer();
      filename = part.filename;
    } else fields[part.fieldname] = String(part.value);
  }
  if (!buf) throw badRequest("No file uploaded");
  return { buf, filename, fields };
}

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  await app.register(cors, { origin: [config.webOrigin, config.pagesOrigin], credentials: true });
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

  app.addHook("onRequest", async (req) => {
    req.auth = (await authenticate(req)) ?? undefined;
  });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message, details: err.details });
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "), details: err.issues });
    }
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.message });
    app.log.error(err);
    return reply.status(500).send({ error: "Something went wrong on our side" });
  });

  registerGraphqlGuard(app);
  await mountGraphql(app);

  // ---- Auth ----
  app.get("/api/auth/dev-users", async () => {
    if (!config.devLogin) throw new HttpError(404, "Not found");
    const { rows } = await pool.query("select id, email, name, is_admin from commons.users order by name");
    return rows;
  });

  app.post("/api/auth/dev-login", async (req, reply) => {
    if (!config.devLogin) throw new HttpError(404, "Not found");
    const { email } = req.body as { email: string };
    const { rows } = await pool.query("select id from commons.users where email = $1", [email]);
    if (!rows[0]) throw badRequest("No such user");
    setSessionCookie(reply, await signSession(rows[0].id));
    return { ok: true };
  });

  /** Dev-only shortcut so the CLI and agents can get a token without the web app. */
  app.post("/api/auth/dev-token", async (req) => {
    if (!config.devLogin) throw new HttpError(404, "Not found");
    const { email, name } = req.body as { email: string; name?: string };
    const { rows } = await pool.query("select id from commons.users where email = $1", [email]);
    if (!rows[0]) throw badRequest("No such user");
    return createApiToken(rows[0].id, name ?? "CLI", ["data:read", "pages:write"]);
  });

  app.post("/api/auth/logout", async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/me", async (req) => {
    const a = requireAuth(req);
    const { rows } = await pool.query(
      `select u.id, u.email, u.name, u.is_admin,
              coalesce(json_agg(json_build_object('id', t.id, 'slug', t.slug, 'name', t.name)) filter (where t.id is not null), '[]') as teams
       from commons.users u
       left join commons.team_members m on m.user_id = u.id
       left join commons.teams t on t.id = m.team_id
       where u.id = $1 group by u.id`,
      [a.userId],
    );
    return { ...rows[0], client: a.client, scopes: a.scopes };
  });

  app.get("/api/tokens", async (req) => {
    const a = requireAuth(req);
    const { rows } = await pool.query(
      "select id, name, scopes, expires_at, last_used_at, created_at from commons.api_tokens where user_id = $1 order by created_at desc",
      [a.userId],
    );
    return rows;
  });

  app.post("/api/tokens", async (req) => {
    const a = requireAuth(req);
    if (a.kind !== "session") throw new HttpError(403, "Create tokens from the web app");
    const { name, scopes, days } = req.body as { name: string; scopes?: string[]; days?: number };
    const allowed = ["data:read", "data:write", "datasets:write", "pages:write"];
    const s = (scopes ?? ["data:read", "pages:write"]).filter((x) => allowed.includes(x));
    return createApiToken(a.userId, name || "Token", s, days ?? 90);
  });

  app.delete("/api/tokens/:id", async (req) => {
    const a = requireAuth(req);
    await pool.query("delete from commons.api_tokens where id = $1 and user_id = $2", [(req.params as any).id, a.userId]);
    return { ok: true };
  });

  app.get("/api/teams", async (req) => {
    requireAuth(req);
    const { rows } = await pool.query("select id, slug, name from commons.teams order by name");
    return rows;
  });

  app.get("/api/users", async (req) => {
    requireAuth(req);
    const { rows } = await pool.query("select id, name, email from commons.users order by name");
    return rows;
  });

  // ---- Registry ----
  app.get("/api/search", async (req) => {
    const a = requireAuth(req);
    return asUser(a.userId, (db) => search(db, String((req.query as any).q ?? "")));
  });

  app.get("/api/datasets", async (req) => {
    const a = requireAuth(req);
    return asUser(a.userId, (db) => listDatasets(db));
  });

  app.post("/api/datasets/suggest", async (req) => {
    const a = requireAuth(req);
    return asUser(a.userId, (db) => suggest(db, req.body));
  });

  app.post("/api/datasets", async (req, reply) => {
    const a = requireAuth(req, "datasets:write");
    const ds = await asUser(a.userId, (db) => createDataset(db, a.userId, req.body));
    await rebuildSchema();
    reply.status(201);
    return withGraphql(ds);
  });

  app.get("/api/datasets/:slug", async (req) => {
    const a = requireAuth(req);
    const { slug } = req.params as { slug: string };
    return asUser(a.userId, async (db) => {
      const ds = await getDataset(db, slug);
      const { rows } = await db.query("select commons.row_count($1) as n", [ds.slug]);
      return { ...withGraphql(ds), rowCount: Number(rows[0].n) };
    });
  });

  app.patch("/api/datasets/:slug", async (req) => {
    const a = requireAuth(req, "datasets:write");
    const ds = await asUser(a.userId, (db) => updateDataset(db, a.userId, (req.params as any).slug, req.body ?? {}));
    return withGraphql(ds);
  });

  app.delete("/api/datasets/:slug", async (req) => {
    const a = requireAuth(req, "datasets:write");
    const force = (req.query as any).force === "true";
    await asUser(a.userId, (db) => deleteDataset(db, a.userId, (req.params as any).slug, force));
    await rebuildSchema();
    return { ok: true };
  });

  app.get("/api/datasets/:slug/usage", async (req) => {
    const a = requireAuth(req);
    return asUser(a.userId, async (db) => usage(db, (await getDataset(db, (req.params as any).slug)).id));
  });

  app.post("/api/datasets/:slug/fields", async (req, reply) => {
    const a = requireAuth(req, "datasets:write");
    const ds = await asUser(a.userId, (db) => addField(db, a.userId, (req.params as any).slug, req.body));
    await rebuildSchema();
    reply.status(201);
    return withGraphql(ds);
  });

  app.patch("/api/datasets/:slug/fields/:name", async (req) => {
    const a = requireAuth(req, "datasets:write");
    const { slug, name } = req.params as any;
    const ds = await asUser(a.userId, (db) => updateField(db, a.userId, slug, name, req.body ?? {}));
    await rebuildSchema();
    return withGraphql(ds);
  });

  app.delete("/api/datasets/:slug/fields/:name", async (req) => {
    const a = requireAuth(req, "datasets:write");
    const { slug, name } = req.params as any;
    const ds = await asUser(a.userId, (db) => dropField(db, a.userId, slug, name, (req.query as any).force === "true"));
    await rebuildSchema();
    return withGraphql(ds);
  });

  // ---- Ingest ----
  app.post("/api/infer", async (req) => {
    const a = requireAuth(req);
    const { buf, filename } = await readUpload(req);
    const rows = parseFile(buf, filename);
    const fields = inferFields(rows);
    const hints = await asUser(a.userId, (db) =>
      suggest(db, { name: filename.replace(/\.[^.]+$/, ""), fields: fields.map((f) => ({ name: f.name, type: f.type })) }),
    );
    const keyField =
      fields.find((f) => f.unique && f.required && /(code|key|sku|_id|number)$/.test(f.name))?.name ??
      fields.find((f) => f.unique && f.required && f.type !== "number")?.name ??
      null;
    return { rowCount: rows.length, fields, keyField, sample: rows.slice(0, 5), suggestions: hints };
  });

  app.post("/api/datasets/:slug/ingest", async (req) => {
    const a = requireAuth(req, "datasets:write");
    const { buf, filename, fields } = await readUpload(req);
    const rows = parseFile(buf, filename);
    const opts = {
      mode: fields.mode,
      onError: fields.onError,
      unresolved: fields.unresolved || undefined,
      dryRun: fields.dryRun === "true",
    };
    return asUser(a.userId, (db) => ingest(db, a.userId, (req.params as any).slug, rows, opts, filename));
  });

  app.get("/api/datasets/:slug/ingests", async (req) => {
    const a = requireAuth(req);
    return asUser(a.userId, async (db) => {
      const ds = await getDataset(db, (req.params as any).slug);
      const { rows } = await db.query(
        `select r.id, r.filename, r.mode, r.status, r.rows_total, r.rows_inserted, r.rows_skipped, r.report, r.created_at, u.name as user_name
         from commons.ingest_runs r join commons.users u on u.id = r.user_id
         where r.dataset_id = $1 order by r.created_at desc limit 50`,
        [ds.id],
      );
      return rows;
    });
  });

  // ---- For agents and tools ----
  app.get("/api/graphql/schema.graphql", async (req, reply) => {
    requireAuth(req);
    reply.type("text/plain");
    return schemaSDL();
  });

  app.get("/api/health", async () => ({ ok: true }));

  return app;
}
