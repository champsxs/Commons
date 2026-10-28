import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Commons, formatIssue, truncateLists, type BuildIssue } from "@commons/cli/client";

/**
 * Commons as MCP tools, for Claude Code, Codex and other agents. Uses the same sign-in as the
 * commons CLI (~/.commons/config.json, or COMMONS_URL + COMMONS_TOKEN), so every call runs with
 * that person's permissions.
 */
const server = new McpServer({ name: "commons", version: "0.1.0" });
const ROW_LIMIT = Number(process.env.COMMONS_MCP_ROW_LIMIT ?? 100);

let commons: Commons | undefined;
const api = async () => (commons ??= await Commons.connect("mcp"));
const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });
const fail = (e: unknown) => ({ ...text(`Error: ${(e as Error).message}`), isError: true });

function tool<S extends z.ZodRawShape>(name: string, description: string, schema: S, fn: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>) {
  server.registerTool(name, { description, inputSchema: schema }, (async (args: any) => {
    try {
      return text(await fn(args));
    } catch (e) {
      return fail(e);
    }
  }) as any);
}

tool("search_datasets", "Search datasets and fields by name or description. Start here before querying or building a page.",
  { query: z.string().describe("words to look for, e.g. 'sales' or 'city'") },
  async ({ query }) => (await api()).get(`/api/search?q=${encodeURIComponent(query)}`));

tool("list_datasets", "List every dataset you can see, with row counts and owners.", {},
  async () => (await (await api()).get("/api/datasets")).map((d: any) => ({ slug: d.slug, name: d.name, description: d.description, rows: d.approxRows, team: d.teamName ?? d.ownerName, visibility: d.visibility })));

tool("get_dataset", "A dataset's fields, types, references to other datasets, and the exact GraphQL names to query it with.",
  { slug: z.string() },
  async ({ slug }) => {
    const d = await (await api()).get(`/api/datasets/${slug}`);
    return {
      slug: d.slug, name: d.name, description: d.description, rowCount: d.rowCount, keyField: d.keyField,
      fields: d.fields.map((f: any) => ({
        name: f.name, graphql: d.graphql?.fields[f.name], type: f.type, required: f.required, unique: f.isUnique, deprecated: f.deprecated,
        description: f.description || undefined, references: d.references[f.name] ? { dataset: d.references[f.name].dataset, matchedBy: d.references[f.name].matchField } : undefined,
      })),
      graphql: { type: d.graphql?.type, list: d.graphql?.listField, byId: d.graphql?.byIdField, orderBy: d.graphql?.orderBy, referencedBy: d.graphql?.related },
    };
  });

tool("get_graphql_schema", "The full GraphQL schema (SDL). Large; prefer get_dataset for one dataset.", {},
  async () => (await (await api()).get("/api/sdk")).schema);

tool("run_query", `Run a GraphQL query as the signed-in person. Lists are cut to ${ROW_LIMIT} items; use first/offset to page.`,
  { query: z.string(), variables: z.record(z.string(), z.unknown()).optional() },
  async ({ query, variables }) => {
    const r = await (await api()).graphql(query, variables);
    if (r.errors?.length) throw new Error(r.errors.map((e) => e.message).join("\n"));
    const { value, truncated } = truncateLists(r.data, ROW_LIMIT);
    return truncated ? { data: value, note: `Lists were cut to ${ROW_LIMIT} items` } : { data: value };
  });

tool("list_pages", "Pages you can see or edit.", {}, async () => (await api()).get("/api/pages"));

tool("get_page_source", "The source files of a page version (default: latest), plus its build log.",
  { slug: z.string(), version: z.number().int().optional() },
  async ({ slug, version }) => {
    const c = await api();
    const page = await c.get(`/api/pages/${slug}`);
    const v = version ?? page.versions[0]?.version;
    if (!v) throw new Error("No versions yet");
    return c.get(`/api/pages/${slug}/versions/${v}`);
  });

tool("get_page_guide", "How to write a Commons page: rules the build enforces, @commons/ui components, GraphQL conventions. Read before push_page_version.", {},
  async () => (await (await api()).get("/api/sdk")).template["AGENTS.md"]);

tool("push_page_version",
  "Upload page source (Page.tsx with a default-exported React component, plus any other .tsx/.ts files). Commons checks, typechecks and builds it, and returns errors with file and line, or a preview URL. Creates the page on first push.",
  {
    slug: z.string().regex(/^[a-z][a-z0-9-]{1,60}$/),
    files: z.record(z.string(), z.string()).describe('file name -> content, e.g. { "Page.tsx": "..." }'),
    message: z.string().optional(),
    title: z.string().optional().describe("page title, used when creating the page"),
    publish: z.boolean().optional().describe("make it live if the build succeeds"),
  },
  async ({ slug, files, message, title, publish }) => {
    const r = await (await api()).post(`/api/pages/${slug}/versions`, { files, message, title, publish: !!publish }, [422]);
    return r.status === "ready"
      ? { ok: true, version: r.version, published: r.published, url: r.url, log: r.log }
      : { ok: false, version: r.version, errors: (r.issues as BuildIssue[]).map(formatIssue) };
  });

tool("publish_page_version", "Make a version that built successfully live.",
  { slug: z.string(), version: z.number().int() },
  async ({ slug, version }) => {
    const p = await (await api()).post(`/api/pages/${slug}/publish`, { version });
    return { published: p.publishedVersion };
  });

await server.connect(new StdioServerTransport());
