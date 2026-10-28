import type { FastifyInstance } from "fastify";
import { config } from "../config.ts";
import { asUser, pool } from "../db/pool.ts";
import { requireAuth, signPageToken } from "../auth/auth.ts";
import { HttpError, forbidden } from "../util/errors.ts";
import { getDataset } from "../registry/datasets.ts";
import { describe } from "../http/app.ts";
import { schemaSDL } from "../graphql/schema.ts";
import {
  buildableFiles, createPage, deletePage, getVersion, listPages, listVersions, loadPage, publish, pushVersion, templateFiles, updatePage,
} from "./pages.ts";
import { uiTypes } from "./runtime.ts";

export function registerPageRoutes(app: FastifyInstance) {
  app.get("/api/pages", async (req) => {
    const a = requireAuth(req);
    return asUser(a.userId, (db) => listPages(db, a.userId));
  });

  app.post("/api/pages", async (req, reply) => {
    const a = requireAuth(req, "pages:write");
    const body = req.body as any;
    const page = await asUser(a.userId, (db) => createPage(db, a.userId, body));
    // Optionally start from the starter template so the page has something to show
    if (body.fromTemplate) await pushVersion(a.userId, a.client, page.slug, { files: buildableFiles(await templateFiles()), message: "Starter template", publish: true });
    reply.status(201);
    return asUser(a.userId, (db) => loadPage(db, page.slug, a.userId));
  });

  app.get("/api/pages/:slug", async (req) => {
    const a = requireAuth(req);
    const page = await asUser(a.userId, (db) => loadPage(db, (req.params as any).slug, a.userId));
    const versions = await listVersions(page.id);
    return { ...page, versions: page.canEdit ? versions : versions.filter((v) => v.id === page.publishedVersionId) };
  });

  app.patch("/api/pages/:slug", async (req) => {
    const a = requireAuth(req, "pages:write");
    return asUser(a.userId, (db) => updatePage(db, a.userId, (req.params as any).slug, req.body ?? {}));
  });

  app.delete("/api/pages/:slug", async (req) => {
    const a = requireAuth(req, "pages:write");
    await asUser(a.userId, (db) => deletePage(db, a.userId, (req.params as any).slug));
    return { ok: true };
  });

  app.post("/api/pages/:slug/versions", async (req, reply) => {
    const a = requireAuth(req, "pages:write");
    const result = await pushVersion(a.userId, a.client, (req.params as any).slug, req.body);
    reply.status(result.status === "ready" ? 201 : 422);
    return { ...result, url: `${config.webOrigin}/pages/${(req.params as any).slug}/v/${result.version}` };
  });

  app.get("/api/pages/:slug/versions/:version", async (req) => {
    const a = requireAuth(req);
    const { slug, version } = req.params as any;
    const page = await asUser(a.userId, (db) => loadPage(db, slug, a.userId));
    const v = await getVersion(page.id, Number(version));
    if (!page.canEdit && v.id !== page.publishedVersionId) throw forbidden();
    return v;
  });

  app.post("/api/pages/:slug/publish", async (req) => {
    const a = requireAuth(req, "pages:write");
    return publish(a.userId, (req.params as any).slug, Number((req.body as any).version));
  });

  /** Issues the short-lived token and URL the app uses to show a page in its sandboxed iframe. */
  app.post("/api/pages/:slug/view", async (req) => {
    const a = requireAuth(req);
    const { slug } = req.params as any;
    const version = (req.body as any)?.version;
    const page = await asUser(a.userId, (db) => loadPage(db, slug, a.userId));
    let versionId = page.publishedVersionId;
    if (version !== undefined && version !== null) {
      const { rows } = await pool.query("select id, status from commons.page_versions where page_id = $1 and version = $2", [page.id, Number(version)]);
      if (!rows[0]) throw new HttpError(404, `No version ${version}`);
      if (rows[0].id !== page.publishedVersionId && !page.canEdit) throw forbidden("Only editors can preview unpublished versions");
      if (rows[0].status !== "ready") throw new HttpError(409, `Version ${version} didn't build`);
      versionId = rows[0].id;
    }
    if (!versionId) throw new HttpError(404, "This page hasn't been published yet");
    const token = await signPageToken(a.userId, page.id, page.allowWrites);
    return { versionId, token, origin: config.pagesOrigin, url: `${config.pagesOrigin}/p/${versionId}/` };
  });

  /** Dataset definitions for page code (RecordView, RecordForm...). Page tokens may use this. */
  app.get("/api/registry/datasets/:slug", async (req) => {
    const a = req.auth;
    if (!a) throw new HttpError(401, "Sign in first");
    return asUser(a.userId, async (db) => describe(db, await getDataset(db, (req.params as any).slug)));
  });

  /** Everything a local coding agent needs: UI kit types, the GraphQL schema and the starter template. */
  app.get("/api/sdk", async (req) => {
    requireAuth(req);
    return { types: await uiTypes(), schema: schemaSDL(), template: await templateFiles(), webOrigin: config.webOrigin };
  });
}
