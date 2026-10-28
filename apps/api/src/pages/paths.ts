import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
export const repoRoot = resolve(here, "../../../..");
export const uiDir = resolve(repoRoot, "packages/ui");
export const uiSrc = resolve(uiDir, "src");
export const uiEntry = resolve(uiSrc, "index.ts");
export const uiModules = resolve(uiDir, "node_modules");
export const runtimeDist = resolve(repoRoot, "apps/api/runtime-dist");
export const templateDir = resolve(repoRoot, "templates/page");

/** Bare imports page code may use. Everything else is bundled from the page's own files or rejected. */
export const PAGE_IMPORTS = ["react", "react/jsx-runtime", "@commons/ui"] as const;
