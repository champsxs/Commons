import { Kind, parse, type DocumentNode, type SelectionSetNode } from "postgraphile/graphql";
import type { FastifyInstance } from "fastify";
import { config } from "../config.ts";
import { pool } from "../db/pool.ts";
import { HttpError } from "../util/errors.ts";

function depth(set: SelectionSetNode | undefined, doc: DocumentNode, seen = new Set<string>()): number {
  if (!set) return 0;
  let max = 0;
  for (const s of set.selections) {
    if (s.kind === Kind.FIELD) max = Math.max(max, s.name.value.startsWith("__") ? 0 : 1 + depth(s.selectionSet, doc, seen));
    else if (s.kind === Kind.INLINE_FRAGMENT) max = Math.max(max, depth(s.selectionSet, doc, seen));
    else if (s.kind === Kind.FRAGMENT_SPREAD && !seen.has(s.name.value)) {
      seen.add(s.name.value);
      const frag = doc.definitions.find((d) => d.kind === Kind.FRAGMENT_DEFINITION && d.name.value === s.name.value);
      if (frag && frag.kind === Kind.FRAGMENT_DEFINITION) max = Math.max(max, depth(frag.selectionSet, doc, seen));
    }
  }
  return max;
}

/** Checks every GraphQL request before PostGraphile runs it: who's asking, how deep, and whether it may write. */
export function registerGraphqlGuard(app: FastifyInstance) {
  app.addHook("preHandler", async (req) => {
    if (req.routeOptions.url !== "/graphql" || req.method !== "POST") return;
    const auth = req.auth;
    if (!auth) throw new HttpError(401, "Sign in first");
    const body = req.body as { query?: string; operationName?: string } | undefined;
    if (!body?.query) return;
    let doc: DocumentNode;
    try {
      doc = parse(body.query);
    } catch {
      return; // let GraphQL report the syntax error
    }
    const ops = doc.definitions.filter((d) => d.kind === Kind.OPERATION_DEFINITION);
    const op = ops.find((d) => !body.operationName || d.name?.value === body.operationName) ?? ops[0];
    if (!op || op.kind !== Kind.OPERATION_DEFINITION) return;

    const d = depth(op.selectionSet, doc);
    if (d > config.limits.maxQueryDepth) throw new HttpError(400, `Query is ${d} levels deep; the limit is ${config.limits.maxQueryDepth}`);

    if (op.operation === "mutation") {
      if (auth.kind === "page" && !auth.allowWrites) throw new HttpError(403, "This page is read-only. Its owner can allow it to edit data.");
      if (auth.kind === "token" && !auth.scopes.includes("data:write")) throw new HttpError(403, "This token can read data but not change it (needs data:write)");
    }
    if (auth.kind !== "session") {
      pool
        .query("insert into commons.audit_log (user_id, client, action, detail) values ($1,$2,$3,$4)", [
          auth.userId, auth.client, `graphql.${op.operation}`, { operationName: op.name?.value ?? null, depth: d, pageId: auth.pageId ?? null },
        ])
        .catch(() => {});
    }
  });
}
