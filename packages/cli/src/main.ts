import { existsSync, watch } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { hostname } from "node:os";
import { Command } from "commander";
import {
  Commons, CommonsApiError, collectPageFiles, formatIssue, loadConfig, readManifest, saveConfig, truncateLists, writeFiles, writeSdk,
  type BuildIssue,
} from "./client.ts";

const program = new Command("commons").description("Commons from the command line: explore datasets, query data, build pages.").version("0.1.0");

const print = (v: unknown) => console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
const dim = (s: string) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s);
const red = (s: string) => (process.stdout.isTTY ? `\x1b[31m${s}\x1b[0m` : s);
const bold = (s: string) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s);
const green = (s: string) => (process.stdout.isTTY ? `\x1b[32m${s}\x1b[0m` : s);

const visibilityText = (d: { visibility: string; departmentName?: string | null }) =>
  d.visibility === "company" ? "any signed-in user" : d.visibility === "department" ? `department users (${d.departmentName})` : d.visibility;

/** Accepts a department's slug or name and returns its id. */
async function departmentId(c: Commons, nameOrSlug: string): Promise<string> {
  const all: { id: string; slug: string; name: string; mine: boolean }[] = await c.get("/api/departments");
  const d = all.find((x) => x.slug === nameOrSlug || x.name.toLowerCase() === nameOrSlug.toLowerCase());
  if (!d) throw new Error(`No department "${nameOrSlug}". Yours: ${all.filter((x) => x.mine).map((x) => x.slug).join(", ") || "none"}`);
  return d.id;
}

function run(fn: (...args: any[]) => Promise<void>) {
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (e) {
      const message = (e as Error).message;
      console.error(red(`Error: ${message}`));
      const scope = message.match(/lacks the ([a-z:]+) scope/)?.[1];
      if (scope) console.error(dim(`Run commons login again and allow "${SCOPE_NAMES[scope] ?? scope}".`));
      process.exitCode = 1;
    }
  };
}

const SCOPE_NAMES: Record<string, string> = {
  "data:read": "Read data you can see",
  "pages:write": "Create and publish pages",
  "datasets:write": "Create datasets and upload files",
  "data:write": "Change rows through GraphQL",
};

// The server that served this file replaces this with its own address
const BAKED_URL = "__COMMONS_DEFAULT_URL__";
const DEFAULT_URL = BAKED_URL.includes("://") ? BAKED_URL : "http://localhost:4000";

function openBrowser(url: string) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {}
}

/** Browser sign-in: show a code, open the approval page, wait for the person to approve. */
async function browserLogin(url: string): Promise<string> {
  const post = async (path: string, body: unknown) => {
    const res = await fetch(url + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const start = await post("/api/auth/device", { name: `commons CLI on ${hostname()}` });
  if (start.status !== 200) throw new Error(start.body.error ?? "Couldn't start sign-in");
  const { deviceCode, userCode, verificationUrl, interval, expiresIn } = start.body;
  console.log(`Opening your browser to approve this sign-in. Check the code matches: ${green(userCode)}`);
  console.log(dim(`If it doesn't open, go to ${verificationUrl}`));
  // Over SSH or in CI there's no browser here; the link above still works from any device
  if (!process.env.COMMONS_NO_BROWSER && !process.env.SSH_CONNECTION) openBrowser(verificationUrl);
  const deadline = Date.now() + expiresIn * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval * 1000));
    const r = await post("/api/auth/device/token", { deviceCode });
    if (r.status === 200) return r.body.token;
    if (r.status !== 202) throw new Error(r.body.error ?? "Sign-in failed");
  }
  throw new Error("Sign-in timed out. Run commons login again.");
}

program
  .command("login")
  .description("Sign in through your browser and save a token in ~/.commons/config.json")
  .option("--url <url>", "Commons API address")
  .option("--token <token>", "use an API token from Settings → API tokens instead of the browser")
  .option("--email <email>", "development servers only: get a token for this user")
  .action(run(async (opts) => {
    const url = (opts.url ?? (await loadConfig())?.url ?? DEFAULT_URL).replace(/\/$/, "");
    let token: string = opts.token;
    if (!token && opts.email) {
      const res = await fetch(`${url}/api/auth/dev-token`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: opts.email, name: "commons CLI" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Dev login failed; use --token instead");
      token = body.token;
    }
    if (!token) token = await browserLogin(url);
    const me = await new Commons({ url, token }).get("/api/me");
    await saveConfig({ url, token });
    console.log(green(`Signed in as ${me.name} (${me.email}) · scopes: ${me.scopes.join(", ")}`));
  }));

program.command("logout").description("Forget the saved token").action(run(async () => {
  await saveConfig(null);
  console.log("Signed out");
}));

program.command("whoami").description("Show who you're signed in as").action(run(async () => {
  const c = await Commons.connect();
  const me = await c.get("/api/me");
  console.log(`${me.name} <${me.email}> on ${c.config.url}`);
  console.log(dim(`teams: ${me.teams.map((t: any) => t.name).join(", ") || "none"} · scopes: ${me.scopes.join(", ")}`));
}));

// ---- Help ----
// Replaces commander's built-in `help <command>`; `commons <command> --help` still shows options.
program.helpCommand(false);

/** Light terminal formatting for help Markdown: bold headings, dimmed code fences. */
function formatMarkdown(md: string) {
  if (!process.stdout.isTTY) return md;
  let inCode = false;
  return md.split("\n").map((line) => {
    if (line.startsWith("```")) {
      inCode = !inCode;
      return dim(line.replace(/title="([^"]*)"/, "($1)"));
    }
    if (inCode) return `  ${line}`;
    if (/^#{1,3} /.test(line)) return `\x1b[1m${line.replace(/^#+ /, "")}\x1b[0m`;
    return line.replace(/\*\*([^*]+)\*\*/g, "\x1b[1m$1\x1b[0m");
  }).join("\n");
}

program
  .command("help [topic]")
  .description("Read Commons help (the same text as /help in the app). Without a topic, lists topics.")
  .option("--json", "print JSON")
  .action(run(async (topic: string | undefined, opts) => {
    // Help isn't private, so it works before signing in too
    const url = ((await loadConfig())?.url ?? DEFAULT_URL).replace(/\/$/, "");
    const get = async (path: string) => {
      const res = await fetch(url + path).catch(() => {
        throw new Error(`Can't reach Commons at ${url}`);
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `${res.status}`);
      return body;
    };
    if (!topic) {
      const { groups, topics } = await get("/api/help");
      if (opts.json) return print(topics);
      for (const g of groups) {
        const items = topics.filter((t: any) => t.group === g);
        if (!items.length) continue;
        console.log(`\n${g}`);
        for (const t of items) console.log(`  ${t.id.padEnd(18)} ${t.title}${dim(` · ${t.summary}`)}`);
      }
      console.log(dim(`\nRead one with: commons help <topic>. Options for a command: commons <command> --help`));
      return;
    }
    const command = program.commands.find((c) => c.name() === topic);
    try {
      const t = await get(`/api/help/${encodeURIComponent(topic)}?links=absolute`);
      if (opts.json) return print(t);
      console.log(bold(t.title));
      console.log(dim(`${t.summary}\n`));
      console.log(formatMarkdown(t.markdown));
    } catch (e) {
      if (command) return command.outputHelp();
      throw e;
    }
  }));

// ---- Datasets ----
const datasets = program.command("datasets").description("List, search and inspect datasets");

datasets
  .argument("[search]", "search datasets and fields")
  .option("--json", "print JSON")
  .action(run(async (q: string | undefined, opts) => {
    const c = await Commons.connect();
    if (q) {
      const r = await c.get(`/api/search?q=${encodeURIComponent(q)}`);
      if (opts.json) return print(r);
      for (const d of r.datasets) console.log(`${d.slug.padEnd(24)} ${d.name}${d.description ? dim(` · ${d.description}`) : ""}`);
      for (const f of r.fields) console.log(dim(`${`${f.dataset}.${f.name}`.padEnd(32)} field (${f.type}) in ${f.datasetName}`));
      return;
    }
    const list = await c.get("/api/datasets");
    if (opts.json) return print(list);
    for (const d of list) {
      console.log(`${d.slug.padEnd(24)} ${d.name.padEnd(28)} ${String(d.approxRows).padStart(8)} rows  ${dim(`${visibilityText(d)} · ${d.teamName ?? d.ownerName}`)}`);
    }
  }));

datasets
  .command("show <slug>")
  .description("Fields, types, references and GraphQL names for a dataset")
  .option("--json", "print JSON")
  .action(run(async (slug: string, opts) => {
    const c = await Commons.connect();
    const d = await c.get(`/api/datasets/${slug}`);
    if (opts.json) return print(d);
    const g = d.graphql;
    console.log(`${d.name} (${d.slug}) · ${d.rowCount} rows · ${visibilityText(d)}`);
    if (d.description) console.log(dim(d.description));
    console.log(`\nGraphQL: type ${g.type} · list ${g.listField} · one row ${g.byIdField}(id:) · sort ${g.orderBy}`);
    console.log("\nFields:");
    for (const f of d.fields) {
      const ref = d.references[f.name];
      const extra = [
        d.keyField === f.name ? "key" : "", f.required ? "required" : "", f.isUnique ? "unique" : "", f.deprecated ? "DEPRECATED" : "",
        ref ? `→ ${ref.dataset} (matched by ${ref.matchField})` : "",
      ].filter(Boolean).join(", ");
      console.log(`  ${g.fields[f.name]?.padEnd(22) ?? f.name.padEnd(22)} ${f.type.padEnd(10)} ${extra}${f.description ? dim(`  ${f.description}`) : ""}`);
    }
    if (g.related.length) console.log(`\nReferenced by: ${g.related.map((r: any) => `${r.field} (${r.type})`).join(", ")}`);
    const sample = d.fields.filter((f: any) => !f.deprecated).slice(0, 4).map((f: any) => {
      const ref = d.references[f.name];
      return ref?.graphql ? `${g.fields[f.name]} { ${ref.graphql.label} }` : g.fields[f.name];
    });
    console.log(dim(`\nExample: commons query '{ ${g.listField}(first: 5) { totalCount nodes { ${sample.join(" ")} } } }'`));
  }));

function printReport(r: any) {
  const ok = r.status === "ok" || r.status === "dry_run";
  console.log((ok ? green : red)(`${r.status === "dry_run" ? "Check: " : ""}${r.message}`));
  for (const [field, u] of Object.entries<any>(r.unresolved ?? {})) {
    console.log(`  ${u.count} row(s) in "${field}" point to unknown ${u.target}: ${u.values.join(", ")}`);
  }
  for (const e of r.errors ?? []) console.log(`  row ${e.row}${e.field ? ` ${e.field}` : ""}: ${e.message}`);
  if (r.ignoredColumns?.length) console.log(dim(`  ignored columns: ${r.ignoredColumns.join(", ")}`));
  if (!ok) process.exitCode = 1;
}

async function uploadFile(c: Commons, slug: string, file: string, fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) form.append(k, v);
  form.append("file", new Blob([await readFile(file)]), basename(file));
  return c.upload(`/api/datasets/${slug}/ingest`, form);
}

datasets
  .command("upload <slug> <file>")
  .description("Upload a CSV, JSON or JSON Lines file into a dataset (needs the datasets:write scope)")
  .option("--mode <mode>", "append, upsert (by key field) or replace", "append")
  .option("--skip-bad-rows", "skip rows with bad values instead of rejecting the file")
  .option("--unresolved <policy>", "unknown references: reject, skip or null")
  .option("--dry-run", "check the file without writing anything")
  .action(run(async (slug: string, file: string, opts) => {
    const c = await Commons.connect();
    printReport(await uploadFile(c, slug, file, {
      mode: opts.mode, onError: opts.skipBadRows ? "skip" : "reject", unresolved: opts.unresolved, dryRun: String(!!opts.dryRun),
    }));
  }));

const FIELD_TYPES = ["text", "integer", "number", "boolean", "date", "timestamp", "json", "reference"];

datasets
  .command("add-field <slug>")
  .description("Add a field (column) to a dataset. It starts empty; fill it with an upload (needs the datasets:write scope).")
  .requiredOption("--name <name>", "field name: lowercase letters, digits and underscores, e.g. region")
  .option("--type <type>", `one of ${FIELD_TYPES.join(", ")}`, "text")
  .option("--label <label>", "display name (default: from the name)")
  .option("--description <text>", "what the field holds")
  .option("--required", "every row must have a value (only allowed while the dataset is empty)")
  .option("--unique", "no two rows may share a value")
  .option("--to <dataset>", "for --type reference: the dataset it points to")
  .option("--match <field>", "for references: the unique field your files use to match rows (default: that dataset's key)")
  .option("--on-delete <action>", "for references: restrict (default) or set_null when the referenced row is deleted")
  .option("--unresolved <policy>", "for references: what uploads do with unknown values: reject (default), skip or null")
  .action(run(async (slug: string, opts) => {
    if (!FIELD_TYPES.includes(opts.type)) throw new Error(`--type must be one of ${FIELD_TYPES.join(", ")}`);
    if (opts.type === "reference" && !opts.to) throw new Error("A reference needs --to <dataset>");
    if (opts.type !== "reference" && (opts.to || opts.match)) throw new Error("--to and --match are for --type reference");
    const c = await Commons.connect();
    const ds = await c.post(`/api/datasets/${slug}/fields`, {
      name: opts.name, type: opts.type, label: opts.label, description: opts.description ?? "",
      required: !!opts.required, unique: !!opts.unique,
      reference: opts.type === "reference"
        ? { dataset: opts.to, matchField: opts.match, onDelete: opts.onDelete ?? "restrict", unresolved: opts.unresolved ?? "reject" }
        : undefined,
    });
    const f = ds.fields.find((x: any) => x.name === opts.name);
    const ref = ds.references?.[opts.name];
    console.log(green(`Added ${f.label} (${f.name}) to ${ds.name}`) + dim(` · ${f.type}${ref ? ` → ${ref.dataset} by ${ref.matchField}` : ""}`));
    console.log(dim(`GraphQL: ${ds.graphql?.fields[f.name]}${ref ? ` (id column: ${ds.graphql?.inputs[f.name]})` : ""}`));
    console.log(dim(`Fill it with an upload that has a "${ref ? ref.matchField : f.name}" column, e.g. commons datasets upload ${ds.slug} file.csv --mode upsert`));
  }));

datasets
  .command("create <file>")
  .description("Create a dataset from a file: guess the fields, link to existing datasets you confirm, then upload")
  .requiredOption("--name <name>", "dataset name")
  .option("--slug <slug>", "dataset id (default: from the name)")
  .option("--key <field>", "key field (default: guessed)")
  .option("--visibility <v>", "private, shared, department, or company (any signed-in user)", "private")
  .option("--department <name>", "with --visibility department: which of your departments (name or slug)")
  .option("--description <text>", "what's in it")
  .option("--link <field=dataset>", "make a column a reference, e.g. city_code=cities (repeatable)", (v: string, all: string[]) => [...all, v], [] as string[])
  .option("--yes", "accept every suggested link to an existing dataset")
  .action(run(async (file: string, opts) => {
    const c = await Commons.connect();
    const form = new FormData();
    form.append("file", new Blob([await readFile(file)]), basename(file));
    const inferred = await c.upload("/api/infer", form);
    const similar = inferred.suggestions.similar as any[];
    if (similar.length) {
      console.log(dim("These existing datasets look similar; consider using or extending them instead:"));
      for (const s of similar) console.log(dim(`  ${s.slug} (${s.reasons.join(", ")})`));
    }
    const links = new Map<string, string>(opts.link.map((l: string) => l.split("=") as [string, string]));
    if (opts.yes) for (const r of inferred.suggestions.references) if (!links.has(r.field)) links.set(r.field, r.dataset);
    const unused = (inferred.suggestions.references as any[]).filter((r) => !links.has(r.field));
    for (const r of unused) console.log(dim(`Suggestion: ${r.reason}. Add --link ${r.field}=${r.dataset} to link it.`));

    const keyField = opts.key ?? inferred.keyField;
    const fields = inferred.fields.map((f: any) => {
      const target = links.get(f.name);
      if (!target) return { name: f.name, type: f.type, required: f.required, unique: f.unique };
      const ref = inferred.suggestions.references.find((r: any) => r.field === f.name && r.dataset === target);
      return {
        name: ref?.suggestedName ?? f.name.replace(/_(code|id|key)$/, ""), type: "reference", required: f.required,
        reference: { dataset: target, matchField: ref?.matchField },
      };
    });
    const ds = await c.post("/api/datasets", {
      name: opts.name, slug: opts.slug, description: opts.description ?? "", visibility: opts.visibility,
      departmentId: opts.visibility === "department" ? await departmentId(c, opts.department ?? "") : undefined,
      keyField: links.has(keyField) ? null : keyField, fields,
    });
    console.log(green(`Created ${ds.slug} with ${ds.fields.length} fields`) + dim(` (${ds.fields.map((f: any) => f.type === "reference" ? `${f.name} → ${f.reference?.toSlug}` : f.name).join(", ")})`));
    printReport(await uploadFile(c, ds.slug, file, { mode: "append" }));
  }));

// ---- Data ----
program
  .command("query <graphql>")
  .description("Run a GraphQL query as yourself and print the result")
  .option("--vars <json>", "variables as JSON")
  .option("--limit <n>", "show at most this many items per list", "50")
  .action(run(async (query: string, opts) => {
    const c = await Commons.connect();
    const r = await c.graphql(query, opts.vars ? JSON.parse(opts.vars) : undefined);
    if (r.errors?.length) throw new Error(r.errors.map((e) => e.message).join("\n"));
    const { value, truncated } = truncateLists(r.data, Number(opts.limit));
    print(value);
    if (truncated) console.error(dim(`(lists cut to ${opts.limit} items; use --limit to see more)`));
  }));

program
  .command("schema")
  .description("Save the GraphQL schema (to .commons/schema.graphql in a page folder, otherwise print it)")
  .option("--out <file>", "where to write it")
  .action(run(async (opts) => {
    const c = await Commons.connect();
    const sdk = await c.get("/api/sdk");
    if (opts.out || existsSync("commons.json")) {
      await writeSdk(".", sdk);
      console.log(green("Updated .commons/schema.graphql and .commons/types"));
    } else print(sdk.schema);
  }));

// ---- Pages ----
const pages = program.command("pages").description("Build Commons pages with your own editor or coding agent");

pages.command("list").description("Pages you can see or edit").action(run(async () => {
  const c = await Commons.connect();
  for (const p of await c.get("/api/pages")) {
    console.log(`${p.slug.padEnd(28)} ${p.title.padEnd(30)} ${p.publishedVersion ? `v${p.publishedVersion} live` : "draft"}${dim(` · latest v${p.latestVersion ?? "-"} · ${p.teamName ?? p.ownerName}`)}`);
  }
}));

pages
  .command("new <slug>")
  .description("Create a page folder from the starter template, with types and schema for local checks")
  .option("--title <title>", "page title")
  .option("--dir <dir>", "folder to create (default: the slug)")
  .action(run(async (slug: string, opts) => {
    const c = await Commons.connect();
    const dir = resolve(opts.dir ?? slug);
    if (existsSync(resolve(dir, "commons.json"))) throw new Error(`${dir} already has a page`);
    const sdk = await c.get("/api/sdk");
    await writeFiles(dir, sdk.template);
    await writeFiles(dir, { "commons.json": JSON.stringify({ slug, title: opts.title ?? slug.replace(/-/g, " ").replace(/^\w/, (s) => s.toUpperCase()), description: "" }, null, 2) + "\n" });
    await writeSdk(dir, sdk);
    console.log(green(`Created ${dir}`));
    console.log(`Next: cd ${opts.dir ?? slug}, edit Page.tsx (or ask your coding agent; see AGENTS.md), then \`commons pages push\`.`);
  }));

pages
  .command("pull <slug>")
  .description("Download a page's source (latest version, or --version)")
  .option("--version <n>", "a specific version")
  .option("--dir <dir>", "folder (default: the slug)")
  .action(run(async (slug: string, opts) => {
    const c = await Commons.connect();
    const page = await c.get(`/api/pages/${slug}`);
    const version = opts.version ?? page.versions[0]?.version;
    if (!version) throw new Error("That page has no versions yet");
    const v = await c.get(`/api/pages/${slug}/versions/${version}`);
    const dir = resolve(opts.dir ?? slug);
    const sdk = await c.get("/api/sdk");
    const tooling = Object.fromEntries(Object.entries(sdk.template as Record<string, string>).filter(([n]) => !n.endsWith(".tsx") && n !== "commons.json"));
    await writeFiles(dir, { ...tooling, ...v.files, "commons.json": JSON.stringify({ slug, title: page.title, description: page.description }, null, 2) + "\n" });
    await writeSdk(dir, sdk);
    console.log(green(`Pulled ${slug} v${version} into ${dir}`));
  }));

async function push(opts: { message?: string; publish?: boolean; draft?: boolean; quiet?: boolean }) {
  const c = await Commons.connect();
  const manifest = await readManifest(".");
  const files = await collectPageFiles(".");
  const r = await c.post(`/api/pages/${manifest.slug}/versions`, {
    files, message: opts.message, publish: !!opts.publish, draft: !!opts.draft, title: manifest.title, description: manifest.description,
  }, [422]);
  if (r.status === "ready") {
    console.log(green(`✓ v${r.version} built${r.published ? " and published" : ""}`) + dim(` (${Object.keys(files).length} file(s))`));
    for (const line of String(r.log).split("\n").slice(1)) console.log(dim(`  ${line}`));
    console.log(`  ${r.published ? "Live at" : "Preview"}: ${r.url}`);
    if (!r.published && !opts.draft && !opts.quiet) console.log(dim(`  Publish with: commons pages publish ${r.version}`));
  } else {
    console.log(red(`✗ v${r.version} failed to build`));
    for (const i of r.issues as BuildIssue[]) console.log(`  ${formatIssue(i)}`);
    process.exitCode = 1;
  }
  return r;
}

pages
  .command("push")
  .description("Upload this folder's source; Commons checks and builds it and prints any errors")
  .option("-m, --message <message>", "what changed")
  .option("--publish", "make it live if the build succeeds")
  .option("--draft", "a scratch version (won't be offered for publishing)")
  .action(run(push));

pages
  .command("publish [version]")
  .description("Make a version live (default: the latest)")
  .action(run(async (version?: string) => {
    const c = await Commons.connect();
    const { slug } = await readManifest(".");
    const page = await c.get(`/api/pages/${slug}`);
    const v = version ? Number(version) : page.versions.find((x: any) => x.status === "ready")?.version;
    if (!v) throw new Error("No version that built successfully");
    await c.post(`/api/pages/${slug}/publish`, { version: v });
    console.log(green(`v${v} is live`));
  }));

pages
  .command("dev")
  .description("Push a draft whenever a file changes, and print the preview link")
  .action(run(async () => {
    await readManifest(".");
    console.log(dim("Watching for changes. Press Ctrl+C to stop."));
    await push({ draft: true, quiet: true }).catch((e) => console.error(red(e.message)));
    let timer: NodeJS.Timeout | undefined;
    watch(".", { recursive: true }, (_e, name) => {
      if (!name || name.startsWith(".") || name.includes("node_modules") || !/\.(tsx?|graphql|json)$/.test(name)) return;
      clearTimeout(timer);
      timer = setTimeout(() => void push({ draft: true, quiet: true }).catch((e) => console.error(red(e.message))), 400);
    });
    await new Promise(() => {});
  }));

program.parseAsync().catch((e) => {
  console.error(red(e instanceof CommonsApiError ? e.message : String(e)));
  process.exit(1);
});


