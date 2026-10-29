import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { config } from "./config.ts";
import { repoRoot } from "./pages/paths.ts";
import { HttpError } from "./util/errors.ts";
import { compareVersions } from "@commons/cli/client";

const here = fileURLToPath(new URL(".", import.meta.url));
const cliPath = resolve(repoRoot, "packages/cli/dist/commons.mjs");
const cliPackage = resolve(repoRoot, "packages/cli/package.json");

/** The CLI version this server hands out, and the oldest one it still accepts. */
export async function cliVersions() {
  const { version } = JSON.parse(await readFile(cliPackage, "utf8"));
  return { latest: version as string, minimum: config.cliMinVersion };
}

/**
 * Every CLI request says which version it is. Responses tell it the latest version (so it can
 * suggest `commons update`), and CLIs below the minimum get a clear "update" error instead of
 * failing in confusing ways after an API change.
 */
export function registerCliVersionChecks(app: FastifyInstance) {
  app.addHook("onRequest", async (req, reply) => {
    const version = req.headers["x-commons-cli-version"];
    if (typeof version !== "string") return;
    const { latest, minimum } = await cliVersions();
    reply.header("x-commons-cli-latest", latest);
    reply.header("x-commons-cli-minimum", minimum);
    // Updating and reading help must keep working for old CLIs
    if (req.url.startsWith("/cli/") || req.url.startsWith("/api/help")) return;
    if (compareVersions(version, minimum) < 0) {
      throw new HttpError(426, `This Commons needs CLI ${minimum} or newer (you have ${version}). Run: commons update`);
    }
  });
}

/** The CLI is a single file; this server's address is baked in so `commons login` needs no --url. */
async function cliSource() {
  try {
    return (await readFile(cliPath, "utf8")).replaceAll("__COMMONS_DEFAULT_URL__", config.publicApiUrl);
  } catch {
    throw new HttpError(503, "The CLI hasn't been built on this server yet (run pnpm build)");
  }
}

const standaloneDir = resolve(repoRoot, "packages/cli/dist/standalone");
const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "windows-x64"];
const standaloneFile = (platform: string) => join(standaloneDir, `commons-${platform}${platform.startsWith("windows") ? ".exe" : ""}`);

/** Platforms with a standalone program built on this server (pnpm build:standalone). */
async function standalonePlatforms() {
  const out: string[] = [];
  for (const p of PLATFORMS) if (await stat(standaloneFile(p)).then((s) => s.isFile(), () => false)) out.push(p);
  return out;
}

/** The installer scripts live next to this file; __BASE__ becomes this server's address. */
const script = async (name: string) =>
  (await readFile(resolve(here, "cli", name), "utf8")).replaceAll("__BASE__", config.publicApiUrl.replace(/\/$/, ""));


export function registerCliDistribution(app: FastifyInstance) {
  app.get("/cli/commons.mjs", async (_req, reply) => {
    reply.type("text/javascript");
    reply.header("content-disposition", 'attachment; filename="commons"');
    reply.header("cache-control", "no-cache");
    return cliSource();
  });

  app.get("/cli/version", async () => ({ ...(await cliVersions()), standalone: await standalonePlatforms() }));

  app.get("/cli/install.sh", async (_req, reply) => {
    reply.type("text/x-shellscript");
    reply.header("cache-control", "no-cache");
    return script("install.sh");
  });

  app.get("/cli/install.ps1", async (_req, reply) => {
    reply.type("text/plain");
    reply.header("cache-control", "no-cache");
    return script("install.ps1");
  });

  /** Standalone programs, e.g. /cli/download/darwin-arm64. Streamed: they're about 100 MB. */
  app.get("/cli/download/:platform", async (req, reply) => {
    const { platform } = req.params as { platform: string };
    if (!PLATFORMS.includes(platform)) throw new HttpError(404, `No such platform. Available: ${PLATFORMS.join(", ")}`);
    const file = standaloneFile(platform);
    const info = await stat(file).catch(() => null);
    if (!info) throw new HttpError(404, `There's no standalone ${platform} build on this server (run pnpm build:standalone)`);
    reply.type("application/octet-stream");
    reply.header("content-length", info.size);
    reply.header("content-disposition", `attachment; filename="${basename(file)}"`);
    reply.header("cache-control", "no-cache");
    return reply.send(createReadStream(file));
  });
}
