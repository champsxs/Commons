import { z } from "zod";
import type { Db } from "../db/pool.ts";
import { notFound } from "../util/errors.ts";

export const FIELD_TYPES = ["text", "integer", "number", "boolean", "date", "timestamp", "json", "reference"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const SQL_TYPES: Record<Exclude<FieldType, "reference">, string> = {
  text: "text",
  integer: "integer",
  number: "double precision",
  boolean: "boolean",
  date: "date",
  timestamp: "timestamptz",
  json: "jsonb",
};

const fieldName = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,50}$/, "Use lowercase letters, digits and underscores, starting with a letter");

export const ReferenceInput = z.object({
  dataset: z.string(),
  matchField: z.string().optional(),
  onDelete: z.enum(["restrict", "set_null"]).default("restrict"),
  unresolved: z.enum(["reject", "skip", "null"]).default("reject"),
});

export const FieldInput = z.object({
  name: fieldName,
  label: z.string().optional(),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  unique: z.boolean().default(false),
  description: z.string().default(""),
  reference: ReferenceInput.optional(),
});
export type FieldInput = z.infer<typeof FieldInput>;

export const Visibility = z.enum(["private", "shared", "company"]);

export const DatasetInput = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9_]{1,50}$/).optional(),
  name: z.string().min(1),
  description: z.string().default(""),
  visibility: Visibility.default("private"),
  teamId: z.string().uuid().nullish(),
  keyField: z.string().nullish(),
  referenceable: z.boolean().default(true),
  license: z.string().nullish(),
  source: z.string().nullish(),
  fields: z.array(FieldInput).min(1),
});
export type DatasetInput = z.infer<typeof DatasetInput>;

export interface Field {
  id: string;
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  isUnique: boolean;
  description: string;
  position: number;
  deprecated: boolean;
  /** Physical column: same as name, or `<name>_id` for references */
  column: string;
  reference?: Link;
}

export interface Link {
  id: string;
  fromDataset: string;
  fromSlug: string;
  fromField: string;
  toDataset: string;
  toSlug: string;
  toField: string;
  kind: "hard" | "soft";
  onDelete: "restrict" | "set_null";
  unresolved: "reject" | "skip" | "null";
}

export interface Dataset {
  id: string;
  slug: string;
  name: string;
  description: string;
  ownerId: string;
  ownerName: string;
  teamId: string | null;
  teamName: string | null;
  visibility: "private" | "shared" | "company";
  referenceable: boolean;
  keyField: string | null;
  typeName: string;
  license: string | null;
  source: string | null;
  createdAt: string;
  updatedAt: string;
  fields: Field[];
  canEdit: boolean;
}

export const columnFor = (f: { name: string; type: string }) => (f.type === "reference" ? `${f.name}_id` : f.name);

const LINK_SQL = `
  select l.id, l.from_dataset, fd.slug as from_slug, l.from_field, l.to_dataset, td.slug as to_slug,
         l.to_field, l.kind, l.on_delete, l.unresolved
  from commons.dataset_links l
  join commons.datasets fd on fd.id = l.from_dataset
  join commons.datasets td on td.id = l.to_dataset`;

function toLink(r: any): Link {
  return {
    id: r.id,
    fromDataset: r.from_dataset,
    fromSlug: r.from_slug,
    fromField: r.from_field,
    toDataset: r.to_dataset,
    toSlug: r.to_slug,
    toField: r.to_field,
    kind: r.kind,
    onDelete: r.on_delete,
    unresolved: r.unresolved,
  };
}

export async function loadLinksFrom(db: Db, datasetId: string): Promise<Link[]> {
  const { rows } = await db.query(`${LINK_SQL} where l.from_dataset = $1`, [datasetId]);
  return rows.map(toLink);
}

export async function loadLinksTo(db: Db, datasetId: string): Promise<Link[]> {
  const { rows } = await db.query(`${LINK_SQL} where l.to_dataset = $1 and l.from_dataset <> $1`, [datasetId]);
  return rows.map(toLink);
}

/** Loads a dataset by slug or id. Does not check view permission; callers do. */
export async function loadDataset(db: Db, slugOrId: string): Promise<Dataset> {
  const byId = /^[0-9a-f-]{36}$/.test(slugOrId);
  const { rows } = await db.query(
    `select d.*, u.name as owner_name, t.name as team_name, commons.can_edit_dataset(d.id) as can_edit
     from commons.datasets d
     join commons.users u on u.id = d.owner_id
     left join commons.teams t on t.id = d.team_id
     where ${byId ? "d.id" : "d.slug"} = $1`,
    [slugOrId],
  );
  const d = rows[0];
  if (!d) throw notFound(`Dataset "${slugOrId}" not found`);
  const fieldRows = (
    await db.query(`select * from commons.dataset_fields where dataset_id = $1 order by position, name`, [d.id])
  ).rows;
  const links = await loadLinksFrom(db, d.id);
  return {
    id: d.id,
    slug: d.slug,
    name: d.name,
    description: d.description,
    ownerId: d.owner_id,
    ownerName: d.owner_name,
    teamId: d.team_id,
    teamName: d.team_name,
    visibility: d.visibility,
    referenceable: d.referenceable,
    keyField: d.key_field,
    typeName: d.type_name,
    license: d.license,
    source: d.source,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    canEdit: d.can_edit,
    fields: fieldRows.map((f) => ({
      id: f.id,
      name: f.name,
      label: f.label,
      type: f.type,
      required: f.required,
      isUnique: f.is_unique,
      description: f.description,
      position: f.position,
      deprecated: f.deprecated,
      column: columnFor(f),
      reference: links.find((l) => l.fromField === f.name),
    })),
  };
}
