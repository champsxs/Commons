import { Badge } from "@commons/ui";

export type Visibility = "private" | "shared" | "company";

/** What each visibility level is called on screen. The stored value for the widest level is still "company". */
export const VISIBILITY: Record<Visibility, { label: string; tone: "neutral" | "warning" | "success"; option: string }> = {
  private: { label: "Private", tone: "neutral", option: "Private: only me and my team" },
  shared: { label: "Shared", tone: "warning", option: "Shared: my team and people I share with" },
  company: { label: "Any signed-in user", tone: "success", option: "Any signed-in user" },
};

export const visibilityOptions = (levels: Visibility[] = ["company", "shared", "private"]) =>
  levels.map((v) => ({ value: v, label: VISIBILITY[v].option }));

export function VisibilityBadge({ value }: { value: Visibility }) {
  return <Badge tone={VISIBILITY[value].tone}>{VISIBILITY[value].label}</Badge>;
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
