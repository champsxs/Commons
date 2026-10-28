import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, useLocation, useParams } from "react-router";
import { Card, ErrorState, Input, Loading, cn } from "@commons/ui";
import { useApi } from "../api.ts";
import { Markdown } from "../help/Markdown.tsx";

interface Topic {
  id: string;
  title: string;
  summary: string;
  group: string;
  keywords: string;
}

export function Help() {
  const { section } = useParams();
  const index = useApi<{ groups: string[]; topics: Topic[] }>("/help");
  const GROUPS = index.data?.groups ?? [];
  const HELP_SECTIONS = useMemo(() => index.data?.topics ?? [], [index.data]);
  const current = HELP_SECTIONS.find((s) => s.id === section);
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return HELP_SECTIONS;
    return HELP_SECTIONS.filter((s) => `${s.title} ${s.summary} ${s.keywords ?? ""}`.toLowerCase().includes(q));
  }, [filter, HELP_SECTIONS]);

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-8 sm:px-6 md:grid-cols-[220px_1fr] lg:px-8">
      <aside className="md:sticky md:top-20 md:self-start">
        <Link to="/help" className="text-sm font-semibold">Help</Link>
        <Input className="mt-3" placeholder="Filter topics" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <nav className="mt-4 flex flex-col gap-4">
          {GROUPS.map((g) => {
            const items = shown.filter((s) => s.group === g);
            if (!items.length) return null;
            return (
              <div key={g}>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{g}</div>
                {items.map((s) => (
                  <NavLink key={s.id} to={`/help/${s.id}`}
                    className={({ isActive }) => cn("block rounded-md px-2 py-1 text-sm", isActive ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>
                    {s.title}
                  </NavLink>
                ))}
              </div>
            );
          })}
          {shown.length === 0 && <p className="text-sm text-muted-foreground">No topics match.</p>}
        </nav>
      </aside>

      <main className="min-w-0">
        {current ? (
          <article className="max-w-3xl">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{current.group}</div>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">{current.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{current.summary}</p>
            <div className="mt-6 border-t border-border pt-6">
              <TopicBody id={current.id} />
            </div>
            <Pager id={current.id} sections={HELP_SECTIONS} />
          </article>
        ) : section && index.data ? (
          <p className="text-sm text-muted-foreground">There's no help topic called "{section}". Pick one from the list.</p>
        ) : (
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Help</h1>
            <p className="mt-1 text-sm text-muted-foreground">How Commons works, and how to use it from the app, the command line and coding agents.</p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {shown.map((s) => (
                <Link key={s.id} to={`/help/${s.id}`}>
                  <Card className="h-full transition-shadow hover:shadow-md">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{s.group}</div>
                    <div className="mt-1 font-medium">{s.title}</div>
                    <p className="mt-1 text-[13px] text-muted-foreground">{s.summary}</p>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function TopicBody({ id }: { id: string }) {
  const { data, error } = useApi<{ markdown: string }>(`/help/${id}`);
  const { hash } = useLocation();
  // Jump to /help/topic#heading once the text has loaded
  useEffect(() => {
    if (data && hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  }, [data, hash]);
  if (error) return <ErrorState error={error} />;
  if (!data) return <Loading rows={6} />;
  return <Markdown>{data.markdown}</Markdown>;
}

function Pager({ id, sections: HELP_SECTIONS }: { id: string; sections: { id: string; title: string }[] }) {
  const i = HELP_SECTIONS.findIndex((s) => s.id === id);
  const prev = HELP_SECTIONS[i - 1];
  const next = HELP_SECTIONS[i + 1];
  return (
    <div className="mt-12 flex justify-between gap-4 border-t border-border pt-4 text-sm">
      {prev ? <Link to={`/help/${prev.id}`} className="text-muted-foreground hover:text-foreground">← {prev.title}</Link> : <span />}
      {next && <Link to={`/help/${next.id}`} className="text-muted-foreground hover:text-foreground">{next.title} →</Link>}
    </div>
  );
}
