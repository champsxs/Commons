import type { Db } from "../db/pool.ts";
import { badRequest, conflict, forbidden } from "../util/errors.ts";
import { RESERVED_FIELDS, camel, ident, literal, pascal, singular, slugify } from "../util/names.ts";
import {
  DatasetInput,
  Visibility,
  FieldInput,
  SQL_TYPES,
  columnFor,
  loadDataset,
  loadLinksFrom,
  loadLinksTo,
  type Dataset,
} from "./model.ts";

const RESERVED_TYPE_NAMES = new Set([
  "Query", "Mutation", "Subscription", "Node", "Cursor", "Datetime", "Date", "Time", "JSON", "BigInt",
  "BigFloat", "UUID", "PageInfo", "Int", "Float", "String", "Boolean", "ID", "Interval",
]);

async function assertCanView(db: Db, datasetId: string) {
  const { rows } = await db.query("select commons.can_view_dataset($1) as ok", [datasetId]);
  if (!rows[0].ok) throw forbidden();
}

export async function assertCanEdit(db: Db, datasetId: string) {
  const { rows } = await db.query("select commons.can_edit_dataset($1) as ok", [datasetId]);
  if (!rows[0].ok) throw forbidden("You need edit access to this dataset");
}

export async function getDataset(db: Db, slug: string): Promise<Dataset> {
  const ds = await loadDataset(db, slug);
  await assertCanView(db, ds.id);
  return ds;
}

/** Validates a reference field and returns the target dataset and the unique field users match on. */
async function resolveReferenceTarget(db: Db, field: FieldInput) {
  if (!field.reference) throw badRequest(`Field "${field.name}" is a reference but has no target dataset`);
  if (field.name.endsWith("_id")) {
    throw badRequest(`Reference field "${field.name}" should not end in _id; name it after the thing, e.g. "${field.name.slice(0, -3)}"`);
  }
  const target = await loadDataset(db, field.reference.dataset);
  // Postgres foreign key checks bypass row-level security, so creating a reference
  // must require view access; otherwise inserts could probe a private dataset's ids.
  const { rows } = await db.query(
    "select commons.can_view_dataset($1) as can_view, commons.can_edit_dataset($1) as can_edit",
    [target.id],
  );
  if (!rows[0].can_view) throw forbidden(`You need view access to "${target.slug}" to reference it`);
  if (!target.referenceable && !rows[0].can_edit) {
    throw forbidden(`The owner of "${target.slug}" has not allowed other datasets to reference it`);
  }
  const matchField = field.reference.matchField ?? target.keyField ?? "id";
  if (matchField !== "id") {
    const f = target.fields.find((x) => x.name === matchField);
    if (!f) throw badRequest(`"${target.slug}" has no field "${matchField}"`);
    if (!f.isUnique) {
      throw badRequest(`"${target.slug}.${matchField}" is not unique, so it can't identify a row. Pick a unique field.`);
    }
  }
  return { target, matchField };
}

function fieldColumnSql(slug: string, f: FieldInput, targetSlug?: string, onDelete?: string): string {
  if (f.type === "reference") {
    const action = onDelete === "set_null" ? "set null" : "restrict";
    return `${ident(columnFor(f))} uuid${f.required ? " not null" : ""} constraint ${ident(`${slug}_${f.name}_fkey`)} references data.${ident(targetSlug!)}(id) on delete ${action}`;
  }
  return `${ident(f.name)} ${SQL_TYPES[f.type]}${f.required ? " not null" : ""}${f.unique ? " unique" : ""}`;
}

async function backRelationName(db: Db, fromSlug: string, fieldName: string, targetId: string, targetFields: string[]) {
  const base = camel(fromSlug);
  const { rows } = await db.query(
    `select 1 from commons.dataset_links l join commons.datasets d on d.id = l.from_dataset
     where l.to_dataset = $1 and d.slug = $2 and l.from_field <> $3`,
    [targetId, fromSlug, fieldName],
  );
  if (rows.length === 0 && !targetFields.map(camel).includes(base)) return base;
  return `${base}By${pascal(fieldName)}`;
}

async function addReferenceConstraintComment(
  db: Db,
  fromSlug: string,
  field: FieldInput,
  target: Dataset,
) {
  const constraint = `${fromSlug}_${field.name}_fkey`;
  const back = await backRelationName(db, fromSlug, field.name, target.id, target.fields.map((f) => f.name));
  await db.query(
    `comment on constraint ${ident(constraint)} on data.${ident(fromSlug)} is ${literal(
      `@fieldName ${camel(field.name)}\n@foreignFieldName ${back}`,
    )}`,
  );
}

function checkFieldNames(fields: FieldInput[]) {
  const columns = new Set<string>();
  for (const f of fields) {
    if (RESERVED_FIELDS.has(f.name)) throw badRequest(`"${f.name}" is reserved; every dataset already has it`);
    const col = columnFor(f);
    if (columns.has(col) || columns.has(f.name)) throw badRequest(`Duplicate field "${f.name}"`);
    columns.add(col);
  }
}

export async function createDataset(db: Db, userId: string, raw: unknown): Promise<Dataset> {
  const input = DatasetInput.parse(raw);
  const slug = input.slug ?? slugify(input.name);
  if (!/^[a-z][a-z0-9_]{1,50}$/.test(slug)) throw badRequest(`Can't make a valid id from "${input.name}"; pass a slug`);
  checkFieldNames(input.fields);

  const typeName = pascal(singular(slug));
  if (RESERVED_TYPE_NAMES.has(typeName)) throw badRequest(`"${slug}" clashes with a built-in GraphQL type; pick another name`);
  const clash = await db.query("select slug from commons.datasets where slug = $1 or type_name = $2", [slug, typeName]);
  if (clash.rows.length) throw conflict(`A dataset named "${clash.rows[0].slug}" already exists`, { existing: clash.rows[0].slug });

  if (input.keyField) {
    const kf = input.fields.find((f) => f.name === input.keyField);
    if (!kf) throw badRequest(`Key field "${input.keyField}" is not one of the fields`);
    if (kf.type === "reference" || kf.type === "json") throw badRequest("The key field must be a plain value like text or a number");
    kf.unique = true;
    kf.required = true;
  }
  await checkDepartment(db, userId, input.visibility, input.departmentId);
  if (input.teamId) {
    const member = await db.query(
      `select 1 from commons.team_members where team_id = $1 and user_id = $2
       union all select 1 from commons.users where id = $2 and is_admin`,
      [input.teamId, userId],
    );
    if (!member.rows.length) throw forbidden("You can only assign datasets to teams you belong to");
  }

  const targets = new Map<string, { target: Dataset; matchField: string }>();
  for (const f of input.fields) {
    if (f.type === "reference") targets.set(f.name, await resolveReferenceTarget(db, f));
    else if (f.reference) throw badRequest(`Field "${f.name}" has a reference target but type ${f.type}`);
  }

  const { rows } = await db.query(
    `insert into commons.datasets (slug, name, description, owner_id, team_id, visibility, department_id, referenceable, key_field, type_name, license, source)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [slug, input.name, input.description, userId, input.teamId ?? null, input.visibility,
     input.visibility === "department" ? input.departmentId : null, input.referenceable,
     input.keyField ?? null, typeName, input.license ?? null, input.source ?? null],
  );
  const datasetId: string = rows[0].id;

  const columns = input.fields.map((f) => {
    const t = targets.get(f.name);
    return fieldColumnSql(slug, f, t?.target.slug, f.reference?.onDelete);
  });
  await db.query(`
    create table data.${ident(slug)} (
      id uuid primary key default gen_random_uuid(),
      ${columns.join(",\n      ")},
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`);
  await setupTableSecurity(db, slug, datasetId, typeName, input.name, input.description);

  for (const [i, f] of input.fields.entries()) {
    await insertFieldRow(db, datasetId, f, i);
    const t = targets.get(f.name);
    if (t) {
      await insertLink(db, datasetId, f, t.target.id, t.matchField);
      await db.query(`create index on data.${ident(slug)} (${ident(columnFor(f))})`);
      await addReferenceConstraintComment(db, slug, f, t.target);
    }
    if (f.description) await commentColumn(db, slug, columnFor(f), f.description);
  }

  await audit(db, userId, "dataset.create", { slug });
  return loadDataset(db, datasetId);
}

async function setupTableSecurity(db: Db, slug: string, datasetId: string, typeName: string, name: string, description: string) {
  const t = `data.${ident(slug)}`;
  const id = literal(datasetId);
  await db.query(`
    alter table ${t} enable row level security;
    -- Wrapping the check in a sub-select makes Postgres evaluate it once per query, not per row
    create policy commons_view on ${t} for select to commons_user using ((select commons.can_view_dataset(${id})));
    create policy commons_insert on ${t} for insert to commons_user with check ((select commons.can_edit_dataset(${id})));
    create policy commons_update on ${t} for update to commons_user
      using ((select commons.can_edit_dataset(${id}))) with check ((select commons.can_edit_dataset(${id})));
    create policy commons_delete on ${t} for delete to commons_user using ((select commons.can_edit_dataset(${id})));
    grant select, insert, update, delete on ${t} to commons_user;
    create trigger touch_updated_at before update on ${t} for each row execute function commons.touch_updated_at();
    comment on table ${t} is ${literal(`@name ${typeName}\n${name}${description ? ": " + description : ""}`)};
  `);
}

async function commentColumn(db: Db, slug: string, column: string, description: string) {
  await db.query(`comment on column data.${ident(slug)}.${ident(column)} is ${literal(description)}`);
}

async function insertFieldRow(db: Db, datasetId: string, f: FieldInput, position: number) {
  await db.query(
    `insert into commons.dataset_fields (dataset_id, name, label, type, required, is_unique, description, position)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [datasetId, f.name, f.label ?? labelize(f.name), f.type, f.required, f.unique, f.description, position],
  );
}

async function insertLink(db: Db, datasetId: string, f: FieldInput, targetId: string, matchField: string) {
  await db.query(
    `insert into commons.dataset_links (from_dataset, from_field, to_dataset, to_field, on_delete, unresolved)
     values ($1,$2,$3,$4,$5,$6)`,
    [datasetId, f.name, targetId, matchField, f.reference!.onDelete, f.reference!.unresolved],
  );
}

export const labelize = (name: string) => {
  const s = name.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export async function addField(db: Db, userId: string, slug: string, raw: unknown): Promise<Dataset> {
  const ds = await loadDataset(db, slug);
  await assertCanEdit(db, ds.id);
  const f = FieldInput.parse(raw);
  checkFieldNames([...ds.fields.map((x) => FieldInput.parse({ name: x.name, type: x.type })), f]);
  if (f.required) {
    const { rows } = await db.query(`select exists (select 1 from data.${ident(ds.slug)}) as has_rows`);
    if (rows[0].has_rows) throw badRequest("Can't add a required field to a dataset that already has rows; add it as optional first");
  }
  let target: { target: Dataset; matchField: string } | undefined;
  if (f.type === "reference") target = await resolveReferenceTarget(db, f);
  await db.query(`alter table data.${ident(ds.slug)} add column ${fieldColumnSql(ds.slug, f, target?.target.slug, f.reference?.onDelete)}`);
  const pos = Math.max(-1, ...ds.fields.map((x) => x.position)) + 1;
  await insertFieldRow(db, ds.id, f, pos);
  if (target) {
    await insertLink(db, ds.id, f, target.target.id, target.matchField);
    await db.query(`create index on data.${ident(ds.slug)} (${ident(columnFor(f))})`);
    await addReferenceConstraintComment(db, ds.slug, f, target.target);
  }
  if (f.description) await commentColumn(db, ds.slug, columnFor(f), f.description);
  await touch(db, ds.id);
  await audit(db, userId, "dataset.field.add", { slug, field: f.name });
  return loadDataset(db, ds.id);
}

export async function updateField(db: Db, userId: string, slug: string, name: string, raw: any): Promise<Dataset> {
  const ds = await loadDataset(db, slug);
  await assertCanEdit(db, ds.id);
  const f = ds.fields.find((x) => x.name === name);
  if (!f) throw badRequest(`No field "${name}"`);
  await db.query(
    `update commons.dataset_fields set label = coalesce($3, label), description = coalesce($4, description),
       deprecated = coalesce($5, deprecated) where dataset_id = $1 and name = $2`,
    [ds.id, name, raw.label ?? null, raw.description ?? null, raw.deprecated ?? null],
  );
  if (typeof raw.description === "string") await commentColumn(db, ds.slug, f.column, raw.description);
  await touch(db, ds.id);
  await audit(db, userId, "dataset.field.update", { slug, field: name });
  return loadDataset(db, ds.id);
}

/** Who depends on a dataset (or one of its fields): other datasets' references and published pages. */
export async function usage(db: Db, datasetId: string, field?: string) {
  const links = (await loadLinksTo(db, datasetId)).filter((l) => !field || l.toField === field);
  const { rows: pages } = await db.query(
    `select distinct p.id, p.slug, p.title, array_agg(distinct pd.field) as fields
     from commons.page_dependencies pd
     join commons.pages p on p.published_version_id = pd.page_version_id
     where pd.dataset_id = $1 and ($2::text is null or pd.field = $2)
     group by p.id, p.slug, p.title`,
    [datasetId, field ?? null],
  );
  return {
    datasets: links.map((l) => ({ slug: l.fromSlug, field: l.fromField, matchField: l.toField, onDelete: l.onDelete })),
    pages: pages.map((p) => ({ id: p.id, slug: p.slug, title: p.title, fields: p.fields })),
  };
}

export async function dropField(db: Db, userId: string, slug: string, name: string, force = false): Promise<Dataset> {
  const ds = await loadDataset(db, slug);
  await assertCanEdit(db, ds.id);
  const f = ds.fields.find((x) => x.name === name);
  if (!f) throw badRequest(`No field "${name}"`);
  if (ds.keyField === name) throw conflict(`"${name}" is the key field of ${ds.slug}; it can't be removed`);
  const used = await usage(db, ds.id, name);
  if (used.datasets.length) {
    throw conflict(`"${name}" is used by ${used.datasets.length} dataset(s) to match references. Deprecate it instead.`, used);
  }
  if (used.pages.length && !force) {
    throw conflict(`"${name}" is used by ${used.pages.length} published page(s). Pass force to remove it anyway.`, used);
  }
  await db.query(`alter table data.${ident(ds.slug)} drop column ${ident(f.column)}`);
  await db.query("delete from commons.dataset_links where from_dataset = $1 and from_field = $2", [ds.id, name]);
  await db.query("delete from commons.dataset_fields where dataset_id = $1 and name = $2", [ds.id, name]);
  await touch(db, ds.id);
  await audit(db, userId, "dataset.field.drop", { slug, field: name });
  return loadDataset(db, ds.id);
}

export async function updateDataset(db: Db, userId: string, slug: string, raw: any): Promise<Dataset> {
  const ds = await loadDataset(db, slug);
  await assertCanEdit(db, ds.id);
  const patch = DatasetInput.partial().omit({ fields: true, slug: true, keyField: true }).parse(raw);
  // Read from the raw body: zod's partial() still fills in defaults (visibility would become "private")
  const visibility = raw.visibility === undefined ? ds.visibility : Visibility.parse(raw.visibility);
  const departmentId = "departmentId" in raw ? patch.departmentId : ds.departmentId;
  if (raw.visibility !== undefined || "departmentId" in raw) await checkDepartment(db, userId, visibility, departmentId);
  await db.query(
    `update commons.datasets set
       name = coalesce($2, name), description = coalesce($3, description), visibility = $4, department_id = $10,
       team_id = case when $5::boolean then $6::uuid else team_id end,
       referenceable = coalesce($7, referenceable), license = coalesce($8, license), source = coalesce($9, source),
       updated_at = now()
     where id = $1`,
    [ds.id, patch.name ?? null, raw.description === undefined ? null : patch.description, visibility, "teamId" in raw, patch.teamId ?? null,
     raw.referenceable ?? null, patch.license ?? null, patch.source ?? null, visibility === "department" ? departmentId : null],
  );
  if (Array.isArray(raw.shares)) {
    await db.query("delete from commons.dataset_shares where dataset_id = $1", [ds.id]);
    for (const s of raw.shares) {
      await db.query(
        "insert into commons.dataset_shares (dataset_id, team_id, user_id, can_edit) values ($1,$2,$3,$4)",
        [ds.id, s.teamId ?? null, s.userId ?? null, !!s.canEdit],
      );
    }
  }
  await audit(db, userId, "dataset.update", { slug });
  return loadDataset(db, ds.id);
}

/** "Department users" needs a department the person belongs to (admins may pick any). */
export async function checkDepartment(db: Db, userId: string, visibility: string, departmentId: string | null | undefined) {
  if (visibility !== "department") return;
  if (!departmentId) throw badRequest("Choose which department can see it");
  const { rows } = await db.query(
    "select commons.in_department($1, $2) or exists (select 1 from commons.users where id = $2 and is_admin) as ok",
    [departmentId, userId],
  );
  if (!rows[0].ok) throw forbidden("You can only open things to a department you belong to");
}

export async function deleteDataset(db: Db, userId: string, slug: string, force = false) {
  const ds = await loadDataset(db, slug);
  const { rows } = await db.query(
    "select (owner_id = $2 or exists (select 1 from commons.users where id = $2 and is_admin)) as ok from commons.datasets where id = $1",
    [ds.id, userId],
  );
  if (!rows[0].ok) throw forbidden("Only the owner or an admin can delete a dataset");
  const used = await usage(db, ds.id);
  if (used.datasets.length) {
    throw conflict(`${ds.slug} is referenced by ${used.datasets.map((d) => d.slug).join(", ")}. Remove those references first.`, used);
  }
  if (used.pages.length && !force) {
    throw conflict(`${ds.slug} is used by ${used.pages.length} published page(s). Pass force to delete anyway.`, used);
  }
  await db.query(`drop table data.${ident(ds.slug)}`);
  await db.query("delete from commons.dataset_links where from_dataset = $1", [ds.id]);
  await db.query("delete from commons.datasets where id = $1", [ds.id]);
  await audit(db, userId, "dataset.delete", { slug });
}

const touch = (db: Db, id: string) => db.query("update commons.datasets set updated_at = now() where id = $1", [id]);

export async function audit(db: Db, userId: string | null, action: string, detail: object, client?: string) {
  await db.query("insert into commons.audit_log (user_id, client, action, detail) values ($1,$2,$3,$4)", [
    userId, client ?? null, action, detail,
  ]);
}

export async function listDatasets(db: Db) {
  const { rows } = await db.query(`
    select d.id, d.slug, d.name, d.description, d.visibility, d.updated_at, d.key_field,
           u.name as owner_name, t.name as team_name, dep.name as department_name,
           (select count(*) from commons.dataset_fields f where f.dataset_id = d.id)::int as field_count,
           (select count(*) from commons.dataset_links l where l.to_dataset = d.id and l.from_dataset <> d.id)::int as used_by_count,
           commons.row_count(d.slug) as approx_rows
    from commons.datasets d
    join commons.users u on u.id = d.owner_id
    left join commons.teams t on t.id = d.team_id
    left join commons.departments dep on dep.id = d.department_id
    where commons.can_view_dataset(d.id)
    order by d.name`);
  return rows.map((r) => ({
    id: r.id, slug: r.slug, name: r.name, description: r.description, visibility: r.visibility, departmentName: r.department_name,
    updatedAt: r.updated_at, keyField: r.key_field, ownerName: r.owner_name, teamName: r.team_name,
    fieldCount: r.field_count, usedByCount: r.used_by_count, approxRows: Math.max(0, Number(r.approx_rows ?? 0)),
  }));
}

export { loadLinksFrom };
