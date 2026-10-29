import { build } from "esbuild";
import { chmod, readFile } from "node:fs/promises";

const [entry, outfile] = process.argv.slice(2);
// The version comes from the package being built (run from its folder)
const { version } = JSON.parse(await readFile("package.json", "utf8"));
await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Bundled CommonJS dependencies call require(); give ESM output one
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  define: { __COMMONS_VERSION__: JSON.stringify(version) },
  logLevel: "warning",
});
await chmod(outfile, 0o755);
