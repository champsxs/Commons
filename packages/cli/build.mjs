import { build } from "esbuild";
import { chmod } from "node:fs/promises";

const [entry, outfile] = process.argv.slice(2);
await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Bundled CommonJS dependencies call require(); give ESM output one
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "warning",
});
await chmod(outfile, 0o755);
