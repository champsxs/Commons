import { useState, type ReactNode } from "react";
import { useCommonsQuery } from "../client.tsx";
import { listQuery, useDataset, type DatasetMeta } from "../dataset.ts";
import { Button, EmptyState, ErrorState, Loading, cn } from "./base.tsx";
import { FieldValue } from "./records.tsx";

const enumName = (ds: DatasetMeta, field: string) => {
  const f = ds.fields.find((x) => x.name === field);
  const col = f?.type === "reference" ? `${field}_id` : field;
  return col.toUpperCase();
};

/**
 * Every row of a dataset, paged and sorted on the server. Good for browsing large datasets;
 * for custom columns from your own query, use DataTable.
 */
export function DatasetTable({ dataset, pageSize = 50, onRowClick, fields, toolbar }: { dataset: string; pageSize?: number; onRowClick?: (row: any) => void; fields?: string[]; toolbar?: ReactNode }) {
  const { dataset: ds, error: dsError } = useDataset(dataset);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ field: string; dir: "ASC" | "DESC" } | null>(null);
  // Without a chosen sort, order by the key people know (e.g. store code) rather than internal ids
  const defaultSort = ds?.keyField ?? (ds?.displayField !== "id" ? ds?.displayField : undefined);
  const active = sort ?? (defaultSort ? { field: defaultSort, dir: "ASC" as const } : null);
  const orderBy = ds && active ? [`${enumName(ds, active.field)}_${active.dir}`, "PRIMARY_KEY_ASC"] : ["PRIMARY_KEY_ASC"];
  const q = ds?.graphql?.listField ? listQuery(ds) : null;
  const { data, error, loading, refetch } = useCommonsQuery(q, { first: pageSize, offset: page * pageSize, orderBy });

  if (dsError) return <ErrorState error={dsError} />;
  if (error) return <ErrorState error={error} retry={refetch} />;
  if (!ds || (loading && !data)) return <Loading rows={8} />;
  const conn = data?.[ds.graphql!.listField!];
  const rows: any[] = conn?.nodes ?? [];
  const total: number = conn?.totalCount ?? 0;
  const cols = ds.fields.filter((f) => (fields ? fields.includes(f.name) : !f.deprecated && f.type !== "json"));
  const numeric = (t: string) => t === "integer" || t === "number";

  return (
    <div className="flex flex-col gap-3">
      {toolbar && <div className="flex flex-wrap items-center justify-end gap-2">{toolbar}</div>}
      {total === 0 ? (
        <EmptyState title="No rows yet" description="Upload a file or add rows to get started." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {cols.map((f) => (
                  <th key={f.name} scope="col" className={cn("border-b border-border px-3 py-2 text-[13px] font-medium text-muted-foreground whitespace-nowrap", numeric(f.type) ? "text-right" : "text-left")}>
                    <button className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={() => {
                        setPage(0);
                        setSort(active?.field !== f.name ? { field: f.name, dir: "ASC" } : { field: f.name, dir: active.dir === "ASC" ? "DESC" : "ASC" });
                      }}>
                      {f.label}
                      <span className="w-2 text-[10px]">{active?.field === f.name ? (active.dir === "ASC" ? "▲" : "▼") : ""}</span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={cn(loading && "opacity-60")}>
              {rows.map((r) => (
                <tr key={r.id} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cn("border-b border-border last:border-0", onRowClick && "cursor-pointer hover:bg-muted/50")}>
                  {cols.map((f) => (
                    <td key={f.name} className={cn("px-3 py-2", numeric(f.type) && "text-right tabular-nums")} onClick={f.type === "reference" ? (e) => e.stopPropagation() : undefined}>
                      <FieldValue ds={ds} field={f} row={r} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > pageSize && (
        <div className="flex items-center justify-between text-[13px] text-muted-foreground">
          <span>{page * pageSize + 1}–{Math.min(total, (page + 1) * pageSize)} of {total.toLocaleString()}</span>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setPage((p) => p - 1)} disabled={page === 0}>Previous</Button>
            <Button size="sm" onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * pageSize >= total}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
