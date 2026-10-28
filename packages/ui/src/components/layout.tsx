import type { ReactNode } from "react";
import { cn } from "./base.tsx";
import { formatValue, type Format } from "../format.ts";

/** The top-level wrapper for a page: title, optional description and actions. */
export function Page({ title, description, actions, children, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8", className)}>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>
      <div className="flex flex-col gap-6">{children}</div>
    </div>
  );
}

/** A titled block within a page. */
export function Section({ title, description, actions, children, className, card = true }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; card?: boolean }) {
  return (
    <section className={cn(card && "rounded-lg border border-border bg-surface p-5 shadow-xs", className)}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

const colClasses: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-2 lg:grid-cols-5",
  6: "grid-cols-2 md:grid-cols-3 lg:grid-cols-6",
};

/** Responsive grid. Collapses to fewer columns on small screens. */
export function Grid({ cols = 3, children, className }: { cols?: 1 | 2 | 3 | 4 | 5 | 6; children: ReactNode; className?: string }) {
  return <div className={cn("grid gap-4", colClasses[cols], className)}>{children}</div>;
}

/** A single headline number. `delta` is a fraction, e.g. 0.12 for +12%. */
export function Stat({ label, value, format, delta, hint, loading }: { label: ReactNode; value: unknown; format?: Format; delta?: number | null; hint?: ReactNode; loading?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-5 py-4 shadow-xs">
      <div className="text-[13px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-2">
        {loading ? (
          <div className="h-8 w-24 animate-pulse rounded bg-muted" />
        ) : (
          <span className="text-2xl font-semibold tabular-nums tracking-tight">{value == null ? "–" : formatValue(value, format)}</span>
        )}
        {delta != null && !loading && (
          <span className={cn("text-xs font-medium tabular-nums", delta >= 0 ? "text-success" : "text-danger")}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta * 100).toFixed(1)}%
          </span>
        )}
      </div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
