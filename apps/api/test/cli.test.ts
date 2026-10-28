import { afterAll, describe, expect, it } from "vitest";
import { getApp, tokenFor, userId } from "./helpers.ts";
import { signSession } from "../src/auth/auth.ts";

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

  it("serves an install script", async () => {
    const r = await req("GET", "/cli/install.sh");
    expect(r.body).toContain("http://localhost:4000/cli/commons.mjs");
    expect(r.body).toContain("Node.js 22");
  });
});
