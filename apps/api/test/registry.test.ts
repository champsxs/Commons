import { afterAll, describe, expect, it } from "vitest";
import { api, getApp, gql, pageTokenFor, tokenFor, upload } from "./helpers.ts";

afterAll(async () => (await getApp()).close());

describe("GraphQL over linked datasets", () => {
  it("follows references forwards and backwards", async () => {
    const t = await tokenFor("carol@example.com");
    const r = await gql(t, `{
      cityByCityCode(cityCode: "STO") { name country { code } stores(orderBy: STORE_CODE_ASC) { nodes { storeCode } } }
    }`);
    expect(r.errors).toBeUndefined();
    expect(r.data.cityByCityCode).toEqual({ name: "Stockholm", country: { code: "SE" }, stores: { nodes: [{ storeCode: "S001" }, { storeCode: "S002" }] } });
  });

  it("returns the generated GraphQL names with the dataset", async () => {
    const r = await api("GET", "/api/datasets/stores", await tokenFor("carol@example.com"));
    expect(r.body.graphql).toMatchObject({ type: "Store", listField: "allStores", byIdField: "storeById", fields: { city: "city", store_code: "storeCode" } });
    expect(r.body.rowCount).toBe(8);
  });

  it("exposes a newly created dataset in GraphQL straight away", async () => {
    const t = await tokenFor("bob@example.com");
    const c = await api("POST", "/api/datasets", t, {
      name: "Regions", visibility: "company", keyField: "region_code",
      fields: [{ name: "region_code", type: "text" }, { name: "name", type: "text", required: true }],
    });
    expect(c.status).toBe(201);
    const r = await gql(t, "{ allRegions { totalCount } }");
    expect(r.data.allRegions.totalCount).toBe(0);
  });
});

describe("visibility and row-level security", () => {
  it("hides shared datasets from people outside the team", async () => {
    const dave = await tokenFor("dave@example.com");
    const r = await gql(dave, "{ allMonthlySales { totalCount } allStores { totalCount } }");
    expect(r.data.allMonthlySales.totalCount).toBe(0);
    expect(r.data.allStores.totalCount).toBe(8);
    expect((await api("GET", "/api/datasets/monthly_sales", dave)).status).toBe(403);
    const list = await api("GET", "/api/datasets", dave);
    expect(list.body.map((d: any) => d.slug)).not.toContain("monthly_sales");
  });

  it("lets team members see their team's shared dataset", async () => {
    const r = await gql(await tokenFor("carol@example.com"), "{ allMonthlySales { totalCount } }");
    expect(r.data.allMonthlySales.totalCount).toBe(96);
  });

  it("opens a shared dataset to a person it is shared with", async () => {
    const bob = await tokenFor("bob@example.com");
    const users = await api("GET", "/api/users", bob);
    const dave = users.body.find((u: any) => u.email === "dave@example.com");
    await api("PATCH", "/api/datasets/monthly_sales", bob, { shares: [{ userId: dave.id }] });
    const r = await gql(await tokenFor("dave@example.com"), "{ allMonthlySales { totalCount } }");
    expect(r.data.allMonthlySales.totalCount).toBe(96);
    await api("PATCH", "/api/datasets/monthly_sales", bob, { shares: [] });
  });

  it("does not let viewers write to someone else's dataset", async () => {
    const r = await gql(await tokenFor("dave@example.com"), `mutation { createCountry(input: { country: { code: "XX", name: "Nowhere" } }) { country { code } } }`);
    expect(r.errors?.[0].message).toMatch(/permission/i);
  });

  it("refuses references to datasets you can't see", async () => {
    const r = await api("POST", "/api/datasets", await tokenFor("dave@example.com"), {
      name: "Sales notes", fields: [{ name: "sale", type: "reference", reference: { dataset: "monthly_sales" } }],
    });
    expect(r.status).toBe(403);
  });
});

describe("protecting links between datasets", () => {
  it("blocks deleting a city that stores point to", async () => {
    const alice = await tokenFor("alice@example.com");
    const r = await gql(alice, `mutation { deleteCityByCityCode(input: { cityCode: "STO" }) { city { name } } }`);
    expect(r.errors?.[0].message).toMatch(/still referenced/i);
  });

  it("blocks removing a field other datasets match on", async () => {
    const r = await api("DELETE", "/api/datasets/cities/fields/city_code", await tokenFor("alice@example.com"));
    expect(r.status).toBe(409);
  });

  it("blocks deleting a dataset that others reference", async () => {
    const r = await api("DELETE", "/api/datasets/countries", await tokenFor("alice@example.com"));
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/cities/);
  });

  it("only allows references to unique fields", async () => {
    const r = await api("POST", "/api/datasets", await tokenFor("bob@example.com"), {
      name: "Bad ref", fields: [{ name: "city", type: "reference", reference: { dataset: "cities", matchField: "name" } }],
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/not unique/);
  });

  it("reports who uses a dataset", async () => {
    const r = await api("GET", "/api/datasets/cities/usage", await tokenFor("alice@example.com"));
    expect(r.body.datasets).toContainEqual({ slug: "stores", field: "city", matchField: "city_code", onDelete: "restrict" });
  });
});

describe("tokens and page tokens", () => {
  it("rejects mutations from read-only tokens", async () => {
    const t = await tokenFor("alice@example.com", ["data:read"]);
    const r = await api("POST", "/graphql", t, { query: `mutation { deleteRegionByRegionCode(input: { regionCode: "x" }) { clientMutationId } }` });
    expect(r.status).toBe(403);
  });

  it("keeps pages read-only unless the owner allows writes", async () => {
    const r = await api("POST", "/graphql", await pageTokenFor("alice@example.com"), { query: `mutation { deleteRegionByRegionCode(input: { regionCode: "x" }) { clientMutationId } }` });
    expect(r.status).toBe(403);
    const q = await api("POST", "/graphql", await pageTokenFor("alice@example.com"), { query: "{ allStores { totalCount } }" });
    expect(q.body.data.allStores.totalCount).toBe(8);
  });

  it("stops page tokens from using the registry API", async () => {
    expect((await api("GET", "/api/datasets", await pageTokenFor("alice@example.com"))).status).toBe(403);
  });

  it("limits query depth", async () => {
    const deep = "{ allStores { nodes { city { stores { nodes { city { stores { nodes { city { stores { nodes { city { name } } } } } } } } } } } } }";
    const r = await api("POST", "/graphql", await tokenFor("alice@example.com"), { query: deep });
    expect(r.status).toBe(400);
  });

  it("requires sign-in for GraphQL", async () => {
    const res = await (await getApp()).inject({ method: "POST", url: "/graphql", payload: { query: "{ allStores { totalCount } }" } });
    expect(res.statusCode).toBe(401);
  });
});

describe("reuse before create", () => {
  it("suggests existing datasets and references", async () => {
    const r = await api("POST", "/api/datasets/suggest", await tokenFor("carol@example.com"), {
      name: "Store", fields: [{ name: "store_code" }, { name: "name" }, { name: "city_code" }, { name: "country" }],
    });
    expect(r.body.similar[0].slug).toBe("stores");
    expect(r.body.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "city_code", dataset: "cities", matchField: "city_code", suggestedName: "city" }),
      expect.objectContaining({ field: "country", dataset: "countries", matchField: "code" }),
    ]));
  });

  it("infers fields from a CSV and spots references", async () => {
    const r = await upload(await tokenFor("carol@example.com"), "/api/infer",
      "warehouse_code,city_code,capacity,opened\nW1,STO,1200,2020-01-02\nW2,OSL,800.5,2021-05-06\n", {}, "warehouses.csv");
    expect(r.status).toBe(200);
    const types = Object.fromEntries(r.body.fields.map((f: any) => [f.name, f.type]));
    expect(types).toEqual({ warehouse_code: "text", city_code: "text", capacity: "number", opened: "date" });
    expect(r.body.keyField).toBe("warehouse_code");
    expect(r.body.suggestions.references).toContainEqual(expect.objectContaining({ field: "city_code", dataset: "cities" }));
  });

  it("searches datasets and fields", async () => {
    const r = await api("GET", "/api/search?q=city", await tokenFor("carol@example.com"));
    expect(r.body.datasets.map((d: any) => d.slug)).toContain("cities");
    expect(r.body.fields.map((f: any) => f.name)).toContain("city_code");
  });
});
