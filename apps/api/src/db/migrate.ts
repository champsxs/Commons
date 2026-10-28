import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tx } from "./pool.ts";

const dir = fileURLToPath(new URL("./migrations/", import.meta.url));

export async function migrate(): Promise<string[]> {
  return tx(async (db) => {
    await db.query("select pg_advisory_xact_lock(424242)");
    await db.query(`create table if not exists public.commons_migrations (name text primary key, applied_at timestamptz not null default now())`);
    const { rows } = await db.query<{ name: string }>("select name from public.commons_migrations");
    const done = new Set(rows.map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      await db.query(await readFile(dir + file, "utf8"));
      await db.query("insert into public.commons_migrations (name) values ($1)", [file]);
      applied.push(file);
    }
    return applied;
  });
}
