import { Link, useNavigate } from "react-router";
import { Button, DataTable, Page } from "@commons/ui";
import { useApi, type DatasetSummary } from "../api.ts";
import { VisibilityBadge, timeAgo } from "../components/bits.tsx";

export function DatasetList() {
  const { data, error, loading, reload } = useApi<DatasetSummary[]>("/datasets");
  const navigate = useNavigate();
  return (
    <Page title="Datasets" description="Everything you can see, across all teams."
      actions={<Link to="/datasets/new"><Button variant="primary">New dataset</Button></Link>}>
      <DataTable
        rows={data} loading={loading} error={error} onRetry={reload} searchable
        onRowClick={(d) => navigate(`/datasets/${d.slug}`)}
        columns={[
          { key: "name", render: (d) => <div><div className="font-medium">{d.name}</div><div className="text-xs text-muted-foreground line-clamp-1">{d.description}</div></div> },
          { key: "teamName", label: "Team", render: (d) => d.teamName ?? d.ownerName },
          { key: "visibility", render: (d) => <VisibilityBadge value={d.visibility} department={d.departmentName} /> },
          { key: "approxRows", label: "Rows", format: "integer" },
          { key: "usedByCount", label: "Used by", format: "integer" },
          { key: "updatedAt", label: "Updated", render: (d) => <span className="text-muted-foreground">{timeAgo(d.updatedAt)}</span> },
        ]}
      />
    </Page>
  );
}
