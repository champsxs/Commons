import { useCallback, useEffect, useState } from "react";

export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: any) {
    super(message);
  }
}

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const body = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status, body?.details);
  return body as T;
}

export function upload<T = any>(path: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("file", file);
  return api<T>(path, { method: "POST", body: form });
}

/** Fetches on mount and whenever `path` changes. Pass null to skip. */
export function useApi<T = any>(path: string | null) {
  const [state, setState] = useState<{ data?: T; error?: ApiError; loading: boolean }>({ loading: !!path });
  const load = useCallback(async () => {
    if (!path) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      setState({ data: await api<T>(path), loading: false });
    } catch (e) {
      setState({ error: e as ApiError, loading: false });
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load]);
  return { ...state, reload: load, setData: (data: T) => setState({ data, loading: false }) };
}

export interface Me {
  id: string;
  email: string;
  name: string;
  is_admin: boolean;
  teams: { id: string; slug: string; name: string }[];
}

export interface DatasetSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  visibility: "private" | "shared" | "company";
  updatedAt: string;
  keyField: string | null;
  ownerName: string;
  teamName: string | null;
  fieldCount: number;
  usedByCount: number;
  approxRows: number;
}
