import { Badge } from "@commons/ui";

export function VisibilityBadge({ value }: { value: "private" | "shared" | "company" }) {
  const map = { private: { tone: "neutral", label: "Private" }, shared: { tone: "warning", label: "Shared" }, company: { tone: "success", label: "Company-wide" } } as const;
  return <Badge tone={map[value].tone}>{map[value].label}</Badge>;
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
