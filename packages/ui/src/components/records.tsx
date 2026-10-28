import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { runGraphql, useCommons, useCommonsQuery, type CommonsError } from "../client.tsx";
import { recordQuery, useDataset, type DatasetField, type DatasetMeta } from "../dataset.ts";
import { formatValue } from "../format.ts";
import { Badge, Button, Checkbox, ErrorState, Field, Input, Loading, Select, Textarea, cn } from "./base.tsx";

const formatFor = (f: DatasetField) =>
  f.type === "date" ? "date" : f.type === "timestamp" ? "datetime" : f.type === "boolean" ? "boolean" : f.type === "integer" ? "integer" : f.type === "number" ? "number" : undefined;

/** A link to a record, using the host's router when there is one. */
export function RecordLink({ dataset, id, children }: { dataset: string; id: string; children: ReactNode }) {
  const config = useCommons();
  const href = config.linkTo?.(dataset, id);
  if (!href) return <>{children}</>;
  return (
    <a href={href} className="text-primary hover:underline"
      onClick={(e) => {
        if (config.navigate && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          config.navigate(href);
        }
      }}>
      {children}
    </a>
  );
}

/** Shows a referenced row by its label, linked when possible. */
export function ReferenceValue({ ds, field, value }: { ds: DatasetMeta; field: string; value: any }) {
  if (!value) return <span className="text-muted-foreground">–</span>;
  const ref = ds.references[field];
  const label = ref?.graphql?.label && ref.graphql.label !== "id" ? value[ref.graphql.label] : value.id;
  return <RecordLink dataset={ref?.dataset ?? ""} id={value.id}>{label ?? value.id}</RecordLink>;
}

/** Renders a cell value for a dataset field, including references. */
export function FieldValue({ ds, field, row }: { ds: DatasetMeta; field: DatasetField; row: any }) {
  const v = row?.[ds.graphql!.fields[field.name]];
  if (field.type === "reference") return <ReferenceValue ds={ds} field={field.name} value={v} />;
  if (field.type === "json") return <code className="text-xs font-mono">{v == null ? "–" : JSON.stringify(v)}</code>;
  return <>{formatValue(v, formatFor(field) as any)}</>;
}

/** A detail view of one row: every field, references as links, and what points at it. */
export function RecordView({ dataset, id, actions }: { dataset: string; id: string; actions?: ReactNode }) {
  const { dataset: ds, error: dsError } = useDataset(dataset);
  const query = ds?.graphql?.byIdField ? recordQuery(ds) : null;
  const { data, error, loading, refetch } = useCommonsQuery(query, { id });
  if (dsError) return <ErrorState error={dsError} />;
  if (error) return <ErrorState error={error} retry={refetch} />;
  if (!ds || loading) return <Loading rows={6} />;
  const row = data?.[ds.graphql!.byIdField!];
  if (!row) return <ErrorState error="This row doesn't exist or you can't see it" />;
  const title = ds.displayField !== "id" ? row[ds.graphql!.fields[ds.displayField]] : row.id;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{ds.name}</div>
          <h2 className="text-lg font-semibold">{String(title)}</h2>
        </div>
        {actions}
      </div>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        {ds.fields.map((f) => (
          <div key={f.name} className="min-w-0">
            <dt className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              {f.label}
              {f.deprecated && <Badge tone="warning">deprecated</Badge>}
            </dt>
            <dd className="mt-0.5 text-sm break-words"><FieldValue ds={ds} field={f} row={row} /></dd>
          </div>
        ))}
      </dl>
      {ds.graphql!.related.length > 0 && (
        <div className="border-t border-border pt-4">
          <div className="mb-2 text-[13px] font-medium text-muted-foreground">Referenced by</div>
          <div className="flex flex-wrap gap-2">
            {ds.graphql!.related.map((r) => (
              <Badge key={r.field}>{r.field.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()} · {row[r.field]?.totalCount ?? 0}</Badge>
            ))}
          </div>
        </div>
      )}
      <div className="text-xs text-muted-foreground">Updated {formatValue(row.updatedAt, "datetime")}</div>
    </div>
  );
}

/** A searchable dropdown of rows from a dataset, for filling in a reference. */
export function RefPicker({ dataset, value, onChange, placeholder = "Choose…", disabled }: { dataset: string; value: string | null; onChange: (id: string | null) => void; placeholder?: string; disabled?: boolean }) {
  const { dataset: ds } = useDataset(dataset);
  const g = ds?.graphql;
  const label = ds && ds.displayField !== "id" ? g?.fields[ds.displayField] : null;
  const key = ds?.keyField && ds.keyField !== ds.displayField ? g?.fields[ds.keyField] : null;
  const q = g?.listField ? `{ ${g.listField}(first: 500) { nodes { id ${label ?? ""} ${key ?? ""} } } }` : null;
  const { data, loading } = useCommonsQuery(q);
  const options = useMemo(() => {
    const nodes: any[] = data?.[g!.listField!]?.nodes ?? [];
    return nodes
      .map((n) => ({ value: n.id, label: [label ? n[label] : n.id, key ? `(${n[key]})` : ""].join(" ").trim() }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [data, g, label, key]);
  return (
    <Select options={options} value={value ?? ""} placeholder={loading ? "Loading…" : placeholder} disabled={disabled || loading}
      onChange={(e) => onChange(e.target.value || null)} />
  );
}

function toInput(f: DatasetField, raw: unknown): unknown {
  if (raw === "" || raw === undefined) return null;
  switch (f.type) {
    case "integer": return Number.parseInt(String(raw), 10);
    case "number": return Number(raw);
    case "json": return typeof raw === "string" ? JSON.parse(raw) : raw;
    case "timestamp": return new Date(String(raw)).toISOString();
    default: return raw;
  }
}

function fromRow(ds: DatasetMeta, f: DatasetField, row: any): unknown {
  const v = row?.[ds.graphql!.fields[f.name]];
  if (f.type === "reference") return v?.id ?? null;
  if (f.type === "json") return v == null ? "" : JSON.stringify(v, null, 2);
  if (f.type === "timestamp") return v ? String(v).slice(0, 16) : "";
  return v ?? (f.type === "boolean" ? false : "");
}

/** A create/edit form generated from a dataset's fields. Omit `id` to create a new row. */
export function RecordForm({ dataset, id, onSaved, onCancel, defaults }: { dataset: string; id?: string; onSaved?: (row: { id: string }) => void; onCancel?: () => void; defaults?: Record<string, unknown> }) {
  const config = useCommons();
  const { dataset: ds, error: dsError } = useDataset(dataset);
  const existing = useCommonsQuery(ds && id ? recordQuery(ds) : null, { id });
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<CommonsError | Error | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!ds) return;
    const row = id ? existing.data?.[ds.graphql!.byIdField!] : null;
    if (id && !row) return;
    setValues(Object.fromEntries(ds.fields.map((f) => [f.name, row ? fromRow(ds, f, row) : defaults?.[f.name] ?? (f.type === "boolean" ? false : f.type === "reference" ? null : "")])));
  }, [ds, id, existing.data]);

  if (dsError) return <ErrorState error={dsError} />;
  if (!ds || (id && existing.loading)) return <Loading rows={5} />;
  const g = ds.graphql!;
  const m = g.mutations;
  if (!(id ? m.update : m.create)) return <ErrorState error="This dataset can't be edited through the API" />;

  const fields = ds.fields.filter((f) => !f.deprecated || id);
  const set = (name: string, v: unknown) => setValues((s) => ({ ...s, [name]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const payload: Record<string, unknown> = {};
    for (const f of fields) {
      try {
        const v = toInput(f, values[f.name]);
        if (v === null && f.required) errs[f.name] = "Required";
        if (typeof v === "number" && Number.isNaN(v)) errs[f.name] = "Not a number";
        payload[g.inputs[f.name]] = v;
      } catch {
        errs[f.name] = "Invalid value";
      }
    }
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    setError(null);
    try {
      const mutation = id
        ? `mutation($id: UUID!, $patch: ${g.type}Patch!) { ${m.update}(input: { id: $id, ${m.patchField}: $patch }) { ${g.type.charAt(0).toLowerCase() + g.type.slice(1)} { id } } }`
        : `mutation($row: ${g.type}Input!) { ${m.create}(input: { ${m.inputField}: $row }) { ${m.inputField} { id } } }`;
      const data: any = await runGraphql(config, mutation, id ? { id, patch: payload } : { row: payload });
      const result = Object.values(data)[0] as any;
      onSaved?.(Object.values(result)[0] as { id: string });
    } catch (e) {
      setError(e as Error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <Field key={f.name} as={f.type === "boolean" ? "div" : "label"} label={f.label} required={f.required} hint={f.description || undefined} error={fieldErrors[f.name]}
            className={cn((f.type === "json" || f.type === "boolean") && "sm:col-span-2")}>
            <FieldInput field={f} ds={ds} value={values[f.name]} onChange={(v) => set(f.name, v)} />
          </Field>
        ))}
      </div>
      {error && <ErrorState error={error} />}
      <div className="flex justify-end gap-2">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" variant="primary" loading={saving}>{id ? "Save changes" : `Add ${ds.name.toLowerCase().replace(/s$/, "")}`}</Button>
      </div>
    </form>
  );
}

function FieldInput({ field: f, ds, value, onChange }: { field: DatasetField; ds: DatasetMeta; value: unknown; onChange: (v: unknown) => void }) {
  switch (f.type) {
    case "reference":
      return <RefPicker dataset={ds.references[f.name]?.dataset} value={(value as string) ?? null} onChange={onChange} />;
    case "boolean":
      return <Checkbox label={f.label} checked={!!value} onChange={onChange} />;
    case "json":
      return <Textarea className="font-mono text-xs" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "integer":
    case "number":
      return <Input type="number" step={f.type === "integer" ? 1 : "any"} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "date":
      return <Input type="date" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "timestamp":
      return <Input type="datetime-local" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <Input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
  }
}

export interface FilterSpec {
  key: string;
  label: string;
  type?: "select" | "text";
  options?: (string | { value: string; label: string })[];
}

/** A row of filters. Controlled: pass `value` and get changes in `onChange`. */
export function FilterBar({ filters, value, onChange, className }: { filters: FilterSpec[]; value: Record<string, unknown>; onChange: (patch: Record<string, unknown>) => void; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-end gap-3", className)}>
      {filters.map((f) => (
        <label key={f.key} className="flex min-w-40 flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{f.label}</span>
          {f.type === "text" ? (
            <Input value={String(value[f.key] ?? "")} onChange={(e) => onChange({ [f.key]: e.target.value || undefined })} />
          ) : (
            <Select options={f.options ?? []} placeholder="All" value={String(value[f.key] ?? "")} onChange={(e) => onChange({ [f.key]: e.target.value || undefined })} />
          )}
        </label>
      ))}
    </div>
  );
}
