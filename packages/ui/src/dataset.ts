import { useEffect, useState } from "react";
import { fetchRegistry, useCommons, type CommonsError } from "./client.tsx";

export interface DatasetField {
  name: string;
  label: string;
  type: "text" | "integer" | "number" | "boolean" | "date" | "timestamp" | "json" | "reference";
  required: boolean;
  isUnique: boolean;
  description: string;
  deprecated: boolean;
}

export interface ReferenceInfo {
  dataset: string;
  datasetName: string;
  canView: boolean;
  matchField: string;
  labelField: string;
  graphql: { type: string; listField: string | null; byIdField: string | null; label: string; match: string } | null;
}

/** A dataset definition as returned by the registry, including its GraphQL names. */
export interface DatasetMeta {
  id: string;
  slug: string;
  name: string;
  description: string;
  keyField: string | null;
  displayField: string;
  visibility: "private" | "shared" | "department" | "company";
  canEdit: boolean;
  fields: DatasetField[];
  references: Record<string, ReferenceInfo>;
  graphql: {
    type: string;
    listField: string | null;
    orderBy: string | null;
    byIdField: string | null;
    fields: Record<string, string>;
    inputs: Record<string, string>;
    related: { field: string; type: string }[];
    mutations: { create: string | null; update: string | null; delete: string | null; inputField: string | null; patchField: string | null };
  } | null;
}

const cache = new Map<string, Promise<DatasetMeta>>();

/** Loads a dataset's definition (fields, references, GraphQL names). */
export function useDataset(slug: string | undefined) {
  const config = useCommons();
  const [state, setState] = useState<{ data?: DatasetMeta; error?: CommonsError }>({});
  useEffect(() => {
    if (!slug) return;
    const key = config.registryUrl + slug;
    if (!cache.has(key)) cache.set(key, fetchRegistry<DatasetMeta>(config, `/datasets/${slug}`));
    let live = true;
    cache.get(key)!.then(
      (data) => live && setState({ data }),
      (error) => {
        cache.delete(key);
        if (live) setState({ error });
      },
    );
    return () => {
      live = false;
    };
  }, [slug, config]);
  return { dataset: state.data, error: state.error, loading: !state.data && !state.error };
}

export function clearDatasetCache(slug?: string) {
  for (const k of cache.keys()) if (!slug || k.endsWith(slug)) cache.delete(k);
}

/** GraphQL selection for one row: its own fields plus id and label of each referenced row. */
export function rowSelection(ds: DatasetMeta, opts: { includeDeprecated?: boolean } = {}): string {
  const g = ds.graphql!;
  const parts = ["id"];
  for (const f of ds.fields) {
    if (f.deprecated && !opts.includeDeprecated) continue;
    const name = g.fields[f.name];
    if (!name) continue;
    if (f.type === "reference") {
      const ref = ds.references[f.name];
      const label = ref?.graphql?.label;
      parts.push(`${name} { id${label && label !== "id" ? ` ${label}` : ""} }`);
    } else parts.push(name);
  }
  parts.push("createdAt updatedAt");
  return parts.join(" ");
}

/** Query listing a dataset's rows. Variables: $first, $offset, $orderBy. */
export function listQuery(ds: DatasetMeta): string {
  const g = ds.graphql!;
  const orderType = `[${g.orderBy}!]`;
  return `query List($first: Int, $offset: Int, $orderBy: ${orderType}) {
  ${g.listField}(first: $first, offset: $offset, orderBy: $orderBy) {
    totalCount
    nodes { ${rowSelection(ds)} }
  }
}`;
}

/** Query fetching one row by id, with counts of rows in other datasets pointing to it. */
export function recordQuery(ds: DatasetMeta): string {
  const g = ds.graphql!;
  const related = g.related.map((r) => `${r.field} { totalCount }`).join(" ");
  return `query Record($id: UUID!) { ${g.byIdField}(id: $id) { ${rowSelection(ds, { includeDeprecated: true })} ${related} } }`;
}
