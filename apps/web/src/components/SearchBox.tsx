import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Input, cn } from "@commons/ui";
import { api } from "../api.ts";

interface Results {
  datasets: { slug: string; name: string; description: string }[];
  fields: { dataset: string; datasetName: string; name: string; label: string; type: string }[];
  pages: { slug: string; title: string }[];
}

/** Search across datasets, fields and pages. Press / to focus. */
export function SearchBox({ className, autoFocus, large }: { className?: string; autoFocus?: boolean; large?: boolean }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Results>();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    if (!large) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [large]);

  useEffect(() => {
    if (!q.trim()) return setResults(undefined);
    const t = setTimeout(() => api<Results>(`/search?q=${encodeURIComponent(q)}`).then((r) => { setResults(r); setActive(0); }), 150);
    return () => clearTimeout(t);
  }, [q]);

  const items = [
    ...(results?.datasets ?? []).map((d) => ({ key: `d:${d.slug}`, to: `/datasets/${d.slug}`, title: d.name, sub: d.description || d.slug, kind: "Dataset" })),
    ...(results?.fields ?? []).map((f) => ({ key: `f:${f.dataset}.${f.name}`, to: `/datasets/${f.dataset}/fields`, title: `${f.label}`, sub: `Field in ${f.datasetName} · ${f.type}`, kind: "Field" })),
    ...(results?.pages ?? []).map((p) => ({ key: `p:${p.slug}`, to: `/pages/${p.slug}`, title: p.title, sub: p.slug, kind: "Page" })),
  ];

  function go(to: string) {
    setOpen(false);
    setQ("");
    navigate(to);
  }

  return (
    <div className={cn("relative", className)}>
      <Input ref={input} value={q} autoFocus={autoFocus} placeholder={large ? "Search datasets, fields and pages…" : "Search  ( / )"}
        className={cn(large && "h-12 text-base px-4")}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === "Enter" && items[active]) go(items[active].to);
          if (e.key === "Escape") { setOpen(false); input.current?.blur(); }
        }} />
      {open && q && results && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-96 overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-lg">
          {items.length === 0 && <div className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches "{q}"</div>}
          {items.map((it, i) => (
            <button key={it.key} onMouseDown={() => go(it.to)} onMouseEnter={() => setActive(i)}
              className={cn("flex w-full items-start gap-3 px-3 py-2 text-left", i === active && "bg-muted")}>
              <span className="mt-0.5 w-14 shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{it.kind}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{it.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{it.sub}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
