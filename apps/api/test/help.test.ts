import { afterAll, describe, expect, it } from "vitest";
import { getApp } from "./helpers.ts";
import { config } from "../src/config.ts";

afterAll(async () => (await getApp()).close());

const get = async (url: string) => {
  const res = await (await getApp()).inject({ url });
  return { status: res.statusCode, body: res.json() };
};

describe("help topics", () => {
  it("lists topics in group order without signing in", async () => {
    const r = await get("/api/help");
    expect(r.status).toBe(200);
    const ids = r.body.topics.map((t: any) => t.id);
    expect(ids[0]).toBe("getting-started");
    expect(ids).toEqual(expect.arrayContaining(["uploading", "cli", "mcp", "pages", "writing-pages", "graphql"]));
    expect(ids.indexOf("datasets")).toBeLessThan(ids.indexOf("uploading"));
  });

  it("fills in this server's addresses", async () => {
    const r = await get("/api/help/cli");
    expect(r.body.markdown).toContain(`curl -fsSL ${config.publicApiUrl}/cli/install.sh`);
    expect(r.body.markdown).not.toContain("{{");
  });

  it("shows development-only text only on development servers", async () => {
    expect((await get("/api/help/cli")).body.markdown).toContain("--email you@example.com");
    config.devLogin = false;
    try {
      const md = (await get("/api/help/cli")).body.markdown;
      expect(md).not.toContain("--email");
      expect(md).not.toContain("<!--");
    } finally {
      config.devLogin = true;
    }
  });

  it("makes in-app links absolute for the CLI and agents", async () => {
    expect((await get("/api/help/uploading")).body.markdown).toContain("](/help/cli)");
    expect((await get("/api/help/uploading?links=absolute")).body.markdown).toContain(`](${config.webOrigin}/help/cli)`);
  });

  it("includes the page guide from the page template", async () => {
    const r = await get("/api/help/writing-pages");
    expect(r.body.markdown).toContain("Rules the build enforces");
  });

  it("404s unknown topics", async () => {
    expect((await get("/api/help/nope")).status).toBe(404);
  });
});
