import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.ts";
import { pool } from "../db/pool.ts";
import { HttpError } from "../util/errors.ts";

export interface Auth {
  userId: string;
  kind: "session" | "token" | "page";
  /** Which tool is calling: web, cli, mcp, claude-code, codex... from the X-Commons-Client header */
  client: string;
  scopes: string[];
  /** For page tokens: the page whose code is making the request */
  pageId?: string;
  allowWrites?: boolean;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: Auth;
  }
}

const secret = new TextEncoder().encode(config.sessionSecret);
export const SESSION_COOKIE = "commons_session";

export async function signSession(userId: string) {
  return new SignJWT({ kind: "session" }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("7d").sign(secret);
}

/** Short-lived token a page's sandboxed iframe uses to query data as the person viewing it. */
export async function signPageToken(userId: string, pageId: string, allowWrites: boolean) {
  return new SignJWT({ kind: "page", pageId, allowWrites })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(secret);
}

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export async function createApiToken(userId: string, name: string, scopes: string[], days = 90) {
  const token = `cmn_${randomBytes(24).toString("base64url")}`;
  const { rows } = await pool.query(
    `insert into commons.api_tokens (user_id, name, token_hash, scopes, expires_at)
     values ($1, $2, $3, $4, now() + make_interval(days => $5)) returning id, name, scopes, expires_at, created_at`,
    [userId, name, hashToken(token), scopes, days],
  );
  return { token, ...rows[0] };
}

async function fromBearer(token: string, client: string): Promise<Auth | null> {
  if (token.startsWith("cmn_")) {
    const { rows } = await pool.query(
      `update commons.api_tokens set last_used_at = now()
       where token_hash = $1 and (expires_at is null or expires_at > now()) returning user_id, scopes`,
      [hashToken(token)],
    );
    if (!rows[0]) return null;
    return { userId: rows[0].user_id, kind: "token", client, scopes: rows[0].scopes };
  }
  try {
    const { payload } = await jwtVerify(token, secret);
    if (payload.kind === "page") {
      return {
        userId: payload.sub!, kind: "page", client: "page", scopes: ["data:read"],
        pageId: payload.pageId as string, allowWrites: !!payload.allowWrites,
      };
    }
  } catch {}
  return null;
}

export async function authenticate(req: FastifyRequest): Promise<Auth | null> {
  const client = String(req.headers["x-commons-client"] ?? "web").slice(0, 40);
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return fromBearer(header.slice(7).trim(), client);
  const cookie = req.cookies?.[SESSION_COOKIE];
  if (cookie) {
    try {
      const { payload } = await jwtVerify(cookie, secret);
      if (payload.kind === "session") return { userId: payload.sub!, kind: "session", client, scopes: ["*"] };
    } catch {}
  }
  return null;
}

export function requireAuth(req: FastifyRequest, scope?: string): Auth {
  const a = req.auth;
  if (!a) throw new HttpError(401, "Sign in first");
  if (a.kind === "page") throw new HttpError(403, "Page code can only use the data API");
  if (scope && !a.scopes.includes("*") && !a.scopes.includes(scope)) throw new HttpError(403, `This token lacks the ${scope} scope`);
  return a;
}

export function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 7 * 24 * 3600 });
}
