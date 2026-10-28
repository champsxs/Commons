import { config } from "./config.ts";
import { migrate } from "./db/migrate.ts";
import { buildApp } from "./http/app.ts";

const applied = await migrate();
if (applied.length) console.log(`Applied migrations: ${applied.join(", ")}`);

const app = await buildApp({ logger: true });
await app.listen({ port: config.apiPort, host: "0.0.0.0" });
console.log(`Commons API on http://localhost:${config.apiPort}  (GraphiQL: /graphiql)`);
