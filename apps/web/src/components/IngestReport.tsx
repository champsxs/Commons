import { Badge, Card } from "@commons/ui";

export interface IngestReport {
  status: "ok" | "failed" | "dry_run";
  message: string;
  rowsTotal: number;
  rowsWritten: number;
  rowsSkipped: number;
  errors: { row: number; field?: string; message: string }[];
  unresolved: Record<string, { count: number; values: string[]; target: string; matchField: string }>;
  ignoredColumns: string[];
  columnMapping: Record<string, string>;
}

export function IngestReportView({ report: r }: { report: IngestReport }) {
  const tone = r.status === "ok" ? "success" : r.status === "dry_run" ? "primary" : "danger";
  const label = r.status === "ok" ? "Uploaded" : r.status === "dry_run" ? "Check passed" : "Not uploaded";
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={tone}>{label}</Badge>
        <span className="text-sm">{r.message}</span>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-4 text-sm sm:max-w-md">
        <div><dt className="text-xs text-muted-foreground">Rows in file</dt><dd className="font-semibold tabular-nums">{r.rowsTotal.toLocaleString()}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{r.status === "dry_run" ? "Would write" : "Written"}</dt><dd className="font-semibold tabular-nums">{r.rowsWritten.toLocaleString()}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Skipped</dt><dd className="font-semibold tabular-nums">{r.rowsSkipped.toLocaleString()}</dd></div>
      </dl>
      {Object.entries(r.unresolved).map(([field, u]) => (
        <div key={field} className="mt-4 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
          <div className="font-medium">{u.count} row(s) point to unknown {u.target}</div>
          <div className="mt-1 text-[13px] text-muted-foreground">
            No {u.target} with {u.matchField}: {u.values.map((v) => <code key={v} className="mx-0.5 rounded bg-muted px-1 font-mono text-xs">{v}</code>)}
          </div>
        </div>
      ))}
      {r.errors.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Problems</div>
          <ul className="max-h-60 overflow-y-auto rounded-md border border-border text-[13px]">
            {r.errors.map((e, i) => (
              <li key={i} className="flex gap-3 border-b border-border px-3 py-1.5 last:border-0">
                <span className="w-14 shrink-0 text-muted-foreground tabular-nums">Row {e.row}</span>
                {e.field && <code className="font-mono text-xs">{e.field}</code>}
                <span>{e.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(r.ignoredColumns.length > 0 || Object.keys(r.columnMapping).length > 0) && (
        <div className="mt-4 text-[13px] text-muted-foreground">
          {Object.entries(r.columnMapping).filter(([f, h]) => f !== h).map(([f, h]) => <span key={f} className="mr-3">"{h}" → {f}</span>)}
          {r.ignoredColumns.length > 0 && <span>Ignored columns: {r.ignoredColumns.join(", ")}</span>}
        </div>
      )}
    </Card>
  );
}
