import { z } from "zod";
import type { Db } from "../db/pool.ts";
import { singular } from "../util/names.ts";

export async function search(db: Db, q: string) {
  const term = q.trim();
  if (!term) return { datasets: [], fields: [], pages: [] };
  const like = `%${term.replace(/[%_]/g, "\\$&")}%`;
  const datasets = await db.query(
    `select d.slug, d.name, d.description, d.visibility,
            greatest(similarity(d.name, $1), similarity(d.slug, $1), word_similarity($1, d.description)) as score
     from commons.datasets d
     where commons.can_view_dataset(d.id)
       and (d.name ilike $2 or d.slug ilike $2 or d.description ilike $2
            or similarity(d.name, $1) > 0.25 or similarity(d.slug, $1) > 0.25)
     order by score desc limit 20`,
    [term, like],
  );
  const fields = await db.query(
    `select d.slug as dataset, d.name as dataset_name, f.name, f.label, f.type, f.description
     from commons.dataset_fields f join commons.datasets d on d.id = f.dataset_id
     where commons.can_view_dataset(d.id)
       and (f.name ilike $2 or f.label ilike $2 or f.description ilike $2 or similarity(f.name, $1) > 0.4)
     order by similarity(f.name, $1) desc limit 20`,
    [term, like],
  );
  const pages = await db.query(
    `select p.slug, p.title, p.description
     from commons.pages p
     where commons.can_view_page(p.id) and p.published_version_id is not null
       and (p.title ilike $2 or p.slug ilike $2 or p.description ilike $2 or similarity(p.title, $1) > 0.25)
     order by similarity(p.title, $1) desc limit 20`,
    [term, like],
  );
  return {
    datasets: datasets.rows.map((r) => ({ slug: r.slug, name: r.name, description: r.description, visibility: r.visibility })),
    fields: fields.rows.map((r) => ({ dataset: r.dataset, datasetName: r.dataset_name, name: r.name, label: r.label, type: r.type, description: r.description })),
    pages: pages.rows,
  };
}

export const SuggestInput = z.object({
  name: z.string().default(""),
  description: z.string().default(""),
  fields: z.array(z.object({ name: z.string(), type: z.string().optional() })).default([]),
});

interface Candidate {
  id: string;
  slug: string;
  name: string;
  description: string;
  keyField: string | null;
  uniqueFields: string[];
  fieldNames: string[];
}

/**
 * "Reuse before create": given a proposed dataset, find existing datasets that look like the same thing,
 * and fields that look like they should be references to existing datasets.
 */
export async function suggest(db: Db, raw: unknown) {
  const input = SuggestInput.parse(raw);
  const { rows } = await db.query(
    `select d.id, d.slug, d.name, d.description, d.key_field,
            coalesce(array_agg(f.name order by f.position) filter (where f.name is not null), '{}') as field_names,
            coalesce(array_agg(f.name) filter (where f.is_unique), '{}') as unique_fields,
            greatest(similarity(d.name, $1), similarity(d.slug, $1)) as name_score
     from commons.datasets d
     left join commons.dataset_fields f on f.dataset_id = d.id and f.type <> 'reference'
     where commons.can_view_dataset(d.id) and (d.referenceable or commons.can_edit_dataset(d.id))
     group by d.id`,
    [input.name || "-"],
  );
  const candidates: (Candidate & { nameScore: number })[] = rows.map((r) => ({
    id: r.id, slug: r.slug, name: r.name, description: r.description, keyField: r.key_field,
    uniqueFields: r.unique_fields, fieldNames: r.field_names, nameScore: Number(r.name_score),
  }));

  const proposed = new Set(input.fields.map((f) => f.name));
  const similar = candidates
    .map((c) => {
      const overlap = c.fieldNames.filter((n) => proposed.has(n)).length;
      const fieldScore = proposed.size && c.fieldNames.length ? overlap / Math.min(proposed.size, c.fieldNames.length) : 0;
      const score = Math.max(c.nameScore, 0.6 * c.nameScore + 0.6 * fieldScore);
      const reasons = [];
      if (c.nameScore > 0.35) reasons.push(`similar name to "${c.name}"`);
      if (overlap >= 2) reasons.push(`${overlap} matching fields`);
      return { slug: c.slug, name: c.name, description: c.description, score: Math.round(score * 100) / 100, reasons };
    })
    .filter((s) => s.score >= 0.4 && s.reasons.length)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const references = [];
  for (const f of input.fields) {
    if (f.type === "reference") continue;
    const stem = f.name.replace(/_(code|id|key|name|sku|number|no)$/, "");
    for (const c of candidates) {
      const matchField =
        c.uniqueFields.find((u) => u === f.name) ??
        (singular(c.slug) === stem || c.slug === stem ? c.keyField ?? undefined : undefined);
      if (!matchField) continue;
      references.push({
        field: f.name,
        dataset: c.slug,
        datasetName: c.name,
        matchField,
        suggestedName: stem === f.name ? f.name : stem,
        reason: c.uniqueFields.includes(f.name)
          ? `"${f.name}" is the unique key of ${c.name}`
          : `"${f.name}" looks like a ${singular(c.slug).replace(/_/g, " ")} from ${c.name}`,
      });
    }
  }
  return { similar, references };
}
