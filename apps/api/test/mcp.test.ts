import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getApp, tokenFor } from "./helpers.ts";

let base: string;

beforeAll(async () => {
  const app = await getApp();
  base = await app.listen({ port: 0, host: "127.0.0.1" });
});
afterAll(async () => (await getApp()).close());

async function connect(token?: string) {
  const client = new Client({ name: "test", version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: token ? { authorization: `Bearer ${token}` } : {} },
  });
  await client.connect(transport);
  return client;
}

const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const r: any = await client.callTool({ name, arguments: args });
  return { isError: !!r.isError, text: r.content[0].text as string };
};

describe("remote MCP over HTTP", () => {
  it("lists the Commons tools", async () => {
    const client = await connect(await tokenFor("carol@example.com", ["data:read", "pages:write"]));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["search_datasets", "get_dataset", "run_query", "push_page_version"]));
    await client.close();
  });

  it("runs tools as the token's user", async () => {
    const carol = await connect(await tokenFor("carol@example.com", ["data:read", "pages:write"]));
    const r = await call(carol, "run_query", { query: "{ allMonthlySales { totalCount } }" });
    expect(JSON.parse(r.text).data.allMonthlySales.totalCount).toBe(96);
    await carol.close();

    const dave = await connect(await tokenFor("dave@example.com", ["data:read"]));
    const d = await call(dave, "run_query", { query: "{ allMonthlySales { totalCount } }" });
    expect(JSON.parse(d.text).data.allMonthlySales.totalCount).toBe(0);
    const write = await call(dave, "run_query", { query: 'mutation { deleteCountryByCode(input: { code: "SE" }) { clientMutationId } }' });
    expect(write).toMatchObject({ isError: true, text: expect.stringContaining("data:write") });
    await dave.close();
  });

  it("pushes pages", async () => {
    const client = await connect(await tokenFor("carol@example.com", ["data:read", "pages:write"]));
    const r = await call(client, "push_page_version", {
      slug: "mcp-http-test", title: "From MCP",
      files: { "Page.tsx": 'import { Page } from "@commons/ui";\nexport default function P() { return <Page title="Hi">Hello</Page>; }\n' },
    });
    expect(JSON.parse(r.text)).toMatchObject({ ok: true, version: 1 });
    await client.close();
  });

  it("adds a field when the token and the person allow it", async () => {
    const bob = await connect(await tokenFor("bob@example.com", ["data:read", "datasets:write"]));
    const r = await call(bob, "add_field", { dataset: "stores", name: "region", description: "Sales region" });
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.text)).toMatchObject({ added: { name: "region", type: "text", graphql: "region" } });
    const ref = await call(bob, "add_field", { dataset: "stores", name: "regional_hub", type: "reference", references: { dataset: "cities" } });
    expect(JSON.parse(ref.text)).toMatchObject({ added: { graphql: "regionalHub", references: { dataset: "cities", matchedBy: "city_code" } } });
    await bob.close();
  });

  it("refuses add_field without the scope or edit access", async () => {
    const readOnly = await connect(await tokenFor("bob@example.com", ["data:read"]));
    expect(await call(readOnly, "add_field", { dataset: "stores", name: "nope" })).toMatchObject({ isError: true, text: expect.stringContaining("datasets:write") });
    await readOnly.close();
    const dave = await connect(await tokenFor("dave@example.com", ["data:read", "datasets:write"]));
    expect(await call(dave, "add_field", { dataset: "stores", name: "nope" })).toMatchObject({ isError: true, text: expect.stringContaining("edit access") });
    await dave.close();
  });

  it("answers whoami, reuse, usage, upload history and page versions", async () => {
    const carol = await connect(await tokenFor("carol@example.com", ["data:read", "pages:write"]));
    const me = JSON.parse((await call(carol, "whoami")).text);
    expect(me).toMatchObject({ name: "Carol Chen", teams: ["Retail Operations"], departments: ["Retail"], permissions: ["data:read", "pages:write"] });

    const reuse = JSON.parse((await call(carol, "suggest_reuse", { name: "Store list", fields: ["store_code", "name", "city_code"] })).text);
    expect(reuse.similarDatasets[0].slug).toBe("stores");
    expect(reuse.linkInsteadOfCopy).toContainEqual(expect.objectContaining({ column: "city_code", dataset: "cities", suggestedFieldName: "city" }));

    const usage = JSON.parse((await call(carol, "dataset_usage", { slug: "cities" })).text);
    expect(usage.datasets).toContainEqual(expect.objectContaining({ slug: "stores", field: "city" }));

    const history = JSON.parse((await call(carol, "upload_history", { slug: "stores", limit: 1 })).text);
    expect(history[0]).toMatchObject({ status: "ok", mode: "append", rowsWritten: 8 });

    const versions = JSON.parse((await call(carol, "list_page_versions", { slug: "mcp-http-test" })).text);
    expect(versions.versions[0]).toMatchObject({ version: 1, status: "ready" });
    await carol.close();
  });

  it("lets agents describe datasets and fields they can edit", async () => {
    const bob = await connect(await tokenFor("bob@example.com", ["data:read", "datasets:write"]));
    const f = JSON.parse((await call(bob, "set_description", { dataset: "stores", field: "floor_area_m2", description: "Sales floor only", label: "Floor area (m²)" })).text);
    expect(f).toEqual({ dataset: "stores", field: "floor_area_m2", label: "Floor area (m²)", description: "Sales floor only" });
    const d = JSON.parse((await call(bob, "set_description", { dataset: "stores", description: "All retail stores" })).text);
    expect(d).toEqual({ dataset: "stores", description: "All retail stores" });
    // Describing a dataset must not change its other settings
    const after = await (await getApp()).inject({ url: "/api/datasets/stores", headers: { authorization: `Bearer ${await tokenFor("bob@example.com")}` } });
    expect(after.json()).toMatchObject({ visibility: "company", name: "Stores", description: "All retail stores" });
    await bob.close();

    const dave = await connect(await tokenFor("dave@example.com", ["data:read", "datasets:write"]));
    expect(await call(dave, "set_description", { dataset: "stores", description: "x" })).toMatchObject({ isError: true });
    await dave.close();
  });

  it("requires an API token", async () => {
    await expect(connect()).rejects.toThrow();
    const res = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(401);
  });
});
