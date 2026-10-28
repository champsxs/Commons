import { parse as parseCsv } from "csv-parse/sync";
import { badRequest } from "../util/errors.ts";

export type RawRow = Record<string, unknown>;

/** Parses an uploaded CSV, JSON array, or JSON Lines file into plain objects. */
export function parseFile(buf: Buffer, filename = ""): RawRow[] {
  const text = buf.toString("utf8").replace(/^﻿/, "");
  const trimmed = text.trimStart();
  const isJson = /\.(json|jsonl|ndjson)$/i.test(filename) || trimmed.startsWith("[") || trimmed.startsWith("{");
  if (isJson) {
    try {
      if (trimmed.startsWith("[")) {
        const arr = JSON.parse(text);
        if (!Array.isArray(arr)) throw new Error("not an array");
        return arr;
      }
      return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
    } catch (e) {
      throw badRequest(`Couldn't read the JSON file: ${(e as Error).message}`);
    }
  }
  try {
    return parseCsv(text, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
  } catch (e) {
    throw badRequest(`Couldn't read the CSV file: ${(e as Error).message}`);
  }
}

const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

const TRUE = new Set(["true", "yes", "y", "t"]);
const FALSE = new Set(["false", "no", "n", "f"]);

/** Converts one raw cell to the field type. Returns null for empty, throws a message on bad input. */
export function coerce(type: string, v: unknown): unknown {
  if (isEmpty(v)) return null;
  const s = typeof v === "string" ? v.trim() : v;
  switch (type) {
    case "text":
      return typeof s === "string" ? s : typeof s === "object" ? JSON.stringify(s) : String(s);
    case "integer": {
      const n = typeof s === "number" ? s : Number(String(s).replace(/[\s_]/g, ""));
      if (!Number.isInteger(n) || Math.abs(n) > 2147483647) throw `"${s}" is not a whole number`;
      return n;
    }
    case "number": {
      const n = typeof s === "number" ? s : Number(String(s).replace(/[\s_]/g, ""));
      if (!Number.isFinite(n)) throw `"${s}" is not a number`;
      return n;
    }
    case "boolean": {
      if (typeof s === "boolean") return s;
      const l = String(s).toLowerCase();
      if (TRUE.has(l) || l === "1") return true;
      if (FALSE.has(l) || l === "0") return false;
      throw `"${s}" is not true/false`;
    }
    case "date": {
      const str = String(s);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(str) || Number.isNaN(Date.parse(str))) throw `"${s}" is not a date (YYYY-MM-DD)`;
      return str;
    }
    case "timestamp": {
      const d = new Date(String(s));
      if (Number.isNaN(d.getTime())) throw `"${s}" is not a date and time`;
      return d.toISOString();
    }
    case "json": {
      if (typeof s !== "string") return s;
      try {
        return JSON.parse(s);
      } catch {
        throw `"${s}" is not valid JSON`;
      }
    }
    case "reference":
      return String(s);
    default:
      throw `unknown type ${type}`;
  }
}

/** Guesses field definitions from sample rows. */
export function inferFields(rows: RawRow[]) {
  const sample = rows.slice(0, 2000);
  const headers = [...new Set(sample.flatMap((r) => Object.keys(r)))];
  return headers.map((header, position) => {
    const values = sample.map((r) => r[header]).filter((v) => !isEmpty(v));
    const strs = values.map((v) => (typeof v === "string" ? v.trim() : v));
    const all = (test: (v: any) => boolean) => strs.length > 0 && strs.every(test);
    let type = "text";
    if (all((v) => typeof v === "boolean" || TRUE.has(String(v).toLowerCase()) || FALSE.has(String(v).toLowerCase()))) type = "boolean";
    else if (all((v) => /^-?\d{1,9}$/.test(String(v)))) type = "integer";
    else if (all((v) => typeof v === "number" || /^-?\d*\.?\d+(e-?\d+)?$/i.test(String(v)))) type = "number";
    else if (all((v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)))) type = "date";
    else if (all((v) => /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(String(v)))) type = "timestamp";
    else if (all((v) => typeof v === "object")) type = "json";
    const distinct = new Set(strs.map((v) => JSON.stringify(v))).size;
    const name = toFieldName(header);
    // Small files make every column look unique, so only suggest it for identifier-like columns
    const looksLikeId = position === 0 || /(^|_)(id|code|key|sku|number|no|email|slug)$/.test(name);
    return {
      header,
      name,
      type,
      required: values.length === sample.length && sample.length > 0,
      unique: values.length > 1 && distinct === values.length && (type === "text" || type === "integer") && looksLikeId,
      position,
      examples: [...new Set(strs.slice(0, 50).map(String))].slice(0, 3),
    };
  });
}

export function toFieldName(header: string): string {
  let n = header
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!/^[a-z]/.test(n)) n = "f_" + n;
  return n.slice(0, 50) || "field";
}
