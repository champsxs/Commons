export async function setup() {
  process.env.DATABASE_URL = "postgres://commons:commons@localhost:5432/commons_test";
  const { pool } = await import("../src/db/pool.ts");
  await pool.query("drop schema if exists data cascade; drop schema if exists commons cascade; drop table if exists public.commons_migrations");
  const { seed } = await import("../src/seed.ts");
  await seed();
  await pool.query(`insert into commons.users (email, name) values ('dave@example.com', 'Dave Dahl')`);
  await pool.end();
}
