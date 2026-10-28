import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Badge, Button, Card, Checkbox, ErrorState, Field, Input, Loading, Section, Select, Tabs, Textarea, cn } from "@commons/ui";
import { api, useApi, type ApiError } from "../api.ts";
import { PageFrame } from "../components/PageFrame.tsx";
import { VisibilityBadge, timeAgo } from "../components/bits.tsx";
import { VisibilityPicker } from "../components/VisibilityPicker.tsx";

interface Version {
  id: string;
  version: number;
  draft: boolean;
  status: "building" | "ready" | "failed";
  message: string | null;
  client: string | null;
  createdAt: string;
  createdBy: string;
  dependencies: { dataset: string; field: string }[];
}

interface PageDetail {
  id: string;
  slug: string;
  title: string;
  description: string;
  ownerName: string;
  teamId: string | null;
  teamName: string | null;
  visibility: "private" | "shared" | "department" | "company";
  departmentId: string | null;
  departmentName: string | null;
  allowWrites: boolean;
  publishedVersionId: string | null;
  publishedVersion: number | null;
  canEdit: boolean;
  updatedAt: string;
  versions: Version[];
}

export function PageView() {
  const { slug, version: v, tab = "view" } = useParams();
  const version = v ? Number(v) : undefined;
  const navigate = useNavigate();
  const { data: page, error, reload } = useApi<PageDetail>(`/pages/${slug}`);
  if (error) return <div className="mx-auto max-w-7xl p-8"><ErrorState error={error} retry={reload} /></div>;
  if (!page) return <div className="mx-auto max-w-7xl p-8"><Loading /></div>;

  const shown = version ?? page.publishedVersion ?? undefined;
  const base = `/pages/${page.slug}`;
  const isPreview = version !== undefined && version !== page.publishedVersion;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{page.title}</h1>
            <VisibilityBadge value={page.visibility} department={page.departmentName} />
            {isPreview && <Badge tone="warning">Previewing v{version}</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {page.description && <>{page.description} · </>}
            {page.teamName ?? page.ownerName} · {page.publishedVersion ? `v${page.publishedVersion} live` : "not published"} · updated {timeAgo(page.updatedAt)}
          </p>
        </div>
        {isPreview && page.canEdit && (
          <PublishButton slug={page.slug} version={version!} ready={page.versions.find((x) => x.version === version)?.status === "ready"} onDone={() => { void reload(); navigate(base); }} />
        )}
      </div>
      {page.canEdit && (
        <Tabs className="mb-4" value={tab} onChange={(t) => navigate(t === "view" ? (version ? `${base}/v/${version}` : base) : `${base}/${t}`)} tabs={[
          { id: "view", label: "Page" },
          { id: "versions", label: "Versions", count: page.versions.length },
          { id: "settings", label: "Settings" },
        ]} />
      )}
      {tab === "view" && (shown ? <PageFrame slug={page.slug} version={version} /> : (
        <Card><p className="text-sm text-muted-foreground">Nothing published yet. Push a version with the commons CLI, or check the Versions tab.</p></Card>
      ))}
      {tab === "versions" && <Versions page={page} onChange={reload} />}
      {tab === "settings" && <PageSettings page={page} onChange={reload} />}
    </div>
  );
}

function PublishButton({ slug, version, ready, onDone }: { slug: string; version: number; ready: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button variant="primary" disabled={!ready} loading={busy} onClick={async () => {
      setBusy(true);
      try { await api(`/pages/${slug}/publish`, { method: "POST", json: { version } }); onDone(); } finally { setBusy(false); }
    }}>Publish v{version}</Button>
  );
}

function Versions({ page, onChange }: { page: PageDetail; onChange: () => void }) {
  const [selected, setSelected] = useState(page.versions[0]?.version);
  const detail = useApi<{ files: Record<string, string>; log: string }>(selected ? `/pages/${page.slug}/versions/${selected}` : null);
  const [file, setFile] = useState("Page.tsx");
  const files = useMemo(() => Object.keys(detail.data?.files ?? {}).sort((a, b) => (a === "Page.tsx" ? -1 : b === "Page.tsx" ? 1 : a.localeCompare(b))), [detail.data]);
  const v = page.versions.find((x) => x.version === selected);
  if (!page.versions.length) return <Card><p className="text-sm text-muted-foreground">No versions yet.</p></Card>;

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      <Card padded={false} className="divide-y divide-border self-start overflow-hidden">
        {page.versions.map((x) => (
          <button key={x.id} onClick={() => setSelected(x.version)} className={cn("block w-full px-4 py-3 text-left hover:bg-muted/50", x.version === selected && "bg-muted")}>
            <div className="flex items-center gap-2">
              <span className="font-medium">v{x.version}</span>
              {x.id === page.publishedVersionId && <Badge tone="success">live</Badge>}
              {x.status === "failed" && <Badge tone="danger">failed</Badge>}
              {x.status === "building" && <Badge tone="primary">building</Badge>}
              {x.draft && <Badge>draft</Badge>}
              <span className="ml-auto text-xs text-muted-foreground">{timeAgo(x.createdAt)}</span>
            </div>
            <div className="mt-0.5 truncate text-[13px] text-muted-foreground">{x.message ?? "No message"}</div>
            <div className="text-xs text-muted-foreground">{x.createdBy}{x.client && x.client !== "web" ? ` via ${x.client}` : ""}</div>
          </button>
        ))}
      </Card>
      {v && (
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {v.status === "ready" && <Link to={`/pages/${page.slug}/v/${v.version}`}><Button>Preview v{v.version}</Button></Link>}
            {v.status === "ready" && v.id !== page.publishedVersionId && (
              <PublishButton slug={page.slug} version={v.version} ready onDone={onChange} />
            )}
          </div>
          {v.dependencies.length > 0 && (
            <Section title="Uses" description="Dataset fields this version reads. Owners are warned before changing them.">
              <div className="flex flex-wrap gap-1.5">
                {v.dependencies.map((d) => <Link key={d.dataset + d.field} to={`/datasets/${d.dataset}`}><Badge>{d.dataset}.{d.field}</Badge></Link>)}
              </div>
            </Section>
          )}
          {detail.data && (
            <Section title="Build log">
              <pre className={cn("overflow-x-auto whitespace-pre-wrap rounded-md p-3 font-mono text-xs", v.status === "failed" ? "bg-danger/5 text-danger" : "bg-muted")}>{detail.data.log}</pre>
            </Section>
          )}
          {detail.data && (
            <Section title="Source" actions={<Select className="w-56" value={file} options={files} onChange={(e) => setFile(e.target.value)} />}>
              <pre className="max-h-[600px] overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">{detail.data.files[file] ?? ""}</pre>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function PageSettings({ page, onChange }: { page: PageDetail; onChange: () => void }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ title: page.title, description: page.description, visibility: page.visibility, departmentId: page.departmentId, allowWrites: page.allowWrites });
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Section title="Details">
        <div className="grid gap-4">
          <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Description"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <VisibilityPicker value={{ visibility: form.visibility, departmentId: form.departmentId }} teamId={page.teamId}
            levels={["company", "department", "private"]} onChange={(v) => setForm({ ...form, ...v })} />
          <Checkbox checked={form.allowWrites} onChange={(v) => setForm({ ...form, allowWrites: v })}
            label={<span>Allow this page to change data <span className="text-muted-foreground">· viewers can then edit rows they have access to through it</span></span>} />
        </div>
      </Section>
      {error && <ErrorState error={error} />}
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={async () => {
          try { await api(`/pages/${page.slug}`, { method: "PATCH", json: form }); setSaved(true); setTimeout(() => setSaved(false), 2000); onChange(); } catch (e) { setError(e as ApiError); }
        }}>Save changes</Button>
        {saved && <span className="text-sm text-success">Saved</span>}
      </div>
      <Section title="Delete page">
        <Button variant="danger" onClick={async () => {
          if (!confirm(`Delete ${page.title} and all its versions?`)) return;
          await api(`/pages/${page.slug}`, { method: "DELETE" });
          navigate("/pages");
        }}>Delete {page.title}</Button>
      </Section>
    </div>
  );
}
