import { z } from "zod";
import type { Db } from "../db/pool.ts";
import { SQL_TYPES, loadDataset, type Field } from "../registry/model.ts";
import { assertCanEdit, audit } from "../registry/datasets.ts";
import { config } from "../config.ts";
import { badRequest } from "../util/errors.ts";
import { ident } from "../util/names.ts";
import { coerce, toFieldName, type RawRow } from "./parse.ts";

export const IngestOptions = z.object({
  mode: z.enum(["append", "upsert", "replace"]).default("append"),
  /** What to do with rows that fail validation */
  onError: z.enum(["reject", "skip"]).default("reject"),
  /** Overrides each reference's own setting for values that don't match a row */
  unresolved: z.enum(["reject", "skip", "null"]).optional(),
  dryRun: z.boolean().default(false),
});
export type IngestOptions = z.infer<typeof IngestOptions>;

interface RowError {
  row: number;
  field?: string;
  message: string;
}

export interface IngestReport {
  status: "ok" | "failed" | "dry_run";
  message: string;
  rowsTotal: number;
  rowsWritten: number;
  rowsSkipped: number;
  errors: RowError[];
  unresolved: Record<string, { count: number; values: string[]; target: string; matchField: string }>;
  ignoredColumns: string[];
  columnMapping: Record<string, string>;
}

/** Maps file headers to fields: by name, by label, and for references by the match field ("city_code" -> city). */
function mapColumns(headers: string[], fields: Field[]) {
  const mapping: Record<string, string> = {};
  const byNorm = new Map(headers.map((h) => [toFieldName(h), h]));
  for (const f of fields) {
    const candidates = [f.name, toFieldName(f.label)];
    if (f.reference) {
      candidates.push(`${f.name}_${f.reference.toField}`, f.reference.toField, `${f.name}_${f.reference.toField.replace(/^.*_/, "")}`);
    }
    for (const c of candidates) {
      const h = byNorm.get(c);
      if (h && !Object.values(mapping).includes(h) && !fields.some((o) => o !== f && o.name === c)) {
        mapping[f.name] = h;
        break;
      }
    }
  }
  const used = new Set(Object.values(mapping));
  return { mapping, ignored: headers.filter((h) => !used.has(h)) };
}

export async function ingest(db: Db, userId: string, slug: string, rows: RawRow[], rawOpts: unknown, filename?: string): Promise<IngestReport> {
  const opts = IngestOptions.parse(rawOpts);
  const ds = await loadDataset(db, slug);
  await assertCanEdit(db, ds.id);
  if (rows.length > config.limits.maxIngestRows) throw badRequest(`Files are limited to ${config.limits.maxIngestRows} rows for now`);
  if (opts.mode === "upsert" && !ds.keyField) throw badRequest(`Upsert needs a key field, and ${ds.slug} doesn't have one`);

  const fields = ds.fields;
  const headers = [...new Set(rows.slice(0, 1000).flatMap((r) => Object.keys(r)))];
  const { mapping, ignored } = mapColumns(headers, fields);

  const report: IngestReport = {
    status: "ok", message: "", rowsTotal: rows.length, rowsWritten: 0, rowsSkipped: 0,
    errors: [], unresolved: {}, ignoredColumns: ignored, columnMapping: mapping,
  };

  // Add or update may leave columns out (they keep their values), but must say which rows it means
  if (opts.mode === "upsert" && !mapping[ds.keyField!]) {
    report.status = "failed";
    report.message = `The file needs a "${ds.keyField}" column so rows can be matched for updating`;
    return finish(db, userId, ds.id, report, opts, filename);
  }
  const missing = fields.filter((f) => f.required && !mapping[f.name]).map((f) => f.name);
  if (missing.length && opts.mode !== "upsert") {
    report.status = "failed";
    report.message = `The file has no column for required field(s): ${missing.join(", ")}`;
    return finish(db, userId, ds.id, report, opts, filename);
  }

  // 1. Validate and convert every cell
  const invalid = new Set<number>(); // rows with bad values
  const unmatched = new Set<number>(); // rows skipped because a reference didn't match
  let rejectUnmatched = false;
  const out: Record<string, unknown>[] = rows.map((raw, i) => {
    const rec: Record<string, unknown> = {};
    for (const f of fields) {
      const header = mapping[f.name];
      if (!header) continue;
      try {
        const v = coerce(f.type, raw[header]);
        if (v === null && f.required) throw "is required";
        rec[f.name] = v;
      } catch (msg) {
        invalid.add(i);
        if (report.errors.length < 100) report.errors.push({ row: i + 1, field: f.name, message: String(msg) });
      }
    }
    return rec;
  });

  // 2. Resolve references in bulk: one lookup per reference field, as the user so row-level security applies
  for (const f of fields.filter((x) => x.reference && mapping[x.name])) {
    const link = f.reference!;
    const values = [...new Set(out.map((r) => r[f.name]).filter((v): v is string => typeof v === "string"))];
    if (!values.length) continue;
    const { rows: found } = await withDataRole(db, () =>
      db.query(`select ${ident(link.toField)}::text as k, id from data.${ident(link.toSlug)} where ${ident(link.toField)}::text = any($1)`, [values]),
    );
    const ids = new Map(found.map((r) => [r.k, r.id]));
    const policy = opts.unresolved ?? link.unresolved;
    const missingValues = new Set<string>();
    let count = 0;
    out.forEach((r, i) => {
      const v = r[f.name];
      if (typeof v !== "string") return;
      const id = ids.get(v);
      if (id) return void (r[f.name] = id);
      missingValues.add(v);
      count++;
      if (policy === "null" && !f.required) r[f.name] = null;
      else if (policy === "skip") unmatched.add(i);
      else {
        rejectUnmatched = true;
        if (report.errors.length < 100) report.errors.push({ row: i + 1, field: f.name, message: `no ${link.toSlug} with ${link.toField} "${v}"` });
      }
    });
    if (missingValues.size) {
      report.unresolved[f.name] = { count, values: [...missingValues].slice(0, 20), target: link.toSlug, matchField: link.toField };
    }
  }

  if (rejectUnmatched || (invalid.size && opts.onError === "reject")) {
    report.status = "failed";
    report.rowsSkipped = rows.length;
    report.message = summarize(report, new Set([...invalid, ...report.errors.map((e) => e.row - 1)]).size);
    return finish(db, userId, ds.id, report, opts, filename);
  }

  const bad = new Set([...invalid, ...unmatched]);
  const good = out.filter((_, i) => !bad.has(i));
  report.rowsSkipped = rows.length - good.length;

  if (opts.dryRun) {
    report.status = "dry_run";
    report.rowsWritten = good.length;
    report.message = `${good.length} row(s) would be written${report.rowsSkipped ? `, ${report.rowsSkipped} skipped` : ""}.`;
    return finish(db, userId, ds.id, report, opts, filename);
  }

  // A partial add-or-update can update existing rows, but new rows still need every required field
  if (opts.mode === "upsert" && missing.length) {
    const key = ds.keyField!;
    const keys = [...new Set(good.map((r) => String(r[key])))];
    const { rows: found } = await withDataRole(db, () =>
      db.query(`select ${ident(key)}::text as k from data.${ident(ds.slug)} where ${ident(key)}::text = any($1)`, [keys]),
    );
    const existing = new Set(found.map((r) => r.k));
    const fresh = keys.filter((k) => !existing.has(k));
    if (fresh.length) {
      report.status = "failed";
      report.message = `${fresh.length} row(s) are new (${key}: ${fresh.slice(0, 5).join(", ")}${fresh.length > 5 ? "…" : ""}), ` +
        `and new rows need the required field(s) ${missing.join(", ")}, which the file doesn't have. Nothing was written.`;
      return finish(db, userId, ds.id, report, opts, filename);
    }
  }

  // 3. Write in chunks, as the user, inside a savepoint so a database error leaves nothing half-written
  const cols = fields.filter((f) => mapping[f.name]);
  let updated = 0;
  await db.query("savepoint ingest");
  try {
    await withDataRole(db, async () => {
      if (opts.mode === "replace") await db.query(`delete from data.${ident(ds.slug)}`);
      for (let i = 0; i < good.length; i += 5000) {
        const chunk = good.slice(i, i + 5000);
        const json = JSON.stringify(chunk);
        if (opts.mode === "upsert") {
          const u = updateSql(ds.slug, cols, ds.keyField!);
          if (u) updated += (await db.query(u, [json])).rowCount ?? 0;
        }
        const res = await db.query(insertSql(ds.slug, cols, opts.mode === "upsert" ? ds.keyField : null), [json]);
        report.rowsWritten += res.rowCount ?? 0;
      }
    });
    await db.query("release savepoint ingest");
  } catch (e: any) {
    await db.query("rollback to savepoint ingest");
    report.status = "failed";
    report.rowsWritten = 0;
    report.message = explainDbError(e, ds.slug);
    return finish(db, userId, ds.id, report, opts, filename);
  }
  const added = report.rowsWritten;
  report.rowsWritten += updated;
  report.message = opts.mode === "upsert"
    ? `${updated} row(s) updated, ${added} added${report.rowsSkipped ? `, ${report.rowsSkipped} skipped` : ""}.`
    : `${report.rowsWritten} row(s) written${report.rowsSkipped ? `, ${report.rowsSkipped} skipped` : ""}.`;
  return finish(db, userId, ds.id, report, opts, filename);
}

function summarize(r: IngestReport, badCount: number) {
  const parts = [`${badCount} row(s) have problems, so nothing was written.`];
  for (const [field, u] of Object.entries(r.unresolved)) {
    parts.push(`${u.values.length} unknown ${u.target} in "${field}": ${u.values.slice(0, 5).join(", ")}${u.values.length > 5 ? "…" : ""}.`);
  }
  return parts.join(" ");
}

async function withDataRole<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  await db.query("set local role commons_user");
  // On failure the caller rolls back (to a savepoint), which also undoes the role change
  const result = await fn();
  await db.query("reset role");
  return result;
}

const recordset = (cols: Field[]) =>
  `jsonb_to_recordset($1::jsonb) as x(${cols.map((f) => `${ident(f.name)} ${f.type === "reference" ? "uuid" : SQL_TYPES[f.type as keyof typeof SQL_TYPES]}`).join(", ")})`;

/**
 * Adds the file's rows. For add-or-update (`newOnlyKey`), only rows whose key isn't there yet;
 * existing ones go through updateSql. (A single INSERT … ON CONFLICT can't do a partial update:
 * Postgres checks required columns before it notices the row exists.)
 */
function insertSql(slug: string, cols: Field[], newOnlyKey: string | null) {
  const target = cols.map((f) => ident(f.column));
  const source = cols.map((f) => `x.${ident(f.name)}`);
  let sql = `insert into data.${ident(slug)} (${target.join(", ")}) select ${source.join(", ")} from ${recordset(cols)}`;
  if (newOnlyKey) sql += ` where not exists (select 1 from data.${ident(slug)} t where t.${ident(newOnlyKey)} = x.${ident(newOnlyKey)})`;
  return sql;
}

/** Updates rows whose key is in the file, changing only the columns the file has. */
function updateSql(slug: string, cols: Field[], key: string) {
  const sets = cols.filter((f) => f.name !== key).map((f) => `${ident(f.column)} = x.${ident(f.name)}`);
  if (!sets.length) return null;
  return `update data.${ident(slug)} as t set ${sets.join(", ")} from ${recordset(cols)} where t.${ident(key)} = x.${ident(key)}`;
}

function explainDbError(e: any, slug: string): string {
  switch (e.code) {
    case "23505":
      return `Duplicate value: ${e.detail ?? e.message}. Use upsert to update existing rows.`;
    case "23503":
      return `Some rows in ${slug} are still referenced by other datasets, so they can't be removed. ${e.detail ?? ""}`.trim();
    case "23502":
      return `A required value is missing: ${e.message}`;
    case "42501":
      return "You don't have permission to write to this dataset.";
    default:
      return `The database rejected the upload: ${e.message}`;
  }
}

async function finish(db: Db, userId: string, datasetId: string, report: IngestReport, opts: IngestOptions, filename?: string) {
  if (opts.dryRun && report.status !== "failed") return report;
  await db.query(
    `insert into commons.ingest_runs (dataset_id, user_id, filename, mode, status, rows_total, rows_inserted, rows_skipped, report)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [datasetId, userId, filename ?? null, opts.mode, report.status, report.rowsTotal, report.rowsWritten, report.rowsSkipped, report],
  );
  if (report.status === "ok") {
    await db.query("update commons.datasets set updated_at = now() where id = $1", [datasetId]);
    await audit(db, userId, "dataset.ingest", { datasetId, rows: report.rowsWritten, mode: opts.mode });
  }
  return report;
}
