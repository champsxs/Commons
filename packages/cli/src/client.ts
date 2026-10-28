import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";

export interface Config {
  url: string;
  token: string;
}

const configPath = () => join(process.env.COMMONS_HOME ?? join(homedir(), ".commons"), "config.json");

export async function loadConfig(): Promise<Config | null> {
  if (process.env.COMMONS_TOKEN) return { url: process.env.COMMONS_URL ?? "http://localhost:4000", token: process.env.COMMONS_TOKEN };
  try {
    const c = JSON.parse(await readFile(configPath(), "utf8"));
    return { url: process.env.COMMONS_URL ?? c.url, token: c.token };
  } catch {
    return null;
  }
}

export async function saveConfig(c: Config | null) {
  await mkdir(dirname(configPath()), { recursive: true, mode: 0o700 });
  await writeFile(configPath(), JSON.stringify(c ?? {}, null, 2) + "\n", { mode: 0o600 });
}

/** Which tool is calling, for the audit log. Agents can set COMMONS_CLIENT; Claude Code is detected. */
export function clientName(fallback: string) {
  if (process.env.COMMONS_CLIENT) return process.env.COMMONS_CLIENT;
  if (process.env.CLAUDECODE) return `${fallback}:claude-code`;
  if (process.env.CODEX_SANDBOX || process.env.CODEX_HOME) return `${fallback}:codex`;
  return fallback;
}

export class CommonsApiError extends Error {
  constructor(message: string, public status: number, public body: any) {
    super(message);
  }
}

export class Commons {
  constructor(public config: Config, public client = "cli") {}

  static async connect(client = "cli"): Promise<Commons> {
    const c = await loadConfig();
    if (!c?.token) throw new Error("Not signed in. Run `commons login` first (or set COMMONS_TOKEN).");
    return new Commons(c, clientName(client));
  }

  async request<T = any>(method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<T> {
    const res = await fetch(this.config.url.replace(/\/$/, "") + path, {
      method,
      headers: {
        authorization: `Bearer ${this.config.token}`,
        "x-commons-client": this.client,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).catch((e) => {
      throw new Error(`Can't reach Commons at ${this.config.url} (${e.cause?.code ?? e.message})`);
    });
    const text = await res.text();
    const json = text && res.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text;
    if (!res.ok && !okStatuses.includes(res.status)) throw new CommonsApiError(json?.error ?? `${res.status} ${res.statusText}`, res.status, json);
    return json as T;
  }

  get = <T = any>(path: string) => this.request<T>("GET", path);
  post = <T = any>(path: string, body?: unknown, ok?: number[]) => this.request<T>("POST", path, body ?? {}, ok);

  async graphql<T = any>(query: string, variables?: Record<string, unknown>): Promise<{ data?: T; errors?: { message: string }[] }> {
    const body = await this.request("POST", "/graphql", { query, variables }, [400, 401, 403]);
    // Commons' own checks (depth, read-only tokens) answer { error }; GraphQL answers { errors }
    if (body?.error && !body.errors) return { errors: [{ message: body.error }] };
    return body;
  }
}

/** Shortens long lists in query results so they stay readable for people and agents. */
export function truncateLists(value: unknown, limit: number): { value: unknown; truncated: boolean } {
  let truncated = false;
  const walk = (v: any): any => {
    if (Array.isArray(v)) {
      if (v.length > limit) truncated = true;
      return v.slice(0, limit).map(walk);
    }
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value), truncated };
}

export interface BuildIssue {
  kind: string;
  file?: string;
  line?: number;
  message: string;
}

export const formatIssue = (i: BuildIssue) => `${i.file ? `${i.file}${i.line ? `:${i.line}` : ""}: ` : ""}[${i.kind}] ${i.message}`;

const TOOLING = new Set(["package.json", "package-lock.json", "tsconfig.json", "commons.json"]);

/** The files Commons builds: page source, not local tooling. */
export async function collectPageFiles(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "dist") continue;
      const p = join(d, e.name);
      const rel = relative(dir, p);
      if (e.isDirectory()) await walk(p);
      else if (/\.(tsx|ts|graphql|json)$/.test(e.name) && !TOOLING.has(rel) && !e.name.endsWith(".d.ts")) out[rel] = await readFile(p, "utf8");
    }
  };
  await walk(dir);
  return out;
}

export interface PageManifest {
  slug: string;
  title: string;
  description?: string;
}

export async function readManifest(dir: string): Promise<PageManifest> {
  const p = join(dir, "commons.json");
  if (!existsSync(p)) throw new Error(`No commons.json in ${dir}. Run this inside a page folder, or create one with \`commons pages new <slug>\`.`);
  return JSON.parse(await readFile(p, "utf8"));
}

/** Writes UI kit types and the GraphQL schema into .commons/ so editors and agents can typecheck locally. */
export async function writeSdk(dir: string, sdk: { types: Record<string, string>; schema: string }) {
  for (const [name, content] of Object.entries(sdk.types)) {
    const p = join(dir, ".commons/types", name);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, content);
  }
  await writeFile(join(dir, ".commons/schema.graphql"), sdk.schema);
}

export async function writeFiles(dir: string, files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    const p = join(dir, name);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, content);
  }
}
