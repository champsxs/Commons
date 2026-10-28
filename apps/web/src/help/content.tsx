import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "@commons/ui";

/** Building blocks for help sections, so every section reads and looks the same. */

export function H2({ id, children }: { id?: string; children: ReactNode }) {
  return <h2 id={id} className="mt-10 scroll-mt-20 text-base font-semibold first:mt-0">{children}</h2>;
}

export function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-6 text-sm font-semibold">{children}</h3>;
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-sm leading-relaxed text-foreground/90">{children}</p>;
}

export function List({ children, ordered }: { children: ReactNode; ordered?: boolean }) {
  const Tag = ordered ? "ol" : "ul";
  return <Tag className={cn("mt-3 flex flex-col gap-1.5 pl-5 text-sm leading-relaxed", ordered ? "list-decimal" : "list-disc")}>{children}</Tag>;
}

export function C({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12.5px]">{children}</code>;
}

/** A command or code sample with a copy button. */
export function Code({ children, label }: { children: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 overflow-hidden rounded-md border border-border bg-muted/60">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-1">
        <span className="text-xs text-muted-foreground">{label ?? "Terminal"}</span>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(children);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-surface hover:text-foreground">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[12.5px] leading-relaxed">{children}</pre>
    </div>
  );
}

export function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warning" }) {
  return (
    <div className={cn("mt-4 rounded-md border px-4 py-3 text-sm leading-relaxed",
      tone === "warning" ? "border-warning/40 bg-warning/5" : "border-primary/25 bg-accent/40")}>
      {children}
    </div>
  );
}

export function Table({ head, rows }: { head: ReactNode[]; rows: ReactNode[][] }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-[13px] text-muted-foreground">
          <tr>{head.map((h, i) => <th key={i} className="px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border align-top">
              {r.map((c, j) => <td key={j} className="px-3 py-2">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Link to another help section, optionally to a heading in it. */
export function HelpLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={`/help/${to}`} className="text-primary hover:underline">{children}</Link>;
}

export function AppLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className="text-primary hover:underline">{children}</Link>;
}
