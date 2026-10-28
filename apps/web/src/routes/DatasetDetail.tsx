import { Fragment, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  Badge, Button, Card, Checkbox, DatasetTable, Dialog, ErrorState, Field, Input, Loading, Page, RecordForm, Section, Select, Tabs,
  Textarea, clearDatasetCache, listQuery, type DatasetMeta,
} from "@commons/ui";
import { api, upload, useApi, type ApiError, type DatasetSummary } from "../api.ts";
import { TYPE_LABELS, VisibilityBadge, timeAgo, visibilityOptions } from "../components/bits.tsx";
import { IngestReportView, type IngestReport } from "../components/IngestReport.tsx";
import { FieldRow, type FieldDraft } from "./NewDataset.tsx";
import { useMe } from "../main.tsx";

type Detail = Omit<DatasetMeta, "fields"> & {
  ownerName: string; teamId: string | null; teamName: string | null; license: string | null; source: string | null;
  referenceable: boolean; rowCount: number; updatedAt: string; createdAt: string;
  shares: { teamId: string | null; userId: string | null; name: string; canEdit: boolean }[];
  fields: (DatasetMeta["fields"][number] & { reference?: { toSlug: string; toField: string; onDelete: string; unresolved: string } })[];
};

export function DatasetDetail() {
  const { slug, tab = "data" } = useParams();
  const navigate = useNavigate();
  const { data: ds, error, reload } = useApi<Detail>(`/datasets/${slug}`);
  const usage = useApi<{ datasets: any[]; pages: any[] }>(`/datasets/${slug}/usage`);
  const [adding, setAdding] = useState(false);
  const [version, setVersion] = useState(0);

  if (error) return <Page title="Dataset"><ErrorState error={error} retry={reload} /></Page>;
  if (!ds) return <Page title=""><Loading rows={8} /></Page>;

  const refresh = () => {
    clearDatasetCache(ds.slug);
    void reload();
    void usage.reload();
    setVersion((v) => v + 1);
  };
  const usedBy = (usage.data?.datasets.length ?? 0) + (usage.data?.pages.length ?? 0);

  return (
    <Page
      title={<span className="flex flex-wrap items-center gap-3">{ds.name}<VisibilityBadge value={ds.visibility} /></span>}
      description={
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          {ds.description && <span className="w-full">{ds.description}</span>}
          <span>{ds.teamName ?? ds.ownerName}</span>
          <span>{ds.rowCount.toLocaleString()} rows</span>
          <span>updated {timeAgo(ds.updatedAt)}</span>
          {ds.source && <span>source: {ds.source}</span>}
          {ds.license && <span>license: {ds.license}</span>}
        </span>
      }
      actions={ds.canEdit && (
        <>
          <Button onClick={() => navigate(`/datasets/${ds.slug}/upload`)}>Upload</Button>
          <Button variant="primary" onClick={() => setAdding(true)}>Add row</Button>
        </>
      )}>
      <Tabs value={tab} onChange={(t) => navigate(`/datasets/${ds.slug}${t === "data" ? "" : `/${t}`}`)} tabs={[
        { id: "data", label: "Data", count: ds.rowCount },
        { id: "fields", label: "Fields", count: ds.fields.length },
        ...(ds.canEdit ? [{ id: "upload", label: "Upload" }] : []),
        { id: "usage", label: "Used by", count: usedBy },
        { id: "api", label: "API" },
        ...(ds.canEdit ? [{ id: "settings", label: "Settings" }] : []),
      ]} />

      {tab === "data" && (
        <DatasetTable key={version} dataset={ds.slug} onRowClick={(r) => navigate(`/datasets/${ds.slug}/records/${r.id}`)} />
      )}
      {tab === "fields" && <FieldsTab ds={ds} onChange={refresh} />}
      {tab === "upload" && <UploadTab ds={ds} onUploaded={refresh} />}
      {tab === "usage" && <UsageTab usage={usage.data} />}
      {tab === "api" && <ApiTab ds={ds} />}
      {tab === "settings" && <SettingsTab ds={ds} onChange={refresh} />}

      <Dialog open={adding} onClose={() => setAdding(false)} title={`Add to ${ds.name}`} wide>
        <RecordForm dataset={ds.slug} onCancel={() => setAdding(false)} onSaved={(r) => { setAdding(false); navigate(`/datasets/${ds.slug}/records/${r.id}`); }} />
      </Dialog>
    </Page>
  );
}

function FieldsTab({ ds, onChange }: { ds: Detail; onChange: () => void }) {
  const [adding, setAdding] = useState<FieldDraft | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: datasets } = useApi<DatasetSummary[]>(adding ? "/datasets" : null);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      onChange();
      setAdding(null);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorState error={error} />}
      <Card padded={false} className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-[13px] text-muted-foreground">
            <tr><th className="px-4 py-2 font-medium">Field</th><th className="px-4 py-2 font-medium">Type</th><th className="px-4 py-2 font-medium">Description</th>{ds.canEdit && <th />}</tr>
          </thead>
          <tbody>
            {ds.fields.map((f) => (
              <tr key={f.name} className="border-t border-border align-top">
                <td className="px-4 py-2.5">
                  <div className="font-medium">{f.label}</div>
                  <code className="font-mono text-xs text-muted-foreground">{f.name}</code>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {ds.keyField === f.name && <Badge tone="primary">key</Badge>}
                    {f.required && ds.keyField !== f.name && <Badge>required</Badge>}
                    {f.isUnique && ds.keyField !== f.name && <Badge>unique</Badge>}
                    {f.deprecated && <Badge tone="warning">deprecated</Badge>}
                  </div>
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  {TYPE_LABELS[f.type]}
                  {f.reference && (
                    <div className="text-xs text-muted-foreground">
                      → <Link className="text-primary hover:underline" to={`/datasets/${f.reference.toSlug}`}>{ds.references[f.name]?.datasetName ?? f.reference.toSlug}</Link> by {f.reference.toField}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {ds.canEdit ? <EditableDescription ds={ds} field={f.name} value={f.description} onSaved={onChange} /> : f.description || "–"}
                </td>
                {ds.canEdit && (
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" disabled={busy}
                      onClick={() => act(() => api(`/datasets/${ds.slug}/fields/${f.name}`, { method: "PATCH", json: { deprecated: !f.deprecated } }))}>
                      {f.deprecated ? "Restore" : "Deprecate"}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy}
                      onClick={() => confirm(`Remove "${f.label}" and all its values? This can't be undone.`) && act(() => api(`/datasets/${ds.slug}/fields/${f.name}`, { method: "DELETE" }))}>
                      Remove
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {ds.canEdit && !adding && <div><Button onClick={() => setAdding({ key: "new", name: "", type: "text", required: false, unique: false, description: "" })}>Add field</Button></div>}
      {adding && (
        <Section title="New field" description={<>New fields start empty. To rename a field, add the new one and deprecate the old one so nothing that uses it breaks. <Link to="/help/datasets" className="text-primary hover:underline">More about fields</Link></>}>
          <FieldRow field={adding} datasets={(datasets ?? []).filter((d) => d.slug !== ds.slug)} onChange={(p) => setAdding({ ...adding, ...p })} />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAdding(null)}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={!adding.name}
              onClick={() => act(() => api(`/datasets/${ds.slug}/fields`, { method: "POST", json: { ...adding, key: undefined, examples: undefined, reference: adding.type === "reference" ? adding.reference : undefined } }))}>
              Add field
            </Button>
          </div>
        </Section>
      )}
    </div>
  );
}

function EditableDescription({ ds, field, value, onSaved }: { ds: Detail; field: string; value: string; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  if (!editing) return <button className="text-left hover:text-foreground" onClick={() => setEditing(true)}>{value || <span className="italic">Add a description</span>}</button>;
  return (
    <div className="flex flex-col gap-2">
      <Textarea value={text} autoFocus onChange={(e) => setText(e.target.value)} className="min-h-14" />
      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={async () => { await api(`/datasets/${ds.slug}/fields/${field}`, { method: "PATCH", json: { description: text } }); setEditing(false); onSaved(); }}>Save</Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    </div>
  );
}

function UploadTab({ ds, onUploaded }: { ds: Detail; onUploaded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState("append");
  const [onError, setOnError] = useState("reject");
  const [unresolved, setUnresolved] = useState("");
  const [report, setReport] = useState<IngestReport | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<"check" | "upload" | null>(null);
  const history = useApi<any[]>(`/datasets/${ds.slug}/ingests`);
  const hasRefs = ds.fields.some((f) => f.type === "reference");

  async function run(dryRun: boolean) {
    if (!file) return;
    setBusy(dryRun ? "check" : "upload");
    setError(null);
    try {
      const r = await upload<IngestReport>(`/datasets/${ds.slug}/ingest`, file, { mode, onError, unresolved, dryRun: String(dryRun) });
      setReport(r);
      if (!dryRun && r.status === "ok") onUploaded();
      void history.reload();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <Section title="Upload a file"
        description={<>CSV, JSON or JSON Lines. Columns are matched to fields by name{hasRefs ? "; references by their key, e.g. a city code" : ""}. <Link to="/help/uploading" className="text-primary hover:underline">How the modes treat existing rows</Link></>}>
        <div className="flex flex-col gap-4">
          <Input type="file" accept=".csv,.json,.jsonl,.ndjson" className="py-1.5 h-auto" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); }} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mode">
              <Select value={mode} onChange={(e) => setMode(e.target.value)} options={[
                { value: "append", label: "Add rows" },
                ...(ds.keyField ? [{ value: "upsert", label: `Add or update (by ${ds.keyField})` }] : []),
                { value: "replace", label: "Replace all rows" },
              ]} />
            </Field>
            <Field label="Rows with bad values">
              <Select value={onError} onChange={(e) => setOnError(e.target.value)} options={[{ value: "reject", label: "Reject the upload" }, { value: "skip", label: "Skip them" }]} />
            </Field>
            {hasRefs && (
              <Field label="Unknown references">
                <Select value={unresolved} onChange={(e) => setUnresolved(e.target.value)} placeholder="Use each field's setting"
                  options={[{ value: "reject", label: "Reject the upload" }, { value: "skip", label: "Skip those rows" }, { value: "null", label: "Leave empty" }]} />
              </Field>
            )}
          </div>
          <div className="flex gap-2">
            <Button disabled={!file} loading={busy === "check"} onClick={() => run(true)}>Check file</Button>
            <Button variant="primary" disabled={!file} loading={busy === "upload"} onClick={() => run(false)}>Upload</Button>
          </div>
          {error && <ErrorState error={error} />}
        </div>
      </Section>
      <div className="flex flex-col gap-4">
        {report && <IngestReportView report={report} />}
        <Section title="History">
          {!history.data?.length ? <p className="text-sm text-muted-foreground">No uploads yet.</p> : (
            <ul className="flex flex-col divide-y divide-border text-sm">
              {history.data.map((h) => (
                <li key={h.id} className="flex items-center gap-3 py-2">
                  <Badge tone={h.status === "ok" ? "success" : "danger"}>{h.status === "ok" ? "ok" : "failed"}</Badge>
                  <span className="min-w-0 flex-1 truncate">{h.filename ?? "upload"} · {h.mode} · {h.rows_inserted.toLocaleString()} rows</span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{h.user_name} · {timeAgo(h.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function UsageTab({ usage }: { usage?: { datasets: any[]; pages: any[] } }) {
  if (!usage) return <Loading />;
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Section title="Datasets that reference this" description="Changing or removing the fields they match on is blocked.">
        {usage.datasets.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
          <ul className="flex flex-col gap-2 text-sm">
            {usage.datasets.map((d) => (
              <li key={d.slug + d.field}>
                <Link to={`/datasets/${d.slug}`} className="font-medium text-primary hover:underline">{d.slug}</Link>
                <span className="text-muted-foreground"> · field <code className="font-mono text-xs">{d.field}</code> matches on <code className="font-mono text-xs">{d.matchField}</code></span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Pages using this">
        {usage.pages.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : (
          <ul className="flex flex-col gap-2 text-sm">
            {usage.pages.map((p) => <li key={p.id}><Link to={`/pages/${p.slug}`} className="font-medium text-primary hover:underline">{p.title}</Link> <span className="text-muted-foreground">· {p.fields.join(", ")}</span></li>)}
          </ul>
        )}
      </Section>
    </div>
  );
}

function ApiTab({ ds }: { ds: Detail }) {
  const g = ds.graphql;
  if (!g) return <ErrorState error="GraphQL names not available yet" />;
  const example = listQuery(ds).replace("query List(", `query ${g.type}List(`);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title="Query it with GraphQL" description="Every request runs with your permissions." actions={<a href="/graphiql" target="_blank" rel="noreferrer"><Button size="sm">Open GraphiQL</Button></a>}>
        <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">{example}</pre>
      </Section>
      <Section title="Names">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Type</dt><dd><code className="font-mono">{g.type}</code></dd>
          <dt className="text-muted-foreground">List</dt><dd><code className="font-mono">{g.listField}</code></dd>
          <dt className="text-muted-foreground">One row</dt><dd><code className="font-mono">{g.byIdField}(id:)</code></dd>
          {g.related.map((r) => <Fragment key={r.field}><dt className="text-muted-foreground">Referenced by</dt><dd><code className="font-mono">{r.field}</code> ({r.type})</dd></Fragment>)}
          {ds.fields.map((f) => <Fragment key={f.name}><dt className="text-muted-foreground">{f.label}</dt><dd><code className="font-mono">{g.fields[f.name]}</code></dd></Fragment>)}
        </dl>
      </Section>
    </div>
  );
}

function SettingsTab({ ds, onChange }: { ds: Detail; onChange: () => void }) {
  const { me } = useMe();
  const navigate = useNavigate();
  const teams = useApi<{ id: string; name: string }[]>("/teams");
  const users = useApi<{ id: string; name: string; email: string }[]>("/users");
  const [form, setForm] = useState({ name: ds.name, description: ds.description, visibility: ds.visibility, teamId: ds.teamId ?? "", referenceable: ds.referenceable, source: ds.source ?? "", license: ds.license ?? "" });
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  const [shareWith, setShareWith] = useState("");

  async function save(extra: object = {}) {
    setError(null);
    try {
      await api(`/datasets/${ds.slug}`, { method: "PATCH", json: { ...form, teamId: form.teamId || null, ...extra } });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onChange();
    } catch (e) {
      setError(e as ApiError);
    }
  }

  async function remove() {
    if (!confirm(`Delete ${ds.name} and all its rows? This can't be undone.`)) return;
    try {
      await api(`/datasets/${ds.slug}`, { method: "DELETE" });
      navigate("/datasets");
    } catch (e) {
      setError(e as ApiError);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Section title="Details">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Team"><Select value={form.teamId} placeholder="No team" options={(teams.data ?? []).map((t) => ({ value: t.id, label: t.name }))} onChange={(e) => setForm({ ...form, teamId: e.target.value })} /></Field>
          <Field label="Description" className="sm:col-span-2"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label="Source" hint="Where the data comes from"><Input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} /></Field>
          <Field label="License"><Input value={form.license} onChange={(e) => setForm({ ...form, license: e.target.value })} /></Field>
        </div>
      </Section>
      <Section title="Access">
        <div className="flex flex-col gap-4">
          <Field label="Who can see it">
            <Select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as any })} options={visibilityOptions()} />
          </Field>
          <Checkbox label="Other datasets may reference this one" checked={form.referenceable} onChange={(v) => setForm({ ...form, referenceable: v })} />
          {form.visibility === "shared" && (
            <Field label="Share with" hint="Shares take effect when you save.">
              <div className="flex gap-2">
                <Select value={shareWith} placeholder="Choose a person or team" onChange={(e) => setShareWith(e.target.value)} options={[
                  ...(teams.data ?? []).map((t) => ({ value: `team:${t.id}`, label: `Team: ${t.name}` })),
                  ...(users.data ?? []).filter((u) => u.id !== me.id).map((u) => ({ value: `user:${u.id}`, label: u.name })),
                ]} />
                <Button disabled={!shareWith} onClick={() => {
                  const [kind, id] = shareWith.split(":");
                  void save({ shares: [...ds.shares, { [kind === "team" ? "teamId" : "userId"]: id }] });
                  setShareWith("");
                }}>Share</Button>
              </div>
              {ds.shares.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {ds.shares.map((s) => (
                    <li key={(s.teamId ?? s.userId)!}>
                      <Badge>
                        {s.teamId ? "Team: " : ""}{s.name}
                        <button className="ml-1 hover:text-danger" aria-label={`Stop sharing with ${s.name}`}
                          onClick={() => save({ shares: ds.shares.filter((x) => x !== s) })}>×</button>
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Field>
          )}
        </div>
      </Section>
      {error && <ErrorState error={error} />}
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={() => save()}>Save changes</Button>
        {saved && <span className="text-sm text-success">Saved</span>}
      </div>
      <Section title="Delete dataset" description="Blocked while other datasets reference it.">
        <Button variant="danger" onClick={remove}>Delete {ds.name}</Button>
      </Section>
    </div>
  );
}
