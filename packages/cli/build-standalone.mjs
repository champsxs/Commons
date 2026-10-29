// Builds the CLI as standalone programs (no Node needed) for each platform, with the pinned Bun.
// Output: dist/standalone/commons-<os>-<arch>[.exe]
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, stat } from "node:fs/promises";

const { version } = JSON.parse(await readFile("package.json", "utf8"));
// x64 uses Bun's "baseline" builds so older CPUs (without AVX2) can run them too
const TARGETS = {
  "darwin-arm64": "bun-darwin-arm64",
  "darwin-x64": "bun-darwin-x64-baseline",
  "linux-x64": "bun-linux-x64-baseline",
  "linux-arm64": "bun-linux-arm64",
  "windows-x64": "bun-windows-x64-baseline",
};
const only = process.argv.slice(2);
// A full build starts clean; building named platforms only replaces those
if (!only.length) await rm("dist/standalone", { recursive: true, force: true });
await mkdir("dist/standalone", { recursive: true });
for (const [name, target] of Object.entries(TARGETS)) {
  if (only.length && !only.includes(name)) continue;
  const out = `dist/standalone/commons-${name}${name.startsWith("windows") ? ".exe" : ""}`;
  execFileSync("node_modules/.bin/bun", [
    "build", "src/main.ts", "--compile", "--minify", `--target=${target}`,
    `--define=__COMMONS_VERSION__=${JSON.stringify(version)}`,
    `--outfile=${out}`,
  ], { stdio: ["ignore", "ignore", "inherit"] });
  console.log(`${out}  ${((await stat(out)).size / 1e6).toFixed(0)} MB`);
}
