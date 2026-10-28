import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { api, getApp, gql, tokenFor } from "./helpers.ts";
import { buildPagesServer } from "../src/pages/server.ts";
import { buildRuntime } from "../src/pages/runtime.ts";

let bob: string;
let pagesServer: FastifyInstance;

const GOOD = `import { Page, Stat, gql, useCommonsQuery } from "@commons/ui";

const Q = gql\`{ allStores { totalCount nodes { storeCode city { name } } } }\`;

export default function Test() {
  const { data } = useCommonsQuery<{ allStores: { totalCount: number } }>(Q);
  return <Page title="Test"><Stat label="Stores" value={data?.allStores.totalCount} /></Page>;
}
`;

beforeAll(async () => {
  bob = await tokenFor("bob@example.com");
  await buildRuntime();
  pagesServer = await buildPagesServer();
});
afterAll(async () => {
  await pagesServer.close();
  await (await getApp()).close();
});

const push = (slug: string, files: Record<string, string>, extra: object = {}) =>
  api("POST", `/api/pages/${slug}/versions`, bob, { files, title: "Test page", ...extra });

describe("page builds", () => {
  it("builds, records dependencies and publishes", async () => {
    const r = await push("store-test", { "Page.tsx": GOOD }, { publish: true, message: "first" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ version: 1, status: "ready", published: true });
    const page = await api("GET", "/api/pages/store-test", bob);
    expect(page.body.publishedVersion).toBe(1);
    expect(page.body.versions[0].dependencies).toEqual(expect.arrayContaining([
      { dataset: "stores", field: "store_code" }, { dataset: "stores", field: "city" }, { dataset: "cities", field: "name" },
    ]));
    const usage = await api("GET", "/api/datasets/cities/usage", bob);
    expect(usage.body.pages).toEqual([expect.objectContaining({ slug: "store-test", fields: ["name"] })]);
  });

  it("warns before removing a field a published page uses", async () => {
    const r = await api("DELETE", "/api/datasets/stores/fields/city", bob);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/published page/);
  });

  it("rejects imports outside react and @commons/ui", async () => {
    const r = await push("store-test", { "Page.tsx": `import _ from "lodash";\n${GOOD}` });
    expect(r.status).toBe(422);
    expect(r.body.issues).toContainEqual(expect.objectContaining({ kind: "import", file: "Page.tsx", line: 1 }));
  });

  it("rejects network and storage APIs", async () => {
    const bad = GOOD.replace("export default", `fetch("https://example.com/steal");\nconst x = window["localStorage"];\nexport default`);
    const r = await push("store-test", { "Page.tsx": bad });
    expect(r.body.issues.map((i: any) => i.kind)).toEqual(expect.arrayContaining(["safety"]));
    expect(r.body.issues.some((i: any) => i.message.includes("fetch"))).toBe(true);
    expect(r.body.issues.some((i: any) => i.message.includes("localStorage"))).toBe(true);
  });

  it("checks queries against the schema with file and line", async () => {
    const r = await push("store-test", { "Page.tsx": GOOD.replace("storeCode city", "storeCode nope city") });
    expect(r.body.issues).toContainEqual(expect.objectContaining({ kind: "graphql", file: "Page.tsx", line: 3, message: expect.stringContaining("nope") }));
  });

  it("typechecks", async () => {
    const r = await push("store-test", { "Page.tsx": GOOD.replace('label="Stores"', "label={1} nope") });
    expect(r.body.issues.some((i: any) => i.kind === "type")).toBe(true);
  });

  it("supports several files", async () => {
    const r = await push("store-test", {
      "Page.tsx": `import { Page } from "@commons/ui";\nimport { Count } from "./Count.tsx";\nexport default function P() { return <Page title="Two files"><Count /></Page>; }`,
      "Count.tsx": `import { Stat, gql, useCommonsQuery } from "@commons/ui";\nexport function Count() { const { data } = useCommonsQuery<any>(gql\`{ allCountries { totalCount } }\`); return <Stat label="Countries" value={data?.allCountries.totalCount} />; }`,
    });
    expect(r.body.status).toBe("ready");
  });

  it("refuses to publish a failed version and lets editors roll back", async () => {
    const page = await api("GET", "/api/pages/store-test", bob);
    const failed = page.body.versions.find((v: any) => v.status === "failed");
    expect((await api("POST", "/api/pages/store-test/publish", bob, { version: failed.version })).status).toBe(400);
    const latest = page.body.versions[0].version;
    expect((await api("POST", "/api/pages/store-test/publish", bob, { version: latest })).body.publishedVersion).toBe(latest);
    expect((await api("POST", "/api/pages/store-test/publish", bob, { version: 1 })).body.publishedVersion).toBe(1);
  });

  it("only lets the owner's team push", async () => {
    const r = await api("POST", "/api/pages/store-test/versions", await tokenFor("dave@example.com"), { files: { "Page.tsx": GOOD } });
    expect(r.status).toBe(403);
  });
});

describe("serving pages", () => {
  it("hides private pages from others and shows company pages", async () => {
    const dave = await tokenFor("dave@example.com");
    expect((await api("GET", "/api/pages/store-test", dave)).status).toBe(403);
    await api("PATCH", "/api/pages/store-test", bob, { visibility: "company" });
    expect((await api("GET", "/api/pages/store-test", dave)).status).toBe(200);
    expect((await api("POST", "/api/pages/store-test/view", dave, { version: 2 })).status).toBe(403);
  });

  it("serves the shell with a strict CSP and the built bundle", async () => {
    const view = await api("POST", "/api/pages/store-test/view", bob, {});
    const shell = await pagesServer.inject({ url: `/p/${view.body.versionId}/` });
    expect(shell.statusCode).toBe(200);
    expect(shell.headers["content-security-policy"]).toContain("connect-src http://localhost:4100");
    expect(shell.body).toContain('"@commons/ui"');
    const js = await pagesServer.inject({ url: `/bundles/${view.body.versionId}/page.js` });
    expect(js.statusCode).toBe(200);
    // React and the UI kit come from the shared runtime, not the page bundle
    expect(js.body).toMatch(/from"@commons\/ui"/);
    expect(js.body.length).toBeLessThan(5000);
    expect(js.headers["access-control-allow-origin"]).toBe("*");
    const css = await pagesServer.inject({ url: `/bundles/${view.body.versionId}/page.css` });
    expect(css.body).toContain("--color-primary");
    expect((await pagesServer.inject({ url: "/runtime/boot.js" })).statusCode).toBe(200);
  });

  it("gives page code read access as the viewer, and nothing more", async () => {
    const view = await api("POST", "/api/pages/store-test/view", bob, {});
    const read = await gql(view.body.token, "{ allStores { totalCount } }");
    expect(read.data.allStores.totalCount).toBe(8);
    const write = await api("POST", "/graphql", view.body.token, { query: `mutation { deleteStoreByStoreCode(input: { storeCode: "S001" }) { clientMutationId } }` });
    expect(write.status).toBe(403);
    expect((await api("GET", "/api/datasets", view.body.token)).status).toBe(403);
    expect((await api("GET", "/api/registry/datasets/stores", view.body.token)).status).toBe(200);
  });

  it("serves types, schema and template for local agents", async () => {
    const r = await api("GET", "/api/sdk", bob);
    expect(Object.keys(r.body.types)).toContain("index.d.ts");
    expect(r.body.schema).toContain("type Store");
    expect(Object.keys(r.body.template)).toEqual(expect.arrayContaining(["Page.tsx", "AGENTS.md", "CLAUDE.md"]));
  });

  it("can create a page from the starter template", async () => {
    const r = await api("POST", "/api/pages", bob, { slug: "starter", title: "Starter", fromTemplate: true });
    expect(r.status).toBe(201);
    expect(r.body.publishedVersion).toBe(1);
  });
});
