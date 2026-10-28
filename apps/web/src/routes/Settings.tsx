import { useState } from "react";
import { Badge, Button, Checkbox, DataTable, ErrorState, Field, Input, Page, Section } from "@commons/ui";
import { api, useApi, type ApiError } from "../api.ts";
import { timeAgo } from "../components/bits.tsx";
import { useMe } from "../main.tsx";

const SCOPES = [
  { id: "data:read", label: "Read data", hint: "Query datasets you can see" },
  { id: "data:write", label: "Change data", hint: "Insert, update and delete rows through GraphQL" },
  { id: "datasets:write", label: "Manage datasets", hint: "Create datasets, change fields, upload files" },
  { id: "pages:write", label: "Publish pages", hint: "Push page code, e.g. from Claude Code or Codex" },
];

export function Settings() {
  const { me } = useMe();
  const tokens = useApi<any[]>("/tokens");
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState(["data:read", "pages:write"]);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function create() {
    setError(null);
    try {
      const t = await api<{ token: string }>("/tokens", { method: "POST", json: { name, scopes } });
      setCreated(t.token);
      setName("");
      void tokens.reload();
    } catch (e) {
      setError(e as ApiError);
    }
  }

  return (
    <Page title="Settings" description={`${me.name} · ${me.email}`}
      actions={<Button onClick={async () => { await api("/auth/logout", { method: "POST" }); location.href = "/"; }}>Sign out</Button>}>
      <Section title="Teams">
        <div className="flex flex-wrap gap-2">{me.teams.length ? me.teams.map((t) => <Badge key={t.id}>{t.name}</Badge>) : <span className="text-sm text-muted-foreground">You're not in a team yet.</span>}</div>
      </Section>
      <Section title="API tokens" description="For the commons CLI, coding agents like Claude Code or Codex, and scripts. Tokens act as you.">
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field label="Name"><Input value={name} placeholder="e.g. Claude Code on my laptop" onChange={(e) => setName(e.target.value)} /></Field>
            <Button variant="primary" disabled={!name || !scopes.length} onClick={create}>Create token</Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {SCOPES.map((s) => (
              <Checkbox key={s.id} checked={scopes.includes(s.id)} onChange={(v) => setScopes(v ? [...scopes, s.id] : scopes.filter((x) => x !== s.id))}
                label={<span>{s.label} <span className="text-muted-foreground">· {s.hint}</span></span>} />
            ))}
          </div>
          {created && (
            <div className="rounded-md border border-success/40 bg-success/5 p-3 text-sm">
              <div className="font-medium">Copy your token now. It won't be shown again.</div>
              <code className="mt-1 block break-all font-mono text-xs">{created}</code>
            </div>
          )}
          {error && <ErrorState error={error} />}
          <DataTable rows={tokens.data} loading={tokens.loading} emptyText="No tokens yet" columns={[
            "name",
            { key: "scopes", render: (t) => <div className="flex flex-wrap gap-1">{t.scopes.map((s: string) => <Badge key={s}>{s}</Badge>)}</div> },
            { key: "last_used_at", label: "Last used", render: (t) => (t.last_used_at ? timeAgo(t.last_used_at) : "never") },
            { key: "expires_at", label: "Expires", format: "date" },
            { key: "id", label: "", sortable: false, render: (t) => <Button size="sm" variant="ghost" onClick={async () => { await api(`/tokens/${t.id}`, { method: "DELETE" }); void tokens.reload(); }}>Revoke</Button> },
          ]} />
        </div>
      </Section>
    </Page>
  );
}
