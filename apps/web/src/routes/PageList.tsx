import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Badge, Button, Checkbox, DataTable, Dialog, ErrorState, Field, Input, Page, Section } from "@commons/ui";
import { api, useApi, type ApiError } from "../api.ts";
import { VisibilityBadge, timeAgo } from "../components/bits.tsx";

export function PageList() {
  const { data, loading, error, reload } = useApi<any[]>("/pages");
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <Page title="Pages" description="Dashboards and tools built on Commons data, by people and their coding agents."
      actions={<Button variant="primary" onClick={() => setOpen(true)}>New page</Button>}>
      <DataTable rows={data} loading={loading} error={error} onRetry={reload} searchable emptyText="No pages yet"
        onRowClick={(p) => navigate(`/pages/${p.slug}`)}
        columns={[
          { key: "title", render: (p) => <div><div className="font-medium">{p.title}</div><div className="text-xs text-muted-foreground">{p.description || p.slug}</div></div> },
          { key: "teamName", label: "Team", render: (p) => p.teamName ?? p.ownerName },
          { key: "visibility", render: (p) => <VisibilityBadge value={p.visibility} /> },
          { key: "publishedVersion", label: "Status", render: (p) => p.publishedVersion ? <Badge tone="success">v{p.publishedVersion} live</Badge> : <Badge>draft</Badge> },
          { key: "updatedAt", label: "Updated", render: (p) => <span className="text-muted-foreground">{timeAgo(p.updatedAt)}</span> },
        ]} />
      <Section title="Build pages with your coding agent"
        description="Claude Code, Codex or any other coding agent can explore the data and write pages for you.">
        <div className="flex flex-wrap gap-2">
          <Link to="/help/mcp"><Button size="sm">Connect an agent (MCP)</Button></Link>
          <Link to="/help/cli"><Button size="sm">Set up the CLI</Button></Link>
          <Link to="/help/pages"><Button size="sm" variant="ghost">How pages work</Button></Link>
        </div>
      </Section>
      <NewPageDialog open={open} onClose={() => setOpen(false)} onCreated={(slug) => navigate(`/pages/${slug}`)} />
    </Page>
  );
}

function NewPageDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (slug: string) => void }) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [fromTemplate, setFromTemplate] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const autoSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  async function create() {
    setBusy(true);
    setError(null);
    try {
      const p = await api<{ slug: string }>("/pages", { method: "POST", json: { title, slug: slug || autoSlug, fromTemplate } });
      onCreated(p.slug);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title="New page"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!title} onClick={create}>Create page</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Title"><Input value={title} autoFocus onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Store performance" /></Field>
        <Field label="Address" hint={`/pages/${slug || autoSlug || "…"}`}><Input value={slug} placeholder={autoSlug} onChange={(e) => setSlug(e.target.value)} /></Field>
        <Checkbox label="Start from the starter page" checked={fromTemplate} onChange={setFromTemplate} />
        {error && <ErrorState error={error} />}
      </div>
    </Dialog>
  );
}
