import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { config } from "./config.ts";
import { repoRoot, templateDir } from "./pages/paths.ts";
import { notFound } from "./util/errors.ts";

/**
 * Help topics are Markdown files in /help, so the web app, the CLI (`commons help`) and agents
 * (MCP `get_help`) all read the same text. Each file starts with front matter:
 *
 *   ---
 *   title: Uploading and updating data
 *   summary: One line for lists and search
 *   group: Data
 *   order: 30
 *   keywords: words people might search for
 *   ---
 *
 * In the body, {{apiUrl}} and {{webOrigin}} become this server's public addresses, and
 * <!-- if devLogin --> … <!-- end --> is kept only on development servers.
 */

const helpDir = join(repoRoot, "help");

export const HELP_GROUPS = ["Basics", "Data", "Tools and agents", "Pages", "Reference"] as const;

export interface HelpTopic {
  id: string;
  title: string;
  summary: string;
  group: string;
  order: number;
  keywords: string;
}

/** Extra topics whose Markdown lives elsewhere: the page guide is also the AGENTS.md in every page folder. */
const EXTERNAL: (HelpTopic & { file: string })[] = [
  {
    id: "writing-pages", file: join(templateDir, "AGENTS.md"), title: "Writing pages (guide for agents)", group: "Pages", order: 61,
    summary: "The rules every page build enforces, the @commons/ui components, and GraphQL conventions.",
    keywords: "agents.md claude.md components ui kit rules build page code",
  },
];

function parse(id: string, raw: string): { meta: HelpTopic; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const fields: Record<string, string> = {};
  for (const line of (m?.[1] ?? "").split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return {
    meta: {
      id, title: fields.title ?? id, summary: fields.summary ?? "", group: fields.group ?? "Reference",
      order: Number(fields.order ?? 999), keywords: fields.keywords ?? "",
    },
    body: m ? raw.slice(m[0].length) : raw,
  };
}

/** Fills in this server's addresses and drops development-only blocks on real servers. */
export function render(body: string) {
  return body
    .replace(/<!-- if devLogin -->\n?([\s\S]*?)<!-- end -->\n?/g, (_, inner: string) => (config.devLogin ? inner : ""))
    .replaceAll("{{apiUrl}}", config.publicApiUrl.replace(/\/$/, ""))
    .replaceAll("{{webOrigin}}", config.webOrigin.replace(/\/$/, ""));
}

async function load(): Promise<Map<string, { meta: HelpTopic; body: string }>> {
  const topics = new Map<string, { meta: HelpTopic; body: string }>();
  for (const f of (await readdir(helpDir)).filter((f) => f.endsWith(".md")).sort()) {
    const id = f.replace(/\.md$/, "");
    topics.set(id, parse(id, await readFile(join(helpDir, f), "utf8")));
  }
  for (const { file, ...meta } of EXTERNAL) topics.set(meta.id, { meta, body: await readFile(file, "utf8") });
  return topics;
}

const byOrder = (a: HelpTopic, b: HelpTopic) =>
  HELP_GROUPS.indexOf(a.group as any) - HELP_GROUPS.indexOf(b.group as any) || a.order - b.order;

export async function listHelp(): Promise<HelpTopic[]> {
  return [...(await load()).values()].map((t) => t.meta).sort(byOrder);
}

/** `absolute` turns in-app links like (/help/cli) into full addresses, for the CLI and agents. */
export async function getHelp(id: string, opts: { absolute?: boolean } = {}) {
  const t = (await load()).get(id);
  if (!t) throw notFound(`No help topic "${id}"`);
  let markdown = render(t.body);
  if (opts.absolute) markdown = markdown.replace(/\]\(\/(?!\/)/g, `](${config.webOrigin.replace(/\/$/, "")}/`);
  return { ...t.meta, markdown };
}

export function registerHelpRoutes(app: FastifyInstance) {
  // Help is about Commons itself, not company data, so it's readable without signing in
  app.get("/api/help", async () => ({ groups: HELP_GROUPS, topics: await listHelp() }));
  app.get("/api/help/:id", async (req) =>
    getHelp((req.params as { id: string }).id, { absolute: (req.query as { links?: string }).links === "absolute" }));
}
