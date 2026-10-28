import { Badge } from "@commons/ui";

export type Visibility = "private" | "shared" | "department" | "company";

/** What each visibility level is called on screen. The stored value for the widest level is still "company". */
export const VISIBILITY: Record<Visibility, { label: string; tone: "neutral" | "warning" | "primary" | "success"; option: string }> = {
  private: { label: "Private", tone: "neutral", option: "Private: only me and my team" },
  shared: { label: "Shared", tone: "warning", option: "Shared: my team and people I share with" },
  department: { label: "Department users", tone: "primary", option: "Department users: everyone in one of my departments" },
  company: { label: "Any signed-in user", tone: "success", option: "Any signed-in user" },
};

/** "Department users (Retail)" for department visibility, otherwise the plain label. */
export const visibilityLabel = (value: Visibility, department?: string | null) =>
  value === "department" && department ? `Department users (${department})` : VISIBILITY[value].label;

export function VisibilityBadge({ value, department }: { value: Visibility; department?: string | null }) {
  return <Badge tone={VISIBILITY[value].tone}>{visibilityLabel(value, department)}</Badge>;
}

export const TYPE_LABELS: Record<string, string> = {
  text: "Text", integer: "Whole number", number: "Number", boolean: "Yes / no", date: "Date", timestamp: "Date & time", json: "JSON", reference: "Reference",
};

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}
