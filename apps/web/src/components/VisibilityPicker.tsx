import { Field, Select } from "@commons/ui";
import { useApi } from "../api.ts";
import { useMe } from "../main.tsx";
import { VISIBILITY, type Visibility } from "./bits.tsx";

interface Department {
  id: string;
  name: string;
  mine: boolean;
  teams: { id: string; name: string }[];
}

export interface VisibilityValue {
  visibility: Visibility;
  departmentId: string | null;
}

/**
 * "Who can see it": the visibility level, plus which department when it's "Department users".
 * Offers the departments the person belongs to (admins see all), defaulting to the owning team's.
 */
export function VisibilityPicker({ value, onChange, levels = ["company", "department", "shared", "private"], teamId }: {
  value: VisibilityValue;
  onChange: (v: VisibilityValue) => void;
  levels?: Visibility[];
  teamId?: string | null;
}) {
  const { me } = useMe();
  const { data: departments } = useApi<Department[]>("/departments");
  const choices = (departments ?? []).filter((d) => d.mine || me.is_admin);
  const canUseDepartments = choices.length > 0;
  const fallback = () => (choices.find((d) => d.teams.some((t) => t.id === teamId)) ?? choices[0])?.id ?? null;

  return (
    <div className="flex flex-col gap-3">
      <Field label="Who can see it">
        <Select value={value.visibility}
          options={levels.filter((l) => l !== "department" || canUseDepartments).map((l) => ({ value: l, label: VISIBILITY[l].option }))}
          onChange={(e) => {
            const visibility = e.target.value as Visibility;
            onChange({ visibility, departmentId: visibility === "department" ? value.departmentId ?? fallback() : null });
          }} />
      </Field>
      {value.visibility === "department" && (
        <Field label="Department" hint="Everyone in this department, directly or through one of its teams, can see it.">
          <Select value={value.departmentId ?? ""} placeholder={choices.length ? undefined : "You're not in a department"}
            options={choices.map((d) => ({ value: d.id, label: d.name }))}
            onChange={(e) => onChange({ ...value, departmentId: e.target.value || null })} />
        </Field>
      )}
    </div>
  );
}
