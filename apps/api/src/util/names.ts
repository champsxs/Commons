import pluralize from "pluralize";

export const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
export const pascal = (s: string) => {
  const c = camel(s);
  return c.charAt(0).toUpperCase() + c.slice(1);
};
export const singular = (s: string) => pluralize.singular(s);
export const plural = (s: string) => pluralize.plural(s);

/** "Store opening hours" -> "store_opening_hours" */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^([0-9])/, "_$1")
    .slice(0, 50);
}

export const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`Unsafe identifier: ${s}`);
  return `"${s}"`;
};

export const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;

export const RESERVED_FIELDS = new Set(["id", "created_at", "updated_at", "node_id", "row_id"]);
