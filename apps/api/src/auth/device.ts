import { randomBytes, randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.ts";
import { pool, tx } from "../db/pool.ts";
import { HttpError, badRequest } from "../util/errors.ts";
import { createApiToken, hashToken, requireAuth } from "./auth.ts";

const LIFETIME_MIN = 10;
const SCOPES = ["data:read", "data:write", "datasets:write", "pages:write"];
// No 0/O, 1/I/L: easy to compare by eye
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const userCode = () => Array.from({ length: 8 }, (_, i) => (i === 4 ? "-" : "") + ALPHABET[randomInt(ALPHABET.length)]).join("");

/**
 * Browser sign-in for the CLI (an OAuth-style device flow):
 * 1. the CLI asks for a login and shows a short code and a link,
 * 2. the person opens the link while signed in to Commons, checks the code and approves,
 * 3. the CLI, polling with its secret, receives a fresh API token exactly once.
 */
export function registerDeviceLogin(app: FastifyInstance) {
  app.post("/api/auth/device", async (req) => {
    const { name } = z.object({ name: z.string().max(80).default("commons CLI") }).parse(req.body ?? {});
    const deviceCode = randomBytes(32).toString("base64url");
    const code = userCode();
    await pool.query(
      `insert into commons.cli_logins (device_hash, user_code, client_name, expires_at)
       values ($1, $2, $3, now() + make_interval(mins => $4))`,
      [hashToken(deviceCode), code, name, LIFETIME_MIN],
    );
    return {
      deviceCode,
      userCode: code,
      verificationUrl: `${config.webOrigin}/cli-login?code=${code}`,
      interval: 2,
      expiresIn: LIFETIME_MIN * 60,
    };
  });

  /** The approval screen reads the request to show what is asking for access. */
  app.get("/api/auth/device/:code", async (req) => {
    requireAuth(req);
    const { rows } = await pool.query(
      "select user_code, client_name, status, expires_at < now() as expired from commons.cli_logins where user_code = $1",
      [String((req.params as any).code).toUpperCase()],
    );
    if (!rows[0]) throw new HttpError(404, "That code doesn't match a sign-in request. Check it, or run commons login again.");
    return { code: rows[0].user_code, client: rows[0].client_name, status: rows[0].expired && rows[0].status === "pending" ? "expired" : rows[0].status };
  });

  app.post("/api/auth/device/:code/:decision", async (req) => {
    const a = requireAuth(req);
    // Only someone signed in to the web app may approve, so a stolen token can't mint more tokens
    if (a.kind !== "session") throw new HttpError(403, "Approve sign-ins from the Commons web app");
    const { code, decision } = req.params as { code: string; decision: string };
    if (decision !== "approve" && decision !== "deny") throw new HttpError(404, "Not found");
    const { rows } = await pool.query(
      "select id, client_name from commons.cli_logins where user_code = $1 and status = 'pending' and expires_at > now()",
      [code.toUpperCase()],
    );
    if (!rows[0]) throw badRequest("This sign-in request has expired or was already handled. Run commons login again.");
    if (decision === "deny") {
      await pool.query("update commons.cli_logins set status = 'denied', user_id = $2 where id = $1", [rows[0].id, a.userId]);
      return { ok: true };
    }
    const scopes = z.array(z.enum(SCOPES as [string, ...string[]])).min(1).parse((req.body as any)?.scopes ?? ["data:read", "pages:write"]);
    const t = await createApiToken(a.userId, rows[0].client_name, scopes);
    await pool.query("update commons.cli_logins set status = 'approved', user_id = $2, token = $3, scopes = $4 where id = $1", [rows[0].id, a.userId, t.token, scopes]);
    await pool.query("insert into commons.audit_log (user_id, client, action, detail) values ($1, 'web', 'cli.login.approve', $2)", [a.userId, { client: rows[0].client_name, scopes }]);
    return { ok: true };
  });

  /** The CLI polls this. The token is handed over once and then forgotten. */
  app.post("/api/auth/device/token", async (req, reply) => {
    const { deviceCode } = z.object({ deviceCode: z.string() }).parse(req.body);
    const r = await tx(async (db) => {
      const { rows } = await db.query(
        "select id, status, token, expires_at < now() as expired from commons.cli_logins where device_hash = $1 for update",
        [hashToken(deviceCode)],
      );
      if (rows[0]?.status === "approved") await db.query("update commons.cli_logins set status = 'claimed', token = null where id = $1", [rows[0].id]);
      return rows[0];
    });
    if (!r) throw new HttpError(404, "Unknown sign-in request");
    if (r.status === "approved") return { status: "approved", token: r.token };
    if (r.status === "denied") return reply.status(403).send({ status: "denied", error: "The sign-in was declined in the browser" });
    if (r.expired || r.status === "claimed") return reply.status(410).send({ status: "expired", error: "The sign-in request expired. Run commons login again." });
    return reply.status(202).send({ status: "pending" });
  });
}
