import { Link } from "react-router";
import { Button, Card, Grid, Loading } from "@commons/ui";
import { useApi, type DatasetSummary } from "../api.ts";
import { SearchBox } from "../components/SearchBox.tsx";
import { VisibilityBadge, timeAgo } from "../components/bits.tsx";
import { useMe } from "../main.tsx";

export function Home() {
  const { me } = useMe();
  const { data } = useApi<DatasetSummary[]>("/datasets");
  const recent = [...(data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <div className="mb-10 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Good to see you, {me.name.split(" ")[0]}</h1>
        <p className="mt-1.5 text-muted-foreground">Find the data you need before making your own. Someone may have it already.</p>
      </div>
      <SearchBox large autoFocus className="mx-auto max-w-2xl" />
      <div className="mt-12 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Recently updated</h2>
        <div className="flex gap-2">
          <Link to="/datasets"><Button size="sm" variant="ghost">All datasets</Button></Link>
          <Link to="/datasets/new"><Button size="sm" variant="primary">New dataset</Button></Link>
        </div>
      </div>
      <div className="mt-4">
        {!data ? <Loading /> : (
          <Grid cols={3}>
            {recent.map((d) => (
              <Link key={d.slug} to={`/datasets/${d.slug}`}>
                <Card className="h-full transition-shadow hover:shadow-md">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium">{d.name}</div>
                    <VisibilityBadge value={d.visibility} />
                  </div>
                  <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">{d.description || "No description"}</p>
                  <div className="mt-4 flex gap-3 text-xs text-muted-foreground">
                    <span>{d.approxRows.toLocaleString()} rows</span>
                    {d.usedByCount > 0 && <span>used by {d.usedByCount}</span>}
                    <span className="ml-auto">{timeAgo(d.updatedAt)}</span>
                  </div>
                </Card>
              </Link>
            ))}
          </Grid>
        )}
      </div>
    </div>
  );
}
