import { useMemo, useState, type ReactNode } from "react";
import {
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import { Button, EmptyState, ErrorState, Input, Loading, cn } from "./base.tsx";
import { formatValue, get, humanize, type Format } from "../format.ts";

export interface ColumnSpec<T = any> {
  /** Dotted path into the row, e.g. "city.name" */
  key: string;
  label?: ReactNode;
  format?: Format;
  render?: (row: T) => ReactNode;
  align?: "left" | "right";
  sortable?: boolean;
}

export interface DataTableProps<T> {
  rows: T[] | undefined;
  /** Strings are paths into each row; objects give labels, formats and custom cells */
  columns: (string | ColumnSpec<T>)[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  /** Show a search box that filters rows in the table */
  searchable?: boolean;
  pageSize?: number;
  emptyText?: ReactNode;
  /** Extra controls next to the search box */
  toolbar?: ReactNode;
  className?: string;
}

/** A sortable, searchable, paginated table. Pass rows from a query and the columns to show. */
export function DataTable<T>({ rows, columns, loading, error, onRetry, onRowClick, searchable, pageSize = 25, emptyText = "Nothing here yet", toolbar, className }: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filter, setFilter] = useState("");
  const specs = useMemo(() => columns.map((c) => (typeof c === "string" ? { key: c } : c)) as ColumnSpec<T>[], [columns]);

  const numeric = useMemo(() => {
    const sample = (rows ?? []).slice(0, 20);
    return new Set(specs.filter((s) => s.align === "right" || (!s.align && sample.length > 0 && sample.every((r) => { const v = get(r, s.key); return v == null || typeof v === "number"; }) && sample.some((r) => typeof get(r, s.key) === "number"))).map((s) => s.key));
  }, [rows, specs]);

  const defs = useMemo<ColumnDef<T>[]>(
    () =>
      specs.map((s) => ({
        id: s.key,
        accessorFn: (r) => get(r, s.key),
        header: () => s.label ?? humanize(s.key),
        enableSorting: s.sortable !== false,
        cell: (ctx) => (s.render ? s.render(ctx.row.original) : formatValue(ctx.getValue(), s.format)),
      })),
    [specs],
  );

  const table = useReactTable({
    data: rows ?? [],
    columns: defs,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    globalFilterFn: (row, _id, value) => {
      const q = String(value).toLowerCase();
      return specs.some((s) => String(get(row.original, s.key) ?? "").toLowerCase().includes(q));
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  if (error) return <ErrorState error={error} retry={onRetry} />;

  const total = table.getFilteredRowModel().rows.length;
  const { pageIndex } = table.getState().pagination;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {(searchable || toolbar) && (
        <div className="flex flex-wrap items-center gap-2">
          {searchable && <Input placeholder="Search…" value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-xs" />}
          <div className="ml-auto flex items-center gap-2">{toolbar}</div>
        </div>
      )}
      {loading && !rows ? (
        <Loading />
      ) : total === 0 ? (
        <EmptyState title={filter ? "No matching rows" : emptyText} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => {
                    const sorted = h.column.getIsSorted();
                    return (
                      <th key={h.id} scope="col"
                        className={cn("border-b border-border px-3 py-2 font-medium text-[13px] text-muted-foreground whitespace-nowrap", numeric.has(h.id) ? "text-right" : "text-left")}>
                        {h.column.getCanSort() ? (
                          <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={h.column.getToggleSortingHandler()}>
                            {flexRender(h.column.columnDef.header, h.getContext())}
                            <span className="text-[10px] w-2">{sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : ""}</span>
                          </button>
                        ) : flexRender(h.column.columnDef.header, h.getContext())}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody className={cn(loading && "opacity-60")}>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={cn("border-b border-border last:border-0", onRowClick && "cursor-pointer hover:bg-muted/50")}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className={cn("px-3 py-2 align-top", numeric.has(cell.column.id) && "text-right tabular-nums")}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between text-[13px] text-muted-foreground">
          <span>{pageIndex * table.getState().pagination.pageSize + 1}–{Math.min(total, (pageIndex + 1) * table.getState().pagination.pageSize)} of {total}</span>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>Previous</Button>
            <Button size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
