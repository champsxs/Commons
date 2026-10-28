import { useState } from "react";
import { useSearchParams } from "react-router";
import { Badge, Button, Card, Checkbox, ErrorState, Loading } from "@commons/ui";
import { api, useApi, type ApiError } from "../api.ts";
import { useMe } from "../main.tsx";

const SCOPES = [
  { id: "data:read", label: "Read data you can see" },
  { id: "pages:write", label: "Create and publish pages" },
  { id: "datasets:write", label: "Create datasets and upload files" },
  { id: "data:write", label: "Change rows through GraphQL" },
];

/** Where `commons login` sends people: confirm the code, pick what the CLI may do, approve. */
export function CliLogin() {
  const { me } = useMe();
  const [params] = useSearchParams();
  const code = (params.get("code") ?? "").toUpperCase();
  const request = useApi<{ code: string; client: string; status: string }>(code ? `/auth/device/${encodeURIComponent(code)}` : null);
  const [scopes, setScopes] = useState(["data:read", "pages:write"]);
  const [done, setDone] = useState<"approved" | "denied" | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function decide(decision: "approve" | "deny") {
    setBusy(true);
    setError(null);
    try {
      await api(`/auth/device/${code}/${decision}`, { method: "POST", json: { scopes } });
      setDone(decision === "approve" ? "approved" : "denied");
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  const status = done ?? request.data?.status;
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <Card>
        <h1 className="text-lg font-semibold">Sign in to the commons CLI</h1>
        {!code && <p className="mt-2 text-sm text-muted-foreground">Run <code className="font-mono">commons login</code> in your terminal to start.</p>}
        {request.loading && <div className="mt-4"><Loading rows={3} /></div>}
        {request.error && <div className="mt-4"><ErrorState error={request.error} /></div>}
        {request.data && status === "pending" && (
          <div className="mt-3 flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              <span className="text-foreground">{request.data.client}</span> wants to act as <span className="text-foreground">{me.name}</span>.
              Only approve if you just ran <code className="font-mono">commons login</code> and your terminal shows this code:
            </p>
            <div className="rounded-md bg-muted py-3 text-center font-mono text-2xl font-semibold tracking-[0.2em]">{request.data.code}</div>
            <div className="flex flex-col gap-2">
              <div className="text-[13px] font-medium">It may</div>
              {SCOPES.map((s) => (
                <Checkbox key={s.id} label={s.label} checked={scopes.includes(s.id)}
                  onChange={(v) => setScopes(v ? [...scopes, s.id] : scopes.filter((x) => x !== s.id))} />
              ))}
            </div>
            {error && <ErrorState error={error} />}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={busy} onClick={() => decide("deny")}>Deny</Button>
              <Button variant="primary" loading={busy} disabled={!scopes.length} onClick={() => decide("approve")}>Approve</Button>
            </div>
          </div>
        )}
        {status === "approved" && <p className="mt-3 text-sm"><Badge tone="success">Approved</Badge> You can close this tab and go back to your terminal.</p>}
        {status === "denied" && <p className="mt-3 text-sm"><Badge tone="danger">Denied</Badge> The CLI was not signed in.</p>}
        {(status === "expired" || status === "claimed") && !done && (
          <p className="mt-3 text-sm text-muted-foreground">This request has {status === "claimed" ? "already been used" : "expired"}. Run <code className="font-mono">commons login</code> again.</p>
        )}
      </Card>
    </div>
  );
}
