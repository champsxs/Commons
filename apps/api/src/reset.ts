import { pool } from "./db/pool.ts";

/** Dev only: wipes the registry and all dataset tables. */
await pool.query("drop schema if exists data cascade; drop schema if exists commons cascade; drop table if exists public.commons_migrations");
console.log("Database reset");
await pool.end();
