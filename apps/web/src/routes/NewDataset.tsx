import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Badge, Button, Card, Checkbox, ErrorState, Field, Input, Page, Section, Select, Textarea, cn } from "@commons/ui";
import { api, upload, useApi, type ApiError, type DatasetSummary } from "../api.ts";
import { TYPE_LABELS } from "../components/bits.tsx";
import { useMe } from "../main.tsx";
import { IngestReportView, type IngestReport } from "../components/IngestReport.tsx";

export interface FieldDraft {
  key: string;
  name: string;
  type: string;
  required: boolean;
  unique: boolean;
  description: string;
  reference?: { dataset: string; matchField?: string; onDelete: "restrict" | "set_null"; unresolved: "reject" | "skip" | "null" };
  examples?: string[];
}

interface Suggestions {
  similar: { slug: string; name: string; description: string; score: number; reasons: string[] }[];
  references: { field: string; dataset: string; datasetName: string; matchField: string; suggestedName: string; reason: string }[];
}

interface Inferred {
  rowCount: number;
  keyField: string | null;
  fields: { header: string; name: string; type: string; required: boolean; unique: boolean; examples: string[] }[];
  sample: Record<string, unknown>[];
}

let nextKey = 0;
const newField = (patch: Partial<FieldDraft> = {}): FieldDraft => ({ key: String(nextKey++), name: "", type: "text", required: false, unique: false, description: "", ...patch });
const toName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^([0-9])/, "f_$1").slice(0, 50);

export function NewDataset() {
  const { me } = useMe();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [inferred, setInferred] = useState<Inferred | null>(null);
  const [mode, setMode] = useState<"choose" | "edit">("choose");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState("company");
  const [teamId, setTeamId] = useState(me.teams[0]?.id ?? "");
  const [keyField, setKeyField] = useState("");
  const [fields, setFields] = useState<FieldDraft[]>([newField({ name: "name", required: true })]);
  const [suggestions, setSuggestions] = useState<Suggestions>();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [report, setReport] = useState<{ slug: string; report: IngestReport } | null>(null);
  const { data: datasets } = useApi<DatasetSummary[]>("/datasets");

  // Ask the registry, as the user types, whether this already exists or should link to something
  const suggestKey = JSON.stringify([name, fields.map((f) => [f.name, f.type])]);
  useEffect(() => {
    if (mode !== "edit") return;
    const t = setTimeout(() => {
      api<Suggestions>("/datasets/suggest", { method: "POST", json: { name, description, fields: fields.filter((f) => f.name).map((f) => ({ name: f.name, type: f.type })) } })
        .then(setSuggestions, () => {});
    }, 300);
    return () => clearTimeout(t);
  }, [suggestKey, mode]);

  async function pickFile(f: File) {
    setFile(f);
    setError(null);
    try {
      const r = await upload<Inferred & { suggestions: Suggestions }>("/infer", f);
      setInferred(r);
      setName((n) => n || f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase()));
      setFields(r.fields.map((x) => newField({ name: x.name, type: x.type, required: x.required, unique: x.unique, examples: x.examples })));
      setKeyField(r.keyField ?? "");
      setSuggestions(r.suggestions);
      setMode("edit");
    } catch (e) {
      setError(e as ApiError);
    }
  }

  function applyReference(s: Suggestions["references"][number]) {
    setFields((fs) => fs.map((f) => (f.name === s.field
      ? { ...f, name: s.suggestedName, type: "reference", unique: false, reference: { dataset: s.dataset, matchField: s.matchField, onDelete: "restrict", unresolved: "reject" } }
      : f)));
    if (keyField === s.field) setKeyField("");
  }

  async function create() {
    setSaving(true);
    setError(null);
    try {
      const body = {
        name, description, visibility, teamId: teamId || null, keyField: keyField || null,
        fields: fields.filter((f) => f.name).map((f) => ({
          name: f.name, type: f.type, required: f.required, unique: f.unique, description: f.description,
          reference: f.type === "reference" ? f.reference : undefined,
        })),
      };
      const ds = await api<{ slug: string }>("/datasets", { method: "POST", json: body });
      if (file) {
        const r = await upload<IngestReport>(`/datasets/${ds.slug}/ingest`, file, { mode: "append" });
        setReport({ slug: ds.slug, report: r });
      } else navigate(`/datasets/${ds.slug}`);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSaving(false);
    }
  }

  const refSuggestions = (suggestions?.references ?? []).filter((s) => !dismissed.has(`${s.field}:${s.dataset}`) && fields.some((f) => f.name === s.field && f.type !== "reference"));
  const similar = (suggestions?.similar ?? []).filter((s) => !dismissed.has(`ds:${s.slug}`));
  const keyOptions = fields.filter((f) => f.name && !["reference", "json", "boolean"].includes(f.type)).map((f) => f.name);

  if (report) {
    return (
      <Page title="Dataset created" description="Here's how the upload went.">
        <IngestReportView report={report.report} />
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => navigate(`/datasets/${report.slug}`)}>Open dataset</Button>
          {report.report.status !== "ok" && <Button onClick={() => navigate(`/datasets/${report.slug}/upload`)}>Fix and upload again</Button>}
        </div>
      </Page>
    );
  }

  if (mode === "choose") {
    return (
      <Page title="New dataset" description="Start from a file and we'll work out the fields, or define them yourself.">
        <div className="grid gap-4 md:grid-cols-2">
          <label
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void pickFile(f); }}
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input bg-surface px-6 py-14 text-center transition-colors hover:border-primary hover:bg-accent/40">
            <input type="file" accept=".csv,.json,.jsonl,.ndjson" className="sr-only" onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])} />
            <span className="text-sm font-medium">Start from a file</span>
            <span className="text-[13px] text-muted-foreground">Drop a CSV or JSON file, or click to choose one</span>
          </label>
          <button onClick={() => setMode("edit")}
            className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface px-6 py-14 text-center shadow-xs transition-colors hover:bg-muted/50">
            <span className="text-sm font-medium">Define fields yourself</span>
            <span className="text-[13px] text-muted-foreground">Add fields and upload data later</span>
          </button>
        </div>
        {error && <ErrorState error={error} />}
      </Page>
    );
  }

  return (
    <Page title="New dataset" description={file ? `From ${file.name} · ${inferred?.rowCount.toLocaleString()} rows` : "Describe what this dataset holds."}>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-6 min-w-0">
          <Section title="About">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Warehouses" /></Field>
              <Field label="Team"><Select options={me.teams.map((t) => ({ value: t.id, label: t.name }))} placeholder="Just me" value={teamId} onChange={(e) => setTeamId(e.target.value)} /></Field>
              <Field label="Description" className="sm:col-span-2"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is in it, where it comes from, how often it's updated" /></Field>
              <Field label="Who can see it">
                <Select value={visibility} onChange={(e) => setVisibility(e.target.value)} options={[
                  { value: "company", label: "Everyone in the company" },
                  { value: "shared", label: "My team and people I share with" },
                  { value: "private", label: "Only me and my team" },
                ]} />
              </Field>
              <Field label="Key field" hint="Uniquely identifies each row. Others use it to link to this dataset.">
                <Select value={keyField} onChange={(e) => setKeyField(e.target.value)} options={keyOptions} placeholder="None" />
              </Field>
            </div>
          </Section>

          <Section title="Fields" description="Use a reference when a value points at a row in another dataset."
            actions={<Button size="sm" onClick={() => setFields((f) => [...f, newField()])}>Add field</Button>}>
            <div className="flex flex-col gap-3">
              {fields.map((f, i) => (
                <FieldRow key={f.key} field={f} datasets={datasets ?? []} isKey={keyField === f.name}
                  onChange={(patch) => setFields((fs) => fs.map((x, j) => (j === i ? { ...x, ...patch } : x)))}
                  onRemove={() => setFields((fs) => fs.filter((_, j) => j !== i))} />
              ))}
            </div>
          </Section>

          {inferred && inferred.sample.length > 0 && (
            <Section title="Preview" description="First rows of your file">
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead><tr>{Object.keys(inferred.sample[0]).map((h) => <th key={h} className="border-b border-border px-2 py-1.5 text-left font-medium text-muted-foreground">{h}</th>)}</tr></thead>
                  <tbody>{inferred.sample.map((r, i) => <tr key={i}>{Object.values(r).map((v, j) => <td key={j} className="border-b border-border px-2 py-1.5">{String(v ?? "")}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </Section>
          )}

          {error && <ErrorState error={error} />}
          <div className="flex justify-end gap-2">
            <Link to="/datasets"><Button variant="ghost">Cancel</Button></Link>
            <Button variant="primary" loading={saving} disabled={!name || !fields.some((f) => f.name)} onClick={create}>
              {file ? "Create and upload" : "Create dataset"}
            </Button>
          </div>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <div className="text-sm font-semibold">Before you create</div>
            <p className="mt-1 text-[13px] text-muted-foreground">Reusing and linking to existing data keeps everyone on the same numbers.</p>
            {similar.length === 0 && refSuggestions.length === 0 && (
              <p className="mt-4 text-[13px] text-muted-foreground">No similar datasets found so far.</p>
            )}
            {similar.length > 0 && (
              <div className="mt-4 flex flex-col gap-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">This may already exist</div>
                {similar.map((s) => (
                  <div key={s.slug} className="rounded-md border border-warning/40 bg-warning/5 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <Link to={`/datasets/${s.slug}`} className="text-sm font-medium text-primary hover:underline">{s.name}</Link>
                      <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setDismissed((d) => new Set(d).add(`ds:${s.slug}`))}>Dismiss</button>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{s.reasons.join(" · ")}</div>
                  </div>
                ))}
              </div>
            )}
            {refSuggestions.length > 0 && (
              <div className="mt-4 flex flex-col gap-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Link instead of copying</div>
                {refSuggestions.map((s) => (
                  <div key={`${s.field}:${s.dataset}`} className="rounded-md border border-primary/30 bg-accent/40 p-3">
                    <div className="text-sm"><code className="font-mono text-xs">{s.field}</code> → <span className="font-medium">{s.datasetName}</span></div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{s.reason}</div>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="primary" onClick={() => applyReference(s)}>Make it a reference</Button>
                      <Button size="sm" variant="ghost" onClick={() => setDismissed((d) => new Set(d).add(`${s.field}:${s.dataset}`))}>No</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </aside>
      </div>
    </Page>
  );
}

/** One field in the builder. Shared with "Add field" on an existing dataset. */
export function FieldRow({ field: f, datasets, isKey, onChange, onRemove }: { field: FieldDraft; datasets: DatasetSummary[]; isKey?: boolean; onChange: (p: Partial<FieldDraft>) => void; onRemove?: () => void }) {
  const target = useApi<any>(f.type === "reference" && f.reference?.dataset ? `/datasets/${f.reference.dataset}` : null);
  const matchOptions = useMemo(() => {
    const t = target.data;
    if (!t) return [];
    return [...t.fields.filter((x: any) => x.isUnique).map((x: any) => ({ value: x.name, label: `${x.label}${x.name === t.keyField ? " (key)" : ""}` })), { value: "id", label: "Internal id" }];
  }, [target.data]);

  return (
    <div className={cn("rounded-md border border-border p-3", f.type === "reference" && "bg-accent/30")}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px_auto]">
        <Input value={f.name} placeholder="field_name" className="font-mono text-[13px]"
          onChange={(e) => onChange({ name: toName(e.target.value) })} />
        <Select value={f.type} options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))}
          onChange={(e) => onChange({ type: e.target.value, reference: e.target.value === "reference" ? f.reference ?? { dataset: "", onDelete: "restrict", unresolved: "reject" } : undefined })} />
        <div className="flex items-center gap-3">
          <Checkbox label="Required" checked={f.required || !!isKey} disabled={isKey} onChange={(v) => onChange({ required: v })} />
          {f.type !== "reference" && <Checkbox label="Unique" checked={f.unique || !!isKey} disabled={isKey} onChange={(v) => onChange({ unique: v })} />}
          {onRemove && <button onClick={onRemove} className="ml-1 text-xs text-muted-foreground hover:text-danger" aria-label="Remove field">Remove</button>}
        </div>
      </div>
      {f.type === "reference" && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Points to">
            <Select value={f.reference?.dataset ?? ""} placeholder="Choose a dataset" options={datasets.map((d) => ({ value: d.slug, label: d.name }))}
              onChange={(e) => onChange({ reference: { ...f.reference!, dataset: e.target.value, matchField: undefined } })} />
          </Field>
          <Field label="Matched by" hint="The value in your files">
            <Select value={f.reference?.matchField ?? ""} placeholder={target.data?.keyField ? "Key field" : "Choose"} options={matchOptions}
              onChange={(e) => onChange({ reference: { ...f.reference!, matchField: e.target.value || undefined } })} />
          </Field>
          <Field label="Unknown values">
            <Select value={f.reference?.unresolved ?? "reject"} onChange={(e) => onChange({ reference: { ...f.reference!, unresolved: e.target.value as any } })}
              options={[{ value: "reject", label: "Reject the upload" }, { value: "skip", label: "Skip those rows" }, { value: "null", label: "Leave empty" }]} />
          </Field>
        </div>
      )}
      {f.examples && f.examples.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          e.g. {f.examples.map((x) => <Badge key={x}>{x}</Badge>)}
        </div>
      )}
    </div>
  );
}
