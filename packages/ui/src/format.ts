export type Format = "number" | "integer" | "currency" | "percent" | "date" | "month" | "datetime" | "compact" | "boolean" | "text";

const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const intf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 });

/** Formats a value for display. Currency has no symbol by default since datasets mix currencies. */
export function formatValue(v: unknown, format?: Format, opts: { currency?: string } = {}): string {
  if (v === null || v === undefined || v === "") return "–";
  switch (format) {
    case "number": return nf.format(Number(v));
    case "integer": return intf.format(Number(v));
    case "compact": return compact.format(Number(v));
    case "percent": return pct.format(Number(v));
    case "currency":
      return opts.currency
        ? new Intl.NumberFormat(undefined, { style: "currency", currency: opts.currency, maximumFractionDigits: 0 }).format(Number(v))
        : intf.format(Number(v));
    case "date": return new Date(String(v).length === 10 ? `${v}T00:00:00` : String(v)).toLocaleDateString();
    case "month": return new Date(String(v).length === 10 ? `${v}T00:00:00` : String(v)).toLocaleDateString(undefined, { year: "numeric", month: "short" });
    case "datetime": return new Date(String(v)).toLocaleString();
    case "boolean": return v ? "Yes" : "No";
    case "text": return String(v);
    default:
      if (typeof v === "number") return nf.format(v);
      if (typeof v === "boolean") return v ? "Yes" : "No";
      if (typeof v === "object") return JSON.stringify(v);
      return String(v);
  }
}

/** Reads a dotted path like "city.country.name" from an object. */
export function get(obj: unknown, path: string): any {
  let cur: any = obj;
  for (const key of path.split(".")) {
    if (cur == null) return undefined;
    cur = cur[key];
  }
  return cur;
}

/** "floorAreaM2" / "floor_area_m2" -> "Floor area m2" */
export function humanize(key: string): string {
  const last = key.split(".").pop()!;
  const words = last.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Groups rows by a key and sums (or counts) a value. Handy for charts. */
export function groupBy<T>(rows: T[], key: string | ((r: T) => unknown), value?: string | ((r: T) => number), op: "sum" | "count" | "avg" = value ? "sum" : "count") {
  const k = typeof key === "function" ? key : (r: T) => get(r, key);
  const v = typeof value === "function" ? value : (r: T) => Number(value ? get(r, value) : 1);
  const acc = new Map<unknown, { sum: number; n: number }>();
  for (const r of rows) {
    const g = k(r);
    const a = acc.get(g) ?? { sum: 0, n: 0 };
    a.sum += v(r) || 0;
    a.n += 1;
    acc.set(g, a);
  }
  return [...acc].map(([group, a]) => ({ key: group, value: op === "count" ? a.n : op === "avg" ? a.sum / a.n : a.sum }));
}
