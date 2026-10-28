import { config } from "./config.ts";
import { migrate } from "./db/migrate.ts";
import { buildApp } from "./http/app.ts";
import { buildPagesServer } from "./pages/server.ts";
import { watch } from "node:fs";
import { buildRuntime, resetUiTypes } from "./pages/runtime.ts";
import { uiSrc } from "./pages/paths.ts";
import { ensureBucket } from "./pages/storage.ts";

const applied = await migrate();
if (applied.length) console.log(`Applied migrations: ${applied.join(", ")}`);
await Promise.all([buildRuntime(), ensureBucket()]);

const logger = { level: process.env.LOG_LEVEL ?? "warn" };
const app = await buildApp({ logger });
await app.listen({ port: config.apiPort, host: "0.0.0.0" });
const pages = await buildPagesServer();
await pages.listen({ port: config.pagesPort, host: "0.0.0.0" });
console.log(`Commons API on http://localhost:${config.apiPort}  (GraphiQL: /graphiql)`);
console.log(`Page sandbox on ${config.pagesOrigin}`);

// In development, rebuild the page runtime when the UI kit changes so pages pick it up on reload
if (process.env.NODE_ENV !== "production") {
  let timer: NodeJS.Timeout | undefined;
  watch(uiSrc, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      resetUiTypes();
      buildRuntime().then(() => console.log("Rebuilt page runtime"), (e) => console.error("Page runtime build failed:", e.message));
    }, 300);
  });
}
