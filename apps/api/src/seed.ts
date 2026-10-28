import { migrate } from "./db/migrate.ts";
import { asUser, pool } from "./db/pool.ts";
import { createDataset } from "./registry/datasets.ts";
import { ingest } from "./ingest/ingest.ts";
import { parseFile } from "./ingest/parse.ts";

/** Sample company: two teams and a small chain of linked datasets (countries -> cities -> stores -> monthly sales). */
export async function seed() {
  await migrate();
  const exists = await pool.query("select 1 from commons.users limit 1");
  if (exists.rows.length) return console.log("Already seeded");

  const users = await pool.query(`
    insert into commons.users (email, name, is_admin) values
      ('alice@example.com', 'Alice Andersson', true),
      ('bob@example.com', 'Bob Berg', false),
      ('carol@example.com', 'Carol Chen', false)
    returning id, email`);
  const id = (email: string) => users.rows.find((u) => u.email === email)!.id;
  const teams = await pool.query(`
    insert into commons.teams (slug, name) values ('data-platform', 'Data Platform'), ('retail-ops', 'Retail Operations')
    returning id, slug`);
  const team = (slug: string) => teams.rows.find((t) => t.slug === slug)!.id;
  await pool.query(
    "insert into commons.team_members (team_id, user_id) values ($1,$2), ($3,$4), ($3,$5)",
    [team("data-platform"), id("alice@example.com"), team("retail-ops"), id("bob@example.com"), id("carol@example.com")],
  );

  const alice = id("alice@example.com");
  const bob = id("bob@example.com");
  const csv = (s: string) => parseFile(Buffer.from(s.trim()), "x.csv");

  await asUser(alice, async (db) => {
    await createDataset(db, alice, {
      name: "Countries", slug: "countries", visibility: "company", teamId: team("data-platform"), keyField: "code",
      description: "ISO 3166 countries we operate in", license: "Public domain", source: "ISO 3166-1",
      fields: [
        { name: "code", type: "text", description: "ISO 3166-1 alpha-2 code" },
        { name: "name", type: "text", required: true },
        { name: "currency", type: "text", description: "ISO 4217 currency code" },
      ],
    });
    await ingest(db, alice, "countries", csv(`
code,name,currency
SE,Sweden,SEK
NO,Norway,NOK
DK,Denmark,DKK
FI,Finland,EUR
DE,Germany,EUR`), {});

    await createDataset(db, alice, {
      name: "Cities", slug: "cities", visibility: "company", teamId: team("data-platform"), keyField: "city_code",
      description: "Cities with company presence",
      fields: [
        { name: "city_code", type: "text", description: "Internal three-letter city code" },
        { name: "name", type: "text", required: true },
        { name: "country", type: "reference", required: true, reference: { dataset: "countries" } },
        { name: "population", type: "integer" },
      ],
    });
    await ingest(db, alice, "cities", csv(`
city_code,name,country,population
STO,Stockholm,SE,984748
GOT,Gothenburg,SE,604616
MAL,Malmö,SE,357377
OSL,Oslo,NO,709037
CPH,Copenhagen,DK,660842
HEL,Helsinki,FI,664028
BER,Berlin,DE,3755251`), {});
  });

  await asUser(bob, async (db) => {
    await createDataset(db, bob, {
      name: "Stores", slug: "stores", visibility: "company", teamId: team("retail-ops"), keyField: "store_code",
      description: "Retail stores",
      fields: [
        { name: "store_code", type: "text" },
        { name: "name", type: "text", required: true },
        { name: "city", type: "reference", required: true, reference: { dataset: "cities" } },
        { name: "opened_on", type: "date" },
        { name: "floor_area_m2", type: "number" },
        { name: "is_flagship", type: "boolean" },
      ],
    });
    await ingest(db, bob, "stores", csv(`
store_code,name,city,opened_on,floor_area_m2,is_flagship
S001,Drottninggatan,STO,2012-03-01,1450,true
S002,Södermalm,STO,2016-09-15,820,false
S003,Nordstan,GOT,2014-05-20,1100,false
S004,Triangeln,MAL,2018-11-02,760,false
S005,Karl Johan,OSL,2015-04-11,1300,true
S006,Strøget,CPH,2017-06-30,980,false
S007,Kamppi,HEL,2019-02-14,890,false
S008,Alexanderplatz,BER,2020-10-01,1600,true`), {});

    await createDataset(db, bob, {
      name: "Monthly store sales", slug: "monthly_sales", visibility: "shared", teamId: team("retail-ops"),
      description: "Revenue per store and month, in local currency",
      fields: [
        { name: "store", type: "reference", required: true, reference: { dataset: "stores" } },
        { name: "month", type: "date", required: true, description: "First day of the month" },
        { name: "revenue", type: "number", required: true },
        { name: "transactions", type: "integer" },
      ],
    });
    const lines = ["store,month,revenue,transactions"];
    const base: Record<string, number> = { S001: 410, S002: 220, S003: 300, S004: 180, S005: 520, S006: 260, S007: 200, S008: 640 };
    for (const [code, k] of Object.entries(base)) {
      for (let m = 1; m <= 12; m++) {
        const season = 1 + 0.25 * Math.sin(((m - 3) / 12) * 2 * Math.PI) + (m === 12 ? 0.35 : 0);
        const revenue = Math.round(k * 1000 * season * (0.92 + ((code.charCodeAt(3) * m) % 17) / 100));
        lines.push(`${code},2026-${String(m).padStart(2, "0")}-01,${revenue},${Math.round(revenue / 310)}`);
      }
    }
    await ingest(db, bob, "monthly_sales", csv(lines.join("\n")), {});
  });
  console.log("Seeded 3 users, 2 teams, 4 datasets");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await seed();
  await pool.end();
}
