import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, getApp, gql, tokenFor } from "./helpers.ts";

let alice: string, bob: string, carol: string, dave: string;
let retail: string, dataAnalytics: string;

beforeAll(async () => {
  [alice, bob, carol, dave] = await Promise.all(["alice", "bob", "carol", "dave"].map((n) => tokenFor(`${n}@example.com`)));
  const deps = (await api("GET", "/api/departments", alice)).body;
  retail = deps.find((d: any) => d.slug === "retail").id;
  dataAnalytics = deps.find((d: any) => d.slug === "data-analytics").id;
});
afterAll(async () => (await getApp()).close());

const fields = [{ name: "code", type: "text" }, { name: "note", type: "text" }];

describe("department visibility", () => {
  it("lists a person's departments, including those reached through a team", async () => {
    const me = await api("GET", "/api/me", carol);
    expect(me.body.departments.map((d: any) => d.name)).toEqual(["Retail"]);
    expect((await api("GET", "/api/me", dave)).body.departments).toEqual([]);
  });

  it("opens a dataset to everyone in the chosen department, and nobody else", async () => {
    const r = await api("POST", "/api/datasets", bob, { name: "Retail targets", visibility: "department", departmentId: retail, keyField: "code", fields });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ visibility: "department", departmentName: "Retail" });
    await api("POST", "/graphql", bob, { query: `mutation { createRetailTarget(input: { retailTarget: { code: "Q1", note: "grow" } }) { clientMutationId } }` });

    // Dave isn't in Retail yet
    expect((await gql(dave, "{ allRetailTargets { totalCount } }")).data.allRetailTargets.totalCount).toBe(0);
    expect((await api("GET", "/api/datasets/retail_targets", dave)).status).toBe(403);

    // Adding Dave to the department directly opens it to him
    await api("PATCH", `/api/departments/${retail}`, alice, { userIds: [(await api("GET", "/api/me", dave)).body.id] });
    expect((await gql(dave, "{ allRetailTargets { totalCount } }")).data.allRetailTargets.totalCount).toBe(1);
    // ...but only to read: department users aren't editors
    const write = await gql(dave, `mutation { createRetailTarget(input: { retailTarget: { code: "Q2" } }) { clientMutationId } }`);
    expect(write.errors?.[0].message).toMatch(/permission/i);

    await api("PATCH", `/api/departments/${retail}`, alice, { userIds: [] });
    expect((await gql(dave, "{ allRetailTargets { totalCount } }")).data.allRetailTargets.totalCount).toBe(0);
  });

  it("only lets people pick a department they belong to", async () => {
    const r = await api("POST", "/api/datasets", bob, { name: "Wrong dept", visibility: "department", departmentId: dataAnalytics, fields });
    expect(r.status).toBe(403);
    const missing = await api("POST", "/api/datasets", bob, { name: "No dept", visibility: "department", fields });
    expect(missing.status).toBe(400);
  });

  it("switches visibility in and out of department", async () => {
    const toCompany = await api("PATCH", "/api/datasets/retail_targets", bob, { visibility: "company" });
    expect(toCompany.body).toMatchObject({ visibility: "company", departmentId: null });
    const back = await api("PATCH", "/api/datasets/retail_targets", bob, { visibility: "department", departmentId: retail });
    expect(back.body).toMatchObject({ visibility: "department", departmentName: "Retail" });
  });

  it("works for pages too", async () => {
    await api("POST", "/api/pages", bob, { slug: "retail-only", title: "Retail only", visibility: "department", departmentId: retail });
    expect((await api("GET", "/api/pages/retail-only", carol)).status).toBe(200);
    expect((await api("GET", "/api/pages/retail-only", dave)).status).toBe(403);
  });

  it("lets only admins manage departments, and protects departments in use", async () => {
    expect((await api("POST", "/api/departments", bob, { slug: "nope", name: "Nope" })).status).toBe(403);
    const created = await api("POST", "/api/departments", alice, { slug: "finance", name: "Finance" });
    expect(created.body).toMatchObject({ name: "Finance", people: 0 });
    expect((await api("DELETE", `/api/departments/${created.body.id}`, alice)).status).toBe(200);
    expect((await api("DELETE", `/api/departments/${retail}`, alice)).status).toBe(409);
  });
});

describe("partial updates", () => {
  it("leaves fields that aren't in the request alone", async () => {
    await api("PATCH", "/api/datasets/retail_targets", bob, { description: "Quarterly targets" });
    const r = await api("PATCH", "/api/datasets/retail_targets", bob, { name: "Retail targets 2027" });
    expect(r.body).toMatchObject({ name: "Retail targets 2027", description: "Quarterly targets", visibility: "department", departmentName: "Retail" });
    await api("PATCH", "/api/pages/retail-only", bob, { description: "Only for Retail" });
    const p = await api("PATCH", "/api/pages/retail-only", bob, { title: "Retail only (v2)" });
    expect(p.body).toMatchObject({ description: "Only for Retail", visibility: "department" });
  });
});
