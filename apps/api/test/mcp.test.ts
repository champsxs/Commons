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

  it("requires an API token", async () => {
    await expect(connect()).rejects.toThrow();
    const res = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(401);
  });
});
