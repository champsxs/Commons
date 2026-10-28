import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/** Marks a GraphQL document so tools can find it. Returns the string unchanged. */
export function gql(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce((acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ""), "");
}

export interface CommonsConfig {
  /** GraphQL endpoint, e.g. "/graphql" */
  graphqlUrl: string;
  /** Read-only registry endpoint, e.g. "/api" (app) or "/registry" (pages) */
  registryUrl: string;
  /** Extra headers on every request, e.g. a bearer token */
  headers?: () => Record<string, string>;
  credentials?: RequestCredentials;
  /** Builds a link to a record, so references can be clicked. Return null to show plain text. */
  linkTo?: (dataset: string, id: string) => string | null;
  /** Called instead of following links, e.g. a client-side router's navigate() */
  navigate?: (href: string) => void;
}

const Ctx = createContext<CommonsConfig | null>(null);

export function CommonsProvider({ children, ...config }: CommonsConfig & { children: ReactNode }) {
  const value = useMemo(() => config, [config.graphqlUrl, config.registryUrl, config.headers, config.linkTo, config.navigate]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCommons(): CommonsConfig {
  const c = useContext(Ctx);
  if (!c) throw new Error("Wrap your page in <CommonsProvider> (pages get this automatically)");
  return c;
}

export class CommonsError extends Error {
  constructor(message: string, public status?: number, public errors?: { message: string }[]) {
    super(message);
  }
}

export async function runGraphql<T>(config: CommonsConfig, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(config.graphqlUrl, {
    method: "POST",
    credentials: config.credentials ?? "include",
    headers: { "content-type": "application/json", ...config.headers?.() },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok && !body.data) throw new CommonsError(body.error ?? body.errors?.[0]?.message ?? `Request failed (${res.status})`, res.status, body.errors);
  if (body.errors?.length) throw new CommonsError(body.errors.map((e: any) => e.message).join("; "), res.status, body.errors);
  return body.data as T;
}

export async function fetchRegistry<T>(config: CommonsConfig, path: string): Promise<T> {
  const res = await fetch(config.registryUrl + path, { credentials: config.credentials ?? "include", headers: config.headers?.() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new CommonsError(body.error ?? `Request failed (${res.status})`, res.status);
  return body as T;
}

export interface QueryState<T> {
  data: T | undefined;
  error: CommonsError | undefined;
  loading: boolean;
  refetch: () => Promise<void>;
}

/**
 * Runs a GraphQL query against Commons as the person viewing the page.
 * Re-runs when the query or variables change.
 */
export function useCommonsQuery<T = any>(query: string | null, variables?: Record<string, unknown>, opts: { pause?: boolean } = {}): QueryState<T> {
  const config = useCommons();
  const [state, setState] = useState<{ data?: T; error?: CommonsError; loading: boolean }>({ loading: !!query && !opts.pause });
  const key = JSON.stringify([query, variables]);
  const seq = useRef(0);

  const run = useCallback(async () => {
    if (!query || opts.pause) return;
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    try {
      const data = await runGraphql<T>(config, query, variables);
      if (n === seq.current) setState({ data, loading: false });
    } catch (e) {
      if (n === seq.current) setState((s) => ({ data: s.data, error: e as CommonsError, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, key, opts.pause]);

  useEffect(() => {
    void run();
  }, [run]);

  return { data: state.data, error: state.error, loading: state.loading, refetch: run };
}

/** Returns a function that runs a GraphQL mutation, plus its loading/error state. */
export function useCommonsMutation<T = any>(mutation: string) {
  const config = useCommons();
  const [state, setState] = useState<{ loading: boolean; error?: CommonsError }>({ loading: false });
  const mutate = useCallback(
    async (variables?: Record<string, unknown>) => {
      setState({ loading: true });
      try {
        const data = await runGraphql<T>(config, mutation, variables);
        setState({ loading: false });
        return data;
      } catch (e) {
        setState({ loading: false, error: e as CommonsError });
        throw e;
      }
    },
    [config, mutation],
  );
  return [mutate, state] as const;
}

/** Simple state for a page's filters. */
export function useFilters<T extends Record<string, unknown>>(initial: T) {
  const [filters, setFilters] = useState<T>(initial);
  const set = useCallback((patch: Partial<T>) => setFilters((f) => ({ ...f, ...patch })), []);
  return [filters, set, setFilters] as const;
}
