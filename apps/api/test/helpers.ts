import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/http/app.ts";
import { pool } from "../src/db/pool.ts";
import { createApiToken, signPageToken } from "../src/auth/auth.ts";

let app: FastifyInstance | undefined;
export async function getApp() {
  app ??= await buildApp();
  return app;
}

export async function userId(email: string): Promise<string> {
  const { rows } = await pool.query("select id from commons.users where email = $1", [email]);
  return rows[0].id;
}

const tokens = new Map<string, string>();
/** A bearer token with every scope, for acting as a user in tests. */
export async function tokenFor(email: string, scopes = ["data:read", "data:write", "datasets:write", "pages:write"]) {
  const key = email + scopes.join();
  if (!tokens.has(key)) tokens.set(key, (await createApiToken(await userId(email), "test", scopes)).token);
  return tokens.get(key)!;
}

export async function pageTokenFor(email: string, allowWrites = false) {
  return signPageToken(await userId(email), "00000000-0000-0000-0000-000000000000", allowWrites);
}

export async function api(method: string, url: string, token: string, body?: unknown) {
  const a = await getApp();
  const res = await a.inject({ method: method as any, url, headers: { authorization: `Bearer ${token}` }, payload: body as any });
  return { status: res.statusCode, body: res.json() };
}

export async function gql(token: string, query: string, variables?: object) {
  const r = await api("POST", "/graphql", token, { query, variables });
  return r.body as { data?: any; errors?: { message: string }[] } & { error?: string };
}

export async function upload(token: string, url: string, content: string, fields: Record<string, string> = {}, filename = "data.csv") {
  const a = await getApp();
  const boundary = "----commons" + Math.random().toString(16).slice(2);
  let payload = "";
  for (const [k, v] of Object.entries(fields)) {
    payload += `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
  }
  payload += `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/csv\r\n\r\n${content}\r\n--${boundary}--\r\n`;
  const res = await a.inject({
    method: "POST", url, payload,
    headers: { authorization: `Bearer ${token}`, "content-type": `multipart/form-data; boundary=${boundary}` },
  });
  return { status: res.statusCode, body: res.json() };
}
