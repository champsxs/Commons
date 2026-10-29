import { afterAll, describe, expect, it } from "vitest";
import { getApp, tokenFor, userId } from "./helpers.ts";
import { signSession } from "../src/auth/auth.ts";
import { config } from "../src/config.ts";
import { pool } from "../src/db/pool.ts";

afterAll(async () => (await getApp()).close());

async function req(method: string, url: string, opts: { body?: unknown; token?: string; session?: string } = {}) {
  const app = await getApp();
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.session) headers.cookie = `commons_session=${opts.session}`;
  const res = await app.inject({ method: method as any, url, headers, payload: opts.body as any });
  return { status: res.statusCode, body: res.headers["content-type"]?.includes("json") ? res.json() : res.body };
}

describe("browser sign-in for the CLI", () => {
  it("issues a token once, after approval in the web app", async () => {
    const start = await req("POST", "/api/auth/device", { body: { name: "commons CLI on test-mac" } });
    expect(start.body.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(start.body.verificationUrl).toContain(`/cli-login?code=${start.body.userCode}`);
    const { deviceCode, userCode } = start.body;

    expect((await req("POST", "/api/auth/device/token", { body: { deviceCode } })).status).toBe(202);

    const session = await signSession(await userId("carol@example.com"));
    const info = await req("GET", `/api/auth/device/${userCode}`, { session });
    expect(info.body).toEqual({ code: userCode, client: "commons CLI on test-mac", status: "pending" });

    // A token holder can't approve: only a signed-in browser session can
    const viaToken = await req("POST", `/api/auth/device/${userCode}/approve`, { token: await tokenFor("carol@example.com"), body: {} });
    expect(viaToken.status).toBe(403);

    const ok = await req("POST", `/api/auth/device/${userCode}/approve`, { session, body: { scopes: ["data:read", "datasets:write"] } });
    expect(ok.status).toBe(200);

    const claimed = await req("POST", "/api/auth/device/token", { body: { deviceCode } });
    expect(claimed.status).toBe(200);
    const me = await req("GET", "/api/me", { token: claimed.body.token });
    expect(me.body).toMatchObject({ email: "carol@example.com", scopes: ["data:read", "datasets:write"] });

    // Handed over exactly once
    expect((await req("POST", "/api/auth/device/token", { body: { deviceCode } })).status).toBe(410);
    expect((await req("POST", `/api/auth/device/${userCode}/approve`, { session, body: {} })).status).toBe(400);
  });

  it("reports a denied sign-in to the CLI", async () => {
    const start = await req("POST", "/api/auth/device", { body: {} });
    const session = await signSession(await userId("bob@example.com"));
    await req("POST", `/api/auth/device/${start.body.userCode}/deny`, { session });
    const r = await req("POST", "/api/auth/device/token", { body: { deviceCode: start.body.deviceCode } });
    expect(r).toMatchObject({ status: 403, body: { status: "denied" } });
  });

  it("rejects unknown device codes", async () => {
    expect((await req("POST", "/api/auth/device/token", { body: { deviceCode: "nope" } })).status).toBe(404);
  });
});

describe("CLI download", () => {
  it("serves the CLI with this server's address baked in", async () => {
    const r = await req("GET", "/cli/commons.mjs");
    if (r.status === 503) return; // CLI not built in this checkout
    expect(r.body).toContain('BAKED_URL = "http://localhost:4000"');
    expect(r.body).not.toContain("__COMMONS_DEFAULT_URL__");
  });

  it("serves install scripts for macOS/Linux and Windows with this server's address", async () => {
    const sh = await req("GET", "/cli/install.sh");
    expect(sh.body).toContain('BASE="http://localhost:4000"');
    expect(sh.body).toContain("/cli/download/$OS-$ARCH");
    expect(sh.body).not.toContain("__BASE__");
    const ps1 = await req("GET", "/cli/install.ps1");
    expect(ps1.body).toContain('$base = "http://localhost:4000"');
    expect(ps1.body).toContain("/cli/download/windows-x64");
  });

  it("serves standalone programs for known platforms only", async () => {
    expect((await req("GET", "/cli/download/plan9-x64")).status).toBe(404);
    const version = await req("GET", "/cli/version");
    for (const p of version.body.standalone) {
      const app = await getApp();
      const res = await app.inject({ url: `/cli/download/${p}`, method: "HEAD" });
      expect(res.statusCode).toBe(200);
      expect(Number(res.headers["content-length"])).toBeGreaterThan(10_000_000);
    }
  });
});

describe("CLI versions", () => {
  const asCli = async (url: string, version: string, extra: Record<string, string> = {}) => {
    const res = await (await getApp()).inject({ url, headers: { "x-commons-cli-version": version, ...extra } });
    return { status: res.statusCode, headers: res.headers, body: res.body };
  };

  it("reports the latest and minimum version to CLIs only", async () => {
    const v = JSON.parse((await asCli("/cli/version", "0.1.0")).body);
    expect(v.latest).toMatch(/^\d+\.\d+\.\d+$/);
    const r = await asCli("/api/help", "0.1.0");
    expect(r.headers["x-commons-cli-latest"]).toBe(v.latest);
    const plain = await (await getApp()).inject({ url: "/api/help" });
    expect(plain.headers["x-commons-cli-latest"]).toBeUndefined();
  });

  it("tells CLIs below the minimum to update, but still lets them update and read help", async () => {
    config.cliMinVersion = "9.0.0";
    try {
      const token = await tokenFor("carol@example.com");
      const blocked = await asCli("/api/me", "0.2.0", { authorization: `Bearer ${token}` });
      expect(blocked.status).toBe(426);
      expect(JSON.parse(blocked.body).error).toMatch(/needs CLI 9\.0\.0 or newer \(you have 0\.2\.0\)\. Run: commons update/);
      expect((await asCli("/cli/version", "0.2.0")).status).toBe(200);
      expect((await asCli("/cli/commons.mjs", "0.2.0")).status).not.toBe(426);
      expect((await asCli("/api/help/cli", "0.2.0")).status).toBe(200);
      expect((await asCli("/api/me", "9.1.0", { authorization: `Bearer ${token}` })).status).toBe(200);
    } finally {
      config.cliMinVersion = "0.0.0";
    }
  });

  it("records the CLI version in the audit log", async () => {
    const token = await tokenFor("carol@example.com");
    await (await getApp()).inject({
      method: "POST", url: "/graphql", payload: { query: "{ allStores { totalCount } }" },
      headers: { authorization: `Bearer ${token}`, "x-commons-client": "cli", "x-commons-cli-version": "0.2.0" },
    });
    const { rows } = await pool.query("select client from commons.audit_log where action = 'graphql.query' order by id desc limit 1");
    expect(rows[0].client).toBe("cli@0.2.0");
  });
});
