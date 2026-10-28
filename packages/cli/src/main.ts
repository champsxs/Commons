import { existsSync, watch } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import {
  Commons, CommonsApiError, collectPageFiles, formatIssue, readManifest, saveConfig, truncateLists, writeFiles, writeSdk,
  type BuildIssue,
} from "./client.ts";

const program = new Command("commons").description("Commons from the command line: explore datasets, query data, build pages.").version("0.1.0");

const print = (v: unknown) => console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
const dim = (s: string) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s);
const red = (s: string) => (process.stdout.isTTY ? `\x1b[31m${s}\x1b[0m` : s);
const green = (s: string) => (process.stdout.isTTY ? `\x1b[32m${s}\x1b[0m` : s);

function run(fn: (...args: any[]) => Promise<void>) {
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (e) {
      console.error(red(`Error: ${(e as Error).message}`));
      process.exitCode = 1;
    }
  };
}

program
  .command("login")
  .description("Sign in and save a token in ~/.commons/config.json")
  .option("--url <url>", "Commons API address", "http://localhost:4000")
  .option("--token <token>", "an API token from Settings → API tokens")
  .option("--email <email>", "development servers only: get a token for this user")
  .action(run(async (opts) => {
    let token: string = opts.token;
    if (!token && opts.email) {
      const res = await fetch(`${opts.url}/api/auth/dev-token`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: opts.email, name: "commons CLI" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Dev login failed; use --token instead");
      token = body.token;
    }
    if (!token) {
      console.log(`Create a token in Commons under Settings → API tokens, then paste it here.`);
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      token = (await rl.question("Token: ")).trim();
      rl.close();
    }
    const me = await new Commons({ url: opts.url, token }).get("/api/me");
    await saveConfig({ url: opts.url, token });
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
      console.log(`${d.slug.padEnd(24)} ${d.name.padEnd(28)} ${String(d.approxRows).padStart(8)} rows  ${dim(`${d.visibility} · ${d.teamName ?? d.ownerName}`)}`);
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
    console.log(`${d.name} (${d.slug}) · ${d.rowCount} rows · ${d.visibility}`);
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


