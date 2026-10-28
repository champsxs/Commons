import pg from "pg";
import { config } from "../config.ts";

export type Db = pg.PoolClient;

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });

export async function tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Runs registry work with the acting user set, so permission helpers can see who it is. */
export function asUser<T>(userId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  return tx(async (db) => {
    await db.query("select set_config('commons.user_id', $1, true)", [userId]);
    return fn(db);
  });
}

/** Runs data access as the restricted role, so row-level security applies. */
export function asDataUser<T>(userId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  return asUser(userId, async (db) => {
    await db.query("set local role commons_user");
    return fn(db);
  });
}
