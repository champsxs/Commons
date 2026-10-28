import { useState } from "react";
import { Badge, Button, Checkbox, Dialog, ErrorState, Field, Input, Section } from "@commons/ui";
import { api, useApi, type ApiError } from "../api.ts";

interface Department {
  id: string;
  slug: string;
  name: string;
  teams: { id: string; name: string }[];
  members: { id: string; name: string }[];
  people: number;
  datasets: number;
  pages: number;
}

/** Admins define departments: a name, the teams in it, and any extra individual people. */
export function DepartmentsAdmin() {
  const departments = useApi<Department[]>("/departments");
  const teams = useApi<{ id: string; name: string }[]>("/teams");
  const users = useApi<{ id: string; name: string; email: string }[]>("/users");
  const [editing, setEditing] = useState<Department | "new" | null>(null);

  return (
    <Section title="Departments" description={'Groups of teams and people. Owners can open a dataset or page to "Department users (name)".'}
      actions={<Button size="sm" onClick={() => setEditing("new")}>New department</Button>}>
      {!departments.data?.length ? (
        <p className="text-sm text-muted-foreground">No departments yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {departments.data.map((d) => (
            <li key={d.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="font-medium">{d.name}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {d.teams.map((t) => <Badge key={t.id}>Team: {t.name}</Badge>)}
                  {d.members.map((m) => <Badge key={m.id}>{m.name}</Badge>)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {d.people} {d.people === 1 ? "person" : "people"} · opened to it: {d.datasets} dataset(s), {d.pages} page(s)
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setEditing(d)}>Edit</Button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <DepartmentDialog department={editing === "new" ? null : editing} teams={teams.data ?? []} users={users.data ?? []}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void departments.reload(); }} />
      )}
    </Section>
  );
}

function DepartmentDialog({ department, teams, users, onClose, onSaved }: {
  department: Department | null;
  teams: { id: string; name: string }[];
  users: { id: string; name: string; email: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(department?.name ?? "");
  const [teamIds, setTeamIds] = useState(department?.teams.map((t) => t.id) ?? []);
  const [userIds, setUserIds] = useState(department?.members.map((m) => m.id) ?? []);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (list: string[], id: string, on: boolean) => (on ? [...list, id] : list.filter((x) => x !== id));

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onSaved();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  const save = () => run(() => department
    ? api(`/departments/${department.id}`, { method: "PATCH", json: { name, teamIds, userIds } })
    : api("/departments", {
        method: "POST",
        json: { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^([0-9])/, "d-$1") || "department", teamIds, userIds },
      }));

  return (
    <Dialog open onClose={onClose} title={department ? `Edit ${department.name}` : "New department"} wide
      footer={<>
        {department && (
          <Button variant="ghost" className="mr-auto text-danger! hover:bg-danger/10" disabled={busy}
            onClick={() => confirm(`Delete ${department.name}?`) && run(() => api(`/departments/${department.id}`, { method: "DELETE" }))}>
            Delete
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={save}>Save</Button>
      </>}>
      <div className="flex flex-col gap-5">
        <Field label="Name" hint={`Shown as "Department users (${name || "name"})"`}>
          <Input value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="e.g. Retail" />
        </Field>
        <div>
          <div className="mb-2 text-[13px] font-medium">Teams in this department</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {teams.map((t) => <Checkbox key={t.id} label={t.name} checked={teamIds.includes(t.id)} onChange={(v) => setTeamIds(toggle(teamIds, t.id, v))} />)}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[13px] font-medium">Other people</div>
          <p className="mb-2 text-xs text-muted-foreground">People who belong to the department without being in one of its teams.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {users.map((u) => <Checkbox key={u.id} label={u.name} checked={userIds.includes(u.id)} onChange={(v) => setUserIds(toggle(userIds, u.id, v))} />)}
          </div>
        </div>
        {error && <ErrorState error={error} />}
      </div>
    </Dialog>
  );
}
