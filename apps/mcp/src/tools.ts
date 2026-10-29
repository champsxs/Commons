import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatIssue, truncateLists, type BuildIssue, type Commons } from "@commons/cli/client";

/**
 * The Commons MCP tools. Each call goes through the Commons API as the person `api` signs in as,
 * so the agent never gets more access than they have. Shared by the local (stdio) server and the
 * API's HTTP /mcp endpoint.
 */
export function createCommonsMcpServer(api: () => Promise<Commons>): McpServer {
  const server = new McpServer({ name: "commons", version: "0.1.0" });
  const ROW_LIMIT = Number(process.env.COMMONS_MCP_ROW_LIMIT ?? 100);

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

  tool("whoami", "Who the agent is acting as: name, teams, departments and the token's permissions.", {},
    async () => {
      const me = await (await api()).get("/api/me");
      return { name: me.name, email: me.email, admin: me.is_admin, teams: me.teams.map((t: any) => t.name), departments: me.departments.map((d: any) => d.name), permissions: me.scopes };
    });

  tool("suggest_reuse",
    "Before proposing a new dataset: finds existing datasets that look like the same thing, and columns that should be " +
    "references to existing datasets instead of copies. Commons prefers linking to shared data over duplicating it.",
    {
      name: z.string().describe("proposed dataset name, e.g. 'Store regions'"),
      description: z.string().optional(),
      fields: z.array(z.string()).describe("proposed field or column names, e.g. ['store_code', 'region', 'city_code']"),
    },
    async ({ name, description, fields }) => {
      const r = await (await api()).post("/api/datasets/suggest", { name, description: description ?? "", fields: fields.map((f) => ({ name: f })) });
      return {
        similarDatasets: r.similar.map((d: any) => ({ slug: d.slug, name: d.name, why: d.reasons.join("; ") })),
        linkInsteadOfCopy: r.references.map((x: any) => ({ column: x.field, dataset: x.dataset, matchedBy: x.matchField, suggestedFieldName: x.suggestedName, why: x.reason })),
      };
    });

  tool("dataset_usage",
    "What depends on a dataset: other datasets that reference it (and the field they match on) and published pages " +
    "that read it. Check before suggesting changes to a dataset's fields.",
    { slug: z.string() },
    async ({ slug }) => (await api()).get(`/api/datasets/${encodeURIComponent(slug)}/usage`));

  tool("upload_history", "Recent uploads to a dataset: when, who, mode, rows written and whether they failed (with the reason).",
    { slug: z.string(), limit: z.number().int().min(1).max(50).default(10) },
    async ({ slug, limit }) => {
      const runs = await (await api()).get(`/api/datasets/${encodeURIComponent(slug)}/ingests`);
      return runs.slice(0, limit).map((r: any) => ({
        at: r.created_at, by: r.user_name, file: r.filename, mode: r.mode, status: r.status,
        rowsInFile: r.rows_total, rowsWritten: r.rows_inserted, rowsSkipped: r.rows_skipped, message: r.report?.message,
      }));
    });

  tool("list_page_versions",
    "A page's versions: which is live, which failed to build, who pushed them and when, and which dataset fields each reads. " +
    "Use get_page_source with a version number for its code and build log.",
    { slug: z.string() },
    async ({ slug }) => {
      const p = await (await api()).get(`/api/pages/${encodeURIComponent(slug)}`);
      return {
        title: p.title, live: p.publishedVersion, visibility: p.visibility, allowWrites: p.allowWrites,
        versions: p.versions.map((v: any) => ({
          version: v.version, status: v.status, live: v.id === p.publishedVersionId, message: v.message, by: v.createdBy, via: v.client, at: v.createdAt,
          reads: v.dependencies.map((d: any) => `${d.dataset}.${d.field}`),
        })),
      };
    });

  tool("set_description",
    "Write or improve the description of a dataset, or of one of its fields (and optionally the field's display label), " +
    "so people know what the data means. Confirm the wording with the user first. Needs edit access to the dataset " +
    "and a token allowed to create datasets and upload files.",
    {
      dataset: z.string(),
      field: z.string().optional().describe("leave out to describe the dataset itself"),
      description: z.string().max(2000),
      label: z.string().max(80).optional().describe("for a field: its display name"),
    },
    async ({ dataset, field, description, label }) => {
      const c = await api();
      if (field) {
        const ds = await c.request("PATCH", `/api/datasets/${encodeURIComponent(dataset)}/fields/${encodeURIComponent(field)}`, { description, label });
        const f = ds.fields.find((x: any) => x.name === field);
        return { dataset: ds.slug, field: f.name, label: f.label, description: f.description };
      }
      if (label) throw new Error("`label` is only for fields");
      const ds = await c.request("PATCH", `/api/datasets/${encodeURIComponent(dataset)}`, { description });
      return { dataset: ds.slug, description: ds.description };
    });

  tool("add_field",
    "Add a field (column) to a dataset. This changes a dataset other people use, so confirm the name, type and " +
    "description with the user before calling it. The field starts empty; fill it with an add-or-update upload. " +
    "Needs edit access to the dataset and a token allowed to create datasets and upload files. " +
    "Fields can't be renamed or removed with this tool.",
    {
      dataset: z.string().describe("dataset slug, e.g. 'suppliers'"),
      name: z.string().regex(/^[a-z][a-z0-9_]{0,50}$/).describe("lowercase letters, digits and underscores, e.g. 'region'"),
      type: z.enum(["text", "integer", "number", "boolean", "date", "timestamp", "json", "reference"]).default("text"),
      label: z.string().optional().describe("display name (default: from the name)"),
      description: z.string().optional().describe("what the field holds"),
      required: z.boolean().optional().describe("only allowed while the dataset has no rows"),
      unique: z.boolean().optional(),
      references: z.object({
        dataset: z.string().describe("the dataset it points to"),
        matchField: z.string().optional().describe("unique field that files use to match rows (default: that dataset's key)"),
        onDelete: z.enum(["restrict", "set_null"]).optional(),
        unresolved: z.enum(["reject", "skip", "null"]).optional().describe("what uploads do with values that match no row"),
      }).optional().describe("required when type is 'reference'"),
    },
    async ({ dataset, name, type, label, description, required, unique, references }) => {
      if (type === "reference" && !references) throw new Error("A reference field needs `references.dataset`");
      if (type !== "reference" && references) throw new Error("`references` is only for type 'reference'");
      const ds = await (await api()).post(`/api/datasets/${encodeURIComponent(dataset)}/fields`, {
        name, type, label, description: description ?? "", required: !!required, unique: !!unique,
        reference: references ? { onDelete: "restrict", unresolved: "reject", ...references } : undefined,
      });
      const f = ds.fields.find((x: any) => x.name === name);
      const ref = ds.references?.[name];
      return {
        added: { name: f.name, label: f.label, type: f.type, graphql: ds.graphql?.fields[name], references: ref ? { dataset: ref.dataset, matchedBy: ref.matchField } : undefined },
        next: `Fill it with an add-or-update upload whose file has the "${ds.keyField ?? "key"}" column and a "${ref ? ref.matchField : name}" column.`,
      };
    });

  tool("get_help",
    "Commons' own documentation: how visibility and departments work, upload modes (add, add or update, replace), references, the CLI, MCP, pages, GraphQL. Without a topic, lists the topics. Check it before explaining or changing how data behaves.",
    { topic: z.string().optional().describe("topic id from the list, e.g. 'uploading'") },
    async ({ topic }) => {
      const c = await api();
      if (!topic) {
        const { topics } = await c.get("/api/help");
        return topics.map((t: any) => ({ id: t.id, title: t.title, group: t.group, summary: t.summary }));
      }
      return (await c.get(`/api/help/${encodeURIComponent(topic)}?links=absolute`)).markdown;
    });

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

  return server;
}
