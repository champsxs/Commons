import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, getApp, gql, tokenFor, upload } from "./helpers.ts";

let bob: string;
beforeAll(async () => {
  bob = await tokenFor("bob@example.com");
  const r = await api("POST", "/api/datasets", bob, {
    name: "Warehouses", keyField: "warehouse_code", visibility: "company",
    fields: [
      { name: "warehouse_code", type: "text" },
      { name: "name", type: "text", required: true },
      { name: "city", type: "reference", reference: { dataset: "cities", unresolved: "reject" } },
      { name: "capacity", type: "integer" },
      { name: "active", type: "boolean" },
    ],
  });
  expect(r.status).toBe(201);
});
afterAll(async () => (await getApp()).close());

const url = "/api/datasets/warehouses/ingest";

describe("ingest", () => {
  it("resolves reference codes to rows", async () => {
    const r = await upload(bob, url, "warehouse_code,name,city_code,capacity,active\nW1,North,STO,1000,yes\nW2,West,GOT,500,no\n");
    expect(r.body).toMatchObject({ status: "ok", rowsWritten: 2, columnMapping: { city: "city_code" } });
    const q = await gql(bob, `{ warehouseByWarehouseCode(warehouseCode: "W1") { capacity active city { name } } }`);
    expect(q.data.warehouseByWarehouseCode).toEqual({ capacity: 1000, active: true, city: { name: "Stockholm" } });
  });

  it("rejects the upload and names unknown codes", async () => {
    const r = await upload(bob, url, "warehouse_code,name,city\nW3,East,XYZ\nW4,South,ABC\nW5,Ok,OSL\n");
    expect(r.body.status).toBe("failed");
    expect(r.body.unresolved.city).toMatchObject({ count: 2, values: ["XYZ", "ABC"], target: "cities" });
    expect(r.body.message).toMatch(/XYZ/);
    const q = await gql(bob, "{ allWarehouses { totalCount } }");
    expect(q.data.allWarehouses.totalCount).toBe(2);
  });

  it("can skip or blank unmatched references instead", async () => {
    const skip = await upload(bob, url, "warehouse_code,name,city\nW3,East,XYZ\nW5,Ok,OSL\n", { unresolved: "skip" });
    expect(skip.body).toMatchObject({ status: "ok", rowsWritten: 1, rowsSkipped: 1 });
    const blank = await upload(bob, url, "warehouse_code,name,city\nW6,Floating,NOPE\n", { unresolved: "null" });
    expect(blank.body).toMatchObject({ status: "ok", rowsWritten: 1 });
    const q = await gql(bob, `{ warehouseByWarehouseCode(warehouseCode: "W6") { city { name } } }`);
    expect(q.data.warehouseByWarehouseCode.city).toBeNull();
  });

  it("reports bad values with row numbers", async () => {
    const r = await upload(bob, url, "warehouse_code,name,capacity\nW7,A,12\nW8,,lots\n");
    expect(r.body.status).toBe("failed");
    expect(r.body.errors).toEqual([
      { row: 2, field: "name", message: "is required" },
      { row: 2, field: "capacity", message: '"lots" is not a whole number' },
    ]);
  });

  it("does a dry run without writing", async () => {
    const r = await upload(bob, url, "warehouse_code,name\nW9,Dry\n", { dryRun: "true" });
    expect(r.body.status).toBe("dry_run");
    const q = await gql(bob, `{ warehouseByWarehouseCode(warehouseCode: "W9") { name } }`);
    expect(q.data.warehouseByWarehouseCode).toBeNull();
  });

  it("upserts on the key field", async () => {
    const r = await upload(bob, url, "warehouse_code,name,capacity\nW1,North (renamed),1500\nW10,New,10\n", { mode: "upsert" });
    expect(r.body).toMatchObject({ status: "ok", rowsWritten: 2 });
    const q = await gql(bob, `{ warehouseByWarehouseCode(warehouseCode: "W1") { name capacity city { name } } }`);
    expect(q.data.warehouseByWarehouseCode).toEqual({ name: "North (renamed)", capacity: 1500, city: { name: "Stockholm" } });
  });

  it("reports duplicates when appending", async () => {
    const r = await upload(bob, url, "warehouse_code,name\nW1,Dupe\n");
    expect(r.body.status).toBe("failed");
    expect(r.body.message).toMatch(/Duplicate/);
  });

  it("accepts JSON", async () => {
    const r = await upload(bob, url, JSON.stringify([{ warehouse_code: "J1", name: "From JSON", city: "HEL", capacity: 7 }]), {}, "w.json");
    expect(r.body).toMatchObject({ status: "ok", rowsWritten: 1 });
  });

  it("won't replace rows that other datasets still reference", async () => {
    const r = await upload(await tokenFor("alice@example.com"), "/api/datasets/cities/ingest", "city_code,name,country\nSTO,Stockholm,SE\n", { mode: "replace" });
    expect(r.body.status).toBe("failed");
    expect(r.body.message).toMatch(/still referenced/);
    const q = await gql(bob, "{ allCities { totalCount } }");
    expect(q.data.allCities.totalCount).toBe(7);
  });

  it("only lets editors upload", async () => {
    const r = await upload(await tokenFor("dave@example.com"), url, "warehouse_code,name\nZ1,Nope\n");
    expect(r.status).toBe(403);
  });

  it("keeps an ingest history", async () => {
    const r = await api("GET", "/api/datasets/warehouses/ingests", bob);
    expect(r.body.length).toBeGreaterThanOrEqual(6);
    expect(r.body[0]).toHaveProperty("report");
  });
});

describe("add or update with some columns left out", () => {
  it("updates only the columns in the file and keeps the rest", async () => {
    await api("POST", "/api/datasets/warehouses/fields", bob, { name: "region", type: "text" });
    const r = await upload(bob, url, "warehouse_code,region\nW1,North\nW2,West\n", { mode: "upsert" });
    expect(r.body).toMatchObject({ status: "ok", rowsWritten: 2, message: "2 row(s) updated, 0 added." });
    const q = await gql(bob, `{ warehouseByWarehouseCode(warehouseCode: "W1") { name capacity region city { name } } }`);
    expect(q.data.warehouseByWarehouseCode).toEqual({ name: "North (renamed)", capacity: 1500, region: "North", city: { name: "Stockholm" } });
  });

  it("explains when new rows lack required fields", async () => {
    const r = await upload(bob, url, "warehouse_code,region\nW1,East\nNEW1,South\n", { mode: "upsert" });
    expect(r.body.status).toBe("failed");
    expect(r.body.message).toMatch(/1 row\(s\) are new \(warehouse_code: NEW1\).*name/);
    const q = await gql(bob, `{ warehouseByWarehouseCode(warehouseCode: "W1") { region } }`);
    expect(q.data.warehouseByWarehouseCode.region).toBe("North");
  });

  it("needs the key column to match rows", async () => {
    const r = await upload(bob, url, "region\nNorth\n", { mode: "upsert" });
    expect(r.body).toMatchObject({ status: "failed", message: expect.stringContaining('needs a "warehouse_code" column') });
  });

  it("still adds new rows when every required column is there", async () => {
    const r = await upload(bob, url, "warehouse_code,name,region\nW1,North hub,North\nW20,Brand new,East\n", { mode: "upsert" });
    expect(r.body).toMatchObject({ status: "ok", message: "1 row(s) updated, 1 added." });
  });
});
