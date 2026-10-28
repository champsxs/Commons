import { useEffect, useState } from "react";
import { Card, ErrorState, Spinner } from "@commons/ui";
import { api } from "../api.ts";

interface DevUser {
  id: string;
  email: string;
  name: string;
  is_admin: boolean;
}

/** Development sign-in: pick a seeded user. Replaced by company SSO later. */
export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [users, setUsers] = useState<DevUser[]>();
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState<string>();
  useEffect(() => {
    api<DevUser[]>("/auth/dev-users").then(setUsers, setError);
  }, []);
  async function signIn(email: string) {
    setBusy(email);
    try {
      await api("/auth/dev-login", { method: "POST", json: { email } });
      onSignedIn();
    } catch (e) {
      setError(e as Error);
      setBusy(undefined);
    }
  }
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Sign in to Commons</h1>
          <p className="mt-1 text-sm text-muted-foreground">Development mode: choose a sample user.</p>
        </div>
        <Card padded={false} className="divide-y divide-border overflow-hidden">
          {error && <div className="p-4"><ErrorState error={error} /></div>}
          {!users && !error && <div className="grid place-items-center p-8"><Spinner /></div>}
          {users?.map((u) => (
            <button key={u.id} onClick={() => signIn(u.email)} disabled={!!busy}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted disabled:opacity-60">
              <span className="grid size-9 place-items-center rounded-full bg-accent text-sm font-semibold text-primary">
                {u.name.split(" ").map((p) => p[0]).join("")}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{u.name}{u.is_admin && <span className="ml-2 text-xs text-muted-foreground">admin</span>}</span>
                <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
              </span>
              {busy === u.email && <Spinner />}
            </button>
          ))}
        </Card>
      </div>
    </div>
  );
}
