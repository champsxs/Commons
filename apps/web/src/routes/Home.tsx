import type { ReactNode } from "react";
import { Link } from "react-router";
import { Badge, Button, EmptyState, Skeleton } from "@commons/ui";
import { useApi, type DatasetSummary } from "../api.ts";
import { SearchBox } from "../components/SearchBox.tsx";
import { VisibilityBadge, timeAgo, visibilityLabel } from "../components/bits.tsx";
import { useMe } from "../main.tsx";

interface PageSummary {
  slug: string;
  title: string;
  description: string;
  visibility: "private" | "shared" | "department" | "company";
  departmentName: string | null;
  updatedAt: string;
  ownerName: string;
  teamName: string | null;
  publishedVersion: number | null;
  latestVersion: number | null;
}

const RECENT = 6;
const byUpdated = <T extends { updatedAt: string }>(items: T[] | undefined) =>
  [...(items ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, RECENT);

export function Home() {
  const { me } = useMe();
  const datasets = useApi<DatasetSummary[]>("/datasets");
  const pages = useApi<PageSummary[]>("/pages");

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Good to see you, {me.name.split(" ")[0]}</h1>
        <p className="mt-1.5 text-muted-foreground">Find the data and pages you need before making your own. Someone may have them already.</p>
      </div>
      <SearchBox large autoFocus className="mx-auto max-w-2xl" />

      <div className="mt-12 grid gap-8 lg:grid-cols-2">
        <Column
          title="Recently updated datasets"
          actions={<>
            <Link to="/datasets"><Button size="sm" variant="ghost">All datasets</Button></Link>
            <Link to="/datasets/new"><Button size="sm">New dataset</Button></Link>
          </>}
          loading={!datasets.data && !datasets.error}
          empty={<EmptyState title="No datasets yet" description="Create one from a file or by listing its fields."
            action={<Link to="/datasets/new"><Button size="sm" variant="primary">New dataset</Button></Link>} />}>
          {byUpdated(datasets.data).map((d) => (
            <Row key={d.slug} to={`/datasets/${d.slug}`} title={d.name} badge={<VisibilityBadge value={d.visibility} department={d.departmentName} />}
              description={d.description || "No description"}
              meta={[`${d.approxRows.toLocaleString()} rows`, d.usedByCount > 0 ? `used by ${d.usedByCount}` : null, d.teamName ?? d.ownerName]}
              time={d.updatedAt} />
          ))}
        </Column>

        <Column
          title="Recent pages"
          actions={<>
            <Link to="/pages"><Button size="sm" variant="ghost">All pages</Button></Link>
            <Link to="/pages?new=1"><Button size="sm">New page</Button></Link>
          </>}
          loading={!pages.data && !pages.error}
          empty={<EmptyState title="No pages yet" description="Pages are dashboards and tools built on Commons data, often by a coding agent."
            action={<Link to="/help/pages"><Button size="sm">How pages work</Button></Link>} />}>
          {byUpdated(pages.data).map((p) => (
            <Row key={p.slug} to={`/pages/${p.slug}`} title={p.title}
              badge={p.publishedVersion ? <Badge tone="success">v{p.publishedVersion} live</Badge> : <Badge>draft</Badge>}
              description={p.description || p.slug}
              meta={[p.teamName ?? p.ownerName, visibilityLabel(p.visibility, p.departmentName),
                p.latestVersion && p.latestVersion !== p.publishedVersion ? `v${p.latestVersion} in progress` : null]}
              time={p.updatedAt} />
          ))}
        </Column>
      </div>
    </div>
  );
}

function Column({ title, actions, loading, empty, children }: { title: string; actions: ReactNode; loading: boolean; empty: ReactNode; children: ReactNode[] }) {
  return (
    <section className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="flex gap-2">{actions}</div>
      </div>
      {loading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[74px]" />)}</div>
      ) : children.length === 0 ? (
        empty
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-xs">{children}</div>
      )}
    </section>
  );
}

function Row({ to, title, badge, description, meta, time }: { to: string; title: string; badge: ReactNode; description: string; meta: (string | null | undefined)[]; time: string }) {
  return (
    <Link to={to} className="block px-4 py-3 transition-colors hover:bg-muted/50">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate font-medium">{title}</span>
        {badge}
      </div>
      <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{description}</p>
      <div className="mt-1.5 flex gap-3 text-xs text-muted-foreground">
        {meta.filter(Boolean).map((m) => <span key={m}>{m}</span>)}
        <span className="ml-auto whitespace-nowrap">{timeAgo(time)}</span>
      </div>
    </Link>
  );
}
