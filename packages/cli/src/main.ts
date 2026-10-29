import { existsSync, watch } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { basename } from "node:path";
import { hostname } from "node:os";
import { Command } from "commander";
import {
  Commons, CommonsApiError, VERSION, collectPageFiles, commonsHome, compareVersions, formatIssue, loadConfig, readManifest, saveConfig,
  serverVersions, truncateLists, writeFiles, writeSdk,
  type BuildIssue,
} from "./client.ts";

const program = new Command("commons").description("Commons from the command line: explore datasets, query data, build pages.").version(VERSION);
// Options after a subcommand belong to it (e.g. --json in `datasets show x --json`, not to `datasets`)
program.enablePositionalOptions();

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
  console.log(dim(`teams: ${me.teams.map((t: any) => t.name).join(", ") || "none"} · departments: ${me.departments.map((d: any) => d.name).join(", ") || "none"} · scopes: ${me.scopes.join(", ")}`));
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
const datasets = program.command("datasets").description("List, search and inspect datasets").enablePositionalOptions();

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

const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  return s < 3600 ? `${Math.max(1, Math.round(s / 60))} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(iso).toLocaleString();
};

datasets
  .command("usage <slug>")
  .description("What depends on a dataset: datasets that reference it and published pages that read it")
  .option("--json", "print JSON")
  .action(run(async (slug: string, opts) => {
    const c = await Commons.connect();
    const u = await c.get(`/api/datasets/${slug}/usage`);
    if (opts.json) return print(u);
    if (!u.datasets.length && !u.pages.length) return console.log("Nothing depends on it yet.");
    if (u.datasets.length) console.log("Referenced by datasets:");
    for (const d of u.datasets) console.log(`  ${d.slug.padEnd(24)} field ${d.field}, matched on ${d.matchField}${dim(` · on delete: ${d.onDelete}`)}`);
    if (u.pages.length) console.log("Read by published pages:");
    for (const p of u.pages) console.log(`  ${p.slug.padEnd(24)} ${p.title}${dim(` · fields: ${p.fields.join(", ")}`)}`);
  }));

datasets
  .command("history <slug>")
  .description("Recent uploads to a dataset: when, who, mode, rows and result")
  .option("-n, --limit <n>", "how many", "10")
  .option("--json", "print JSON")
  .action(run(async (slug: string, opts) => {
    const c = await Commons.connect();
    const runs = (await c.get(`/api/datasets/${slug}/ingests`)).slice(0, Number(opts.limit));
    if (opts.json) return print(runs);
    if (!runs.length) return console.log("No uploads yet.");
    for (const r of runs) {
      const status = r.status === "ok" ? green("ok    ") : red("failed");
      console.log(`${status} ${ago(r.created_at).padEnd(20)} ${r.mode.padEnd(8)} ${String(r.rows_inserted).padStart(7)} rows  ${r.filename ?? ""}${dim(` · ${r.user_name}`)}`);
      if (r.status !== "ok" && r.report?.message) console.log(dim(`       ${r.report.message}`));
    }
  }));

/** Accepts a team's slug or name. */
async function teamId(c: Commons, nameOrSlug: string): Promise<string> {
  const teams: { id: string; slug: string; name: string }[] = await c.get("/api/teams");
  const t = teams.find((x) => x.slug === nameOrSlug || x.name.toLowerCase() === nameOrSlug.toLowerCase());
  if (!t) throw new Error(`No team "${nameOrSlug}". Teams: ${teams.map((x) => x.slug).join(", ")}`);
  return t.id;
}

/** "team:retail-ops" or a person's email -> a share entry. */
async function shareTarget(c: Commons, who: string): Promise<{ teamId?: string; userId?: string }> {
  if (who.startsWith("team:")) return { teamId: await teamId(c, who.slice(5)) };
  const users: { id: string; email: string }[] = await c.get("/api/users");
  const u = users.find((x) => x.email.toLowerCase() === who.toLowerCase());
  if (!u) throw new Error(`No user with email ${who} (for a team, use team:<name>)`);
  return { userId: u.id };
}

const collect = (v: string, all: string[]) => [...all, v];

datasets
  .command("update <slug>")
  .description("Change a dataset's settings: name, description, visibility, team, sharing, source, license")
  .option("--name <name>")
  .option("--description <text>")
  .option("--visibility <v>", "private, shared, department, or company (any signed-in user)")
  .option("--department <name>", "with --visibility department: which of your departments")
  .option("--team <name>", "owning team (name or slug); use --no-team for none")
  .option("--no-team", "remove the owning team")
  .option("--share <who>", "share with team:<name> or a person's email (repeatable; for visibility shared)", collect, [] as string[])
  .option("--unshare <who>", "stop sharing with team:<name> or an email (repeatable)", collect, [] as string[])
  .option("--source <text>", "where the data comes from")
  .option("--license <text>")
  .option("--referenceable", "other datasets may reference this one")
  .option("--no-referenceable", "other datasets may not reference this one")
  .action(run(async (slug: string, opts) => {
    const c = await Commons.connect();
    const patch: Record<string, unknown> = {};
    for (const k of ["name", "description", "visibility", "source", "license"]) if (opts[k] !== undefined) patch[k] = opts[k];
    if (opts.referenceable !== undefined) patch.referenceable = opts.referenceable;
    if (opts.team === false) patch.teamId = null;
    else if (typeof opts.team === "string") patch.teamId = await teamId(c, opts.team);
    if (opts.visibility === "department") patch.departmentId = await departmentId(c, opts.department ?? "");
    else if (opts.department) throw new Error("--department goes with --visibility department");
    if (opts.share.length || opts.unshare.length) {
      const current = (await c.get(`/api/datasets/${slug}`)).shares.map((x: any) => ({ teamId: x.teamId ?? undefined, userId: x.userId ?? undefined }));
      const same = (a: any, b: any) => (a.teamId ?? a.userId) === (b.teamId ?? b.userId);
      const add = await Promise.all(opts.share.map((w: string) => shareTarget(c, w)));
      const remove = await Promise.all(opts.unshare.map((w: string) => shareTarget(c, w)));
      patch.shares = [...current, ...add.filter((a) => !current.some((x: any) => same(x, a)))].filter((x) => !remove.some((r) => same(r, x)));
    }
    if (!Object.keys(patch).length) throw new Error("Nothing to change. See commons datasets update --help");
    const ds = await c.request("PATCH", `/api/datasets/${slug}`, patch);
    console.log(green(`Updated ${ds.name}`) + dim(` · ${visibilityText(ds)}${ds.teamName ? ` · team ${ds.teamName}` : ""}`));
  }));

datasets
  .command("field <slug> <field>")
  .description("Change a field's label or description, or deprecate it (hidden from tables and new forms, still works)")
  .option("--label <label>")
  .option("--description <text>")
  .option("--deprecate", "mark as deprecated")
  .option("--undeprecate", "bring a deprecated field back")
  .action(run(async (slug: string, field: string, opts) => {
    const patch: Record<string, unknown> = {};
    if (opts.label !== undefined) patch.label = opts.label;
    if (opts.description !== undefined) patch.description = opts.description;
    if (opts.deprecate && opts.undeprecate) throw new Error("Choose --deprecate or --undeprecate");
    if (opts.deprecate) patch.deprecated = true;
    if (opts.undeprecate) patch.deprecated = false;
    if (!Object.keys(patch).length) throw new Error("Nothing to change. See commons datasets field --help");
    const c = await Commons.connect();
    const ds = await c.request("PATCH", `/api/datasets/${slug}/fields/${field}`, patch);
    const f = ds.fields.find((x: any) => x.name === field);
    console.log(green(`Updated ${f.label} (${f.name})`) + dim(`${f.deprecated ? " · deprecated" : ""}${f.description ? ` · ${f.description}` : ""}`));
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
  .command("versions <slug>")
  .description("A page's versions: which is live, which failed, who pushed them. --log <n> prints one version's build log")
  .option("--log <version>", "print the build log of this version")
  .option("--json", "print JSON")
  .action(run(async (slug: string, opts) => {
    const c = await Commons.connect();
    if (opts.log) {
      const v = await c.get(`/api/pages/${slug}/versions/${opts.log}`);
      console.log(`v${v.version} · ${v.status} · ${v.createdBy}${v.message ? ` · ${v.message}` : ""}`);
      return console.log(v.log);
    }
    const p = await c.get(`/api/pages/${slug}`);
    if (opts.json) return print(p.versions);
    console.log(`${p.title} · ${p.publishedVersion ? `v${p.publishedVersion} live` : "not published"} · ${visibilityText(p)}${p.allowWrites ? " · may change data" : ""}`);
    for (const v of p.versions) {
      const mark = v.id === p.publishedVersionId ? green("live  ") : v.status === "failed" ? red("failed") : v.status === "building" ? "build " : "      ";
      console.log(`  v${String(v.version).padEnd(4)} ${mark} ${ago(v.createdAt).padEnd(20)} ${v.message ?? ""}${dim(` · ${v.createdBy}${v.client ? ` via ${v.client}` : ""}`)}`);
    }
  }));

pages
  .command("update <slug>")
  .description("Change a page's title, description, visibility, or whether it may change data")
  .option("--title <title>")
  .option("--description <text>")
  .option("--visibility <v>", "private, department, or company (any signed-in user)")
  .option("--department <name>", "with --visibility department: which of your departments")
  .option("--allow-writes", "let the page save changes (as the viewer, within their rights)")
  .option("--no-allow-writes", "make the page read-only")
  .action(run(async (slug: string, opts) => {
    const c = await Commons.connect();
    const patch: Record<string, unknown> = {};
    for (const k of ["title", "description", "visibility"]) if (opts[k] !== undefined) patch[k] = opts[k];
    if (opts.allowWrites !== undefined) patch.allowWrites = opts.allowWrites;
    if (opts.visibility === "department") patch.departmentId = await departmentId(c, opts.department ?? "");
    else if (opts.department) throw new Error("--department goes with --visibility department");
    if (!Object.keys(patch).length) throw new Error("Nothing to change. See commons pages update --help");
    const p = await c.request("PATCH", `/api/pages/${slug}`, patch);
    console.log(green(`Updated ${p.title}`) + dim(` · ${visibilityText(p)}${p.allowWrites ? " · may change data" : " · read-only"}`));
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

// ---- Updates ----

/** The "## 0.3.0" sections of the What's new help topic that are newer than `since`. */
async function whatsNewSince(url: string, since: string) {
  try {
    const res = await fetch(`${url}/api/help/whats-new?links=absolute`);
    if (!res.ok) return "";
    const { markdown } = await res.json();
    return (markdown as string)
      .split(/^(?=## )/m)
      .filter((part) => {
        const v = part.match(/^## (\d+\.\d+\.\d+)/)?.[1];
        return v && compareVersions(v, since) > 0;
      })
      .join("\n")
      .trim();
  } catch {
    return "";
  }
}

program
  .command("update")
  .description("Update the commons CLI to the version your Commons server offers")
  .option("--check", "only say whether an update is available")
  .action(run(async (opts) => {
    const url = ((await loadConfig())?.url ?? DEFAULT_URL).replace(/\/$/, "");
    const res = await fetch(`${url}/cli/version`).catch(() => {
      throw new Error(`Can't reach Commons at ${url}`);
    });
    if (!res.ok) throw new Error(`Couldn't check for updates (${res.status})`);
    const { latest } = await res.json();
    if (VERSION !== "dev" && compareVersions(VERSION, latest) >= 0) return console.log(green(`commons ${VERSION} is up to date`));
    console.log(`Update available: ${VERSION} → ${latest}`);
    if (opts.check) return;

    const self = await realpath(fileURLToPath(import.meta.url));
    if (VERSION === "dev" || self.endsWith(join("packages", "cli", "dist", "commons.mjs"))) {
      throw new Error("This is a development build of the CLI. Update it with git pull and pnpm build instead.");
    }
    // Download next to the current file, check it runs, then swap it in
    // .mjs so Node will run it for the check below; it becomes `commons` again when swapped in
    const next = `${self}.download.mjs`;
    const download = await fetch(`${url}/cli/commons.mjs`);
    if (!download.ok) throw new Error(`Download failed (${download.status})`);
    await writeFile(next, Buffer.from(await download.arrayBuffer()));
    await chmod(next, 0o755);
    try {
      const got = execFileSync(process.execPath, [next, "--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
      if (got !== latest) throw new Error(`the download reports version ${got}`);
    } catch (e) {
      await rm(next, { force: true });
      throw new Error(`The downloaded CLI didn't start, so nothing was changed: ${(e as Error).message}`);
    }
    await rename(next, self);
    console.log(green(`Updated commons ${VERSION} → ${latest}`));
    const notes = await whatsNewSince(url, VERSION);
    if (notes) console.log(`\n${formatMarkdown(notes)}`);
  }));

/**
 * After a command, mention a newer CLI at most once a day. Never in scripts: not with --json,
 * when output isn't a terminal, in CI, or with COMMONS_NO_UPDATE_CHECK=1.
 */
async function updateNotice(command: string) {
  const latest = serverVersions.latest;
  if (!latest || VERSION === "dev" || compareVersions(VERSION, latest) >= 0) return;
  if (command === "update" || process.argv.includes("--json") || !process.stderr.isTTY) return;
  if (process.env.CI || process.env.COMMONS_NO_UPDATE_CHECK) return;
  const stateFile = join(commonsHome(), "update-check.json");
  try {
    const state = JSON.parse(await readFile(stateFile, "utf8"));
    if (state.latest === latest && Date.now() - state.shownAt < 24 * 3600 * 1000) return;
  } catch {}
  console.error(dim(`\nUpdate available: commons ${VERSION} → ${latest}. Run: commons update`));
  await mkdir(dirname(stateFile), { recursive: true }).catch(() => {});
  await writeFile(stateFile, JSON.stringify({ latest, shownAt: Date.now() })).catch(() => {});
}

program.hook("postAction", async (_cmd, action) => updateNotice(action.name()));

program.parseAsync().catch((e) => {
  console.error(red(e instanceof CommonsApiError ? e.message : String(e)));
  process.exit(1);
});


