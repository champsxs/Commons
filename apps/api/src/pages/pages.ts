import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { z } from "zod";
import type { Db } from "../db/pool.ts";
import { asUser, pool } from "../db/pool.ts";
import { badRequest, forbidden, notFound } from "../util/errors.ts";
import { audit, checkDepartment } from "../registry/datasets.ts";
import { getSchema, graphqlNames } from "../graphql/schema.ts";
import { columnFor } from "../registry/model.ts";
import { buildPage, formatIssues, type BuildOutput, type TypeMapEntry } from "./build.ts";
import { putObject } from "./storage.ts";
import { templateDir } from "./paths.ts";

export const PageInput = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9-]{1,60}$/, "Use lowercase letters, digits and dashes"),
  title: z.string().min(1),
  description: z.string().default(""),
  visibility: z.enum(["private", "shared", "department", "company"]).default("private"),
  teamId: z.string().uuid().nullish(),
  departmentId: z.string().uuid().nullish(),
});

export const VersionInput = z.object({
  files: z.record(z.string(), z.string()),
  message: z.string().max(500).optional(),
  draft: z.boolean().default(false),
  /** Publish straight away if the build succeeds */
  publish: z.boolean().default(false),
  /** Used when the page doesn't exist yet and is created by this push */
  title: z.string().optional(),
  description: z.string().optional(),
});

async function canEditPage(db: Db, pageId: string, userId: string) {
  const { rows } = await db.query(
    `select exists (
       select 1 from commons.pages p where p.id = $1 and (
         p.owner_id = $2
         or exists (select 1 from commons.users u where u.id = $2 and u.is_admin)
         or exists (select 1 from commons.team_members m where m.team_id = p.team_id and m.user_id = $2))
     ) as ok`,
    [pageId, userId],
  );
  return rows[0].ok as boolean;
}

export async function loadPage(db: Db, slug: string, userId: string) {
  const { rows } = await db.query(
    `select p.*, u.name as owner_name, t.name as team_name, dep.name as department_name, commons.can_view_page(p.id) as can_view,
            v.version as published_version
     from commons.pages p join commons.users u on u.id = p.owner_id left join commons.teams t on t.id = p.team_id
     left join commons.departments dep on dep.id = p.department_id
     left join commons.page_versions v on v.id = p.published_version_id
     where p.slug = $1`,
    [slug],
  );
  const p = rows[0];
  if (!p) throw notFound(`No page "${slug}"`);
  const canEdit = await canEditPage(db, p.id, userId);
  if (!p.can_view && !canEdit) throw forbidden();
  return {
    id: p.id as string, slug: p.slug as string, title: p.title as string, description: p.description as string,
    ownerId: p.owner_id as string, ownerName: p.owner_name as string, teamId: p.team_id as string | null, teamName: p.team_name as string | null,
    visibility: p.visibility as string, departmentId: p.department_id as string | null, departmentName: p.department_name as string | null,
    allowWrites: p.allow_writes as boolean, publishedVersionId: p.published_version_id as string | null,
    publishedVersion: p.published_version as number | null, updatedAt: p.updated_at, createdAt: p.created_at, canEdit,
  };
}

export async function listPages(db: Db, userId: string) {
  const { rows } = await db.query(
    `select p.slug, p.title, p.description, p.visibility, p.updated_at, u.name as owner_name, t.name as team_name, dep.name as department_name,
            v.version as published_version,
            (select max(version) from commons.page_versions pv where pv.page_id = p.id) as latest_version
     from commons.pages p join commons.users u on u.id = p.owner_id left join commons.teams t on t.id = p.team_id
     left join commons.departments dep on dep.id = p.department_id
     left join commons.page_versions v on v.id = p.published_version_id
     where (p.published_version_id is not null and commons.can_view_page(p.id))
        or p.owner_id = $1 or exists (select 1 from commons.team_members m where m.team_id = p.team_id and m.user_id = $1)
     order by p.updated_at desc`,
    [userId],
  );
  return rows.map((r) => ({
    slug: r.slug, title: r.title, description: r.description, visibility: r.visibility, departmentName: r.department_name, updatedAt: r.updated_at,
    ownerName: r.owner_name, teamName: r.team_name, publishedVersion: r.published_version, latestVersion: r.latest_version,
  }));
}

export async function createPage(db: Db, userId: string, raw: unknown) {
  const input = PageInput.parse(raw);
  const exists = await db.query("select 1 from commons.pages where slug = $1", [input.slug]);
  if (exists.rows.length) throw badRequest(`A page called "${input.slug}" already exists`);
  await checkDepartment(db, userId, input.visibility, input.departmentId);
  await db.query(
    `insert into commons.pages (slug, title, description, owner_id, team_id, visibility, department_id) values ($1,$2,$3,$4,$5,$6,$7)`,
    [input.slug, input.title, input.description, userId, input.teamId ?? null, input.visibility,
     input.visibility === "department" ? input.departmentId : null],
  );
  await audit(db, userId, "page.create", { slug: input.slug });
  return loadPage(db, input.slug, userId);
}

export async function updatePage(db: Db, userId: string, slug: string, raw: any) {
  const page = await loadPage(db, slug, userId);
  if (!page.canEdit) throw forbidden("Only the page's owner or team can change it");
  const patch = PageInput.partial().omit({ slug: true }).extend({ allowWrites: z.boolean().optional() }).parse(raw);
  // Read from the raw body: zod's partial() still fills in defaults (visibility would become "private")
  const visibility = raw.visibility === undefined ? page.visibility : PageInput.shape.visibility.parse(raw.visibility);
  const departmentId = "departmentId" in raw ? patch.departmentId : page.departmentId;
  if (raw.visibility !== undefined || "departmentId" in raw) await checkDepartment(db, userId, visibility, departmentId);
  await db.query(
    `update commons.pages set title = coalesce($2, title), description = coalesce($3, description),
       visibility = $4, department_id = $8, allow_writes = coalesce($5, allow_writes),
       team_id = case when $6::boolean then $7::uuid else team_id end, updated_at = now()
     where id = $1`,
    [page.id, patch.title ?? null, raw.description === undefined ? null : patch.description, visibility, patch.allowWrites ?? null, "teamId" in raw, patch.teamId ?? null,
     visibility === "department" ? departmentId : null],
  );
  await audit(db, userId, "page.update", { slug, ...patch });
  return loadPage(db, slug, userId);
}

export async function deletePage(db: Db, userId: string, slug: string) {
  const page = await loadPage(db, slug, userId);
  if (!page.canEdit) throw forbidden();
  await db.query("update commons.pages set published_version_id = null where id = $1", [page.id]);
  await db.query("delete from commons.pages where id = $1", [page.id]);
  await audit(db, userId, "page.delete", { slug });
}

/** Which GraphQL type belongs to which dataset, so a page's queries can be traced to dataset fields. */
async function typeMap(): Promise<Map<string, TypeMapEntry>> {
  const { rows } = await pool.query(
    `select d.id, d.slug, d.type_name, json_agg(json_build_object('name', f.name, 'type', f.type)) as fields
     from commons.datasets d join commons.dataset_fields f on f.dataset_id = d.id group by d.id`,
  );
  const map = new Map<string, TypeMapEntry>();
  for (const r of rows) {
    const names = graphqlNames(r.type_name, r.fields.map((f: any) => ({ name: f.name, column: columnFor(f), reference: f.type === "reference" })));
    if (!names) continue;
    const fields: Record<string, string> = {};
    for (const [field, gqlName] of Object.entries(names.fields)) fields[gqlName] = field;
    for (const [field, gqlName] of Object.entries(names.inputs)) fields[gqlName] ??= field;
    map.set(r.type_name, { datasetId: r.id, slug: r.slug, fields });
  }
  return map;
}

let queue: Promise<unknown> = Promise.resolve();
/** Builds run one at a time so a burst of pushes can't swamp the server. */
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

export async function pushVersion(userId: string, client: string, slug: string, raw: unknown) {
  const input = VersionInput.parse(raw);
  // Create the page on first push, so `commons pages push` works without a separate step
  const page = await asUser(userId, async (db) => {
    const { rows } = await db.query("select id from commons.pages where slug = $1", [slug]);
    if (rows[0]) return loadPage(db, slug, userId);
    return createPage(db, userId, { slug, title: input.title ?? slug, description: input.description ?? "" });
  });
  if (!page.canEdit) throw forbidden("Only the page's owner or team can push new versions");

  const { rows } = await pool.query(
    `insert into commons.page_versions (page_id, version, source, draft, status, created_by, client, message)
     values ($1, coalesce((select max(version) from commons.page_versions where page_id = $1), 0) + 1, $2, $3, 'building', $4, $5, $6)
     returning id, version`,
    [page.id, input.files, input.draft, userId, client, input.message ?? null],
  );
  const { id: versionId, version } = rows[0];

  const result: BuildOutput = await enqueue(async () => buildPage(input.files, getSchema(), await typeMap()));
  const log = [
    result.ok ? `Built in ${result.durationMs} ms` : `Build failed after ${result.durationMs} ms`,
    ...result.notes,
    result.issues.length ? formatIssues(result.issues) : "",
  ].filter(Boolean).join("\n");

  if (result.ok) {
    await putObject(`pages/${versionId}/page.js`, result.js!, "text/javascript");
    await putObject(`pages/${versionId}/page.css`, result.css!, "text/css");
  }
  await pool.query(
    `update commons.page_versions set status = $2, build_log = $3, bundle_key = $4, css_key = $5 where id = $1`,
    [versionId, result.ok ? "ready" : "failed", log, result.ok ? `pages/${versionId}/page.js` : null, result.ok ? `pages/${versionId}/page.css` : null],
  );
  for (const d of result.deps) {
    await pool.query("insert into commons.page_dependencies (page_version_id, dataset_id, field) values ($1,$2,$3) on conflict do nothing", [versionId, d.datasetId, d.field]);
  }
  if (result.ok && input.publish && !input.draft) await publish(userId, slug, version);
  await pool.query("update commons.pages set updated_at = now() where id = $1", [page.id]);
  await asUser(userId, (db) => audit(db, userId, "page.push", { slug, version, ok: result.ok, draft: input.draft }, client));
  return { version, versionId, status: result.ok ? "ready" : "failed", issues: result.issues, log, published: result.ok && input.publish && !input.draft };
}

export function publish(userId: string, slug: string, version: number) {
  return asUser(userId, async (db) => {
    const page = await loadPage(db, slug, userId);
    if (!page.canEdit) throw forbidden("Only the page's owner or team can publish it");
    const { rows } = await db.query("select id, status from commons.page_versions where page_id = $1 and version = $2", [page.id, version]);
    if (!rows[0]) throw notFound(`No version ${version}`);
    if (rows[0].status !== "ready") throw badRequest(`Version ${version} didn't build, so it can't be published`);
    await db.query("update commons.pages set published_version_id = $2, updated_at = now() where id = $1", [page.id, rows[0].id]);
    await audit(db, userId, "page.publish", { slug, version });
    return loadPage(db, slug, userId);
  });
}

export async function listVersions(pageId: string) {
  const { rows } = await pool.query(
    `select v.id, v.version, v.draft, v.status, v.message, v.client, v.created_at, u.name as created_by,
            (select coalesce(json_agg(json_build_object('dataset', d.slug, 'field', pd.field) order by d.slug, pd.field), '[]')
             from commons.page_dependencies pd join commons.datasets d on d.id = pd.dataset_id where pd.page_version_id = v.id) as dependencies
     from commons.page_versions v join commons.users u on u.id = v.created_by
     where v.page_id = $1 order by v.version desc limit 100`,
    [pageId],
  );
  return rows.map((r) => ({ id: r.id, version: r.version, draft: r.draft, status: r.status, message: r.message, client: r.client, createdAt: r.created_at, createdBy: r.created_by, dependencies: r.dependencies }));
}

export async function getVersion(pageId: string, version: number) {
  const { rows } = await pool.query(
    `select v.id, v.version, v.draft, v.status, v.message, v.client, v.source, v.build_log, v.created_at, u.name as created_by
     from commons.page_versions v join commons.users u on u.id = v.created_by where v.page_id = $1 and v.version = $2`,
    [pageId, version],
  );
  if (!rows[0]) throw notFound(`No version ${version}`);
  const r = rows[0];
  return { id: r.id, version: r.version, draft: r.draft, status: r.status, message: r.message, client: r.client, files: r.source, log: r.build_log, createdAt: r.created_at, createdBy: r.created_by };
}

/** The starter page in templates/page, as a file map. */
export async function templateFiles(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && e.name !== ".commons") await walk(p);
      } else out[relative(templateDir, p)] = await readFile(p, "utf8");
    }
  };
  await walk(templateDir);
  return out;
}

/** Files the server builds: the template's tooling files are for local use only. */
export const buildableFiles = (files: Record<string, string>) =>
  Object.fromEntries(Object.entries(files).filter(([n]) => /\.(tsx|ts|graphql|json)$/.test(n) && !["package.json", "tsconfig.json", "commons.json"].includes(n) && !n.startsWith(".")));
