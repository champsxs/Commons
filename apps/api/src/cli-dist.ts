import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { config } from "./config.ts";
import { repoRoot } from "./pages/paths.ts";
import { HttpError } from "./util/errors.ts";

const cliPath = resolve(repoRoot, "packages/cli/dist/commons.mjs");

/** The CLI is a single file; this server's address is baked in so `commons login` needs no --url. */
async function cliSource() {
  try {
    return (await readFile(cliPath, "utf8")).replaceAll("__COMMONS_DEFAULT_URL__", config.publicApiUrl);
  } catch {
    throw new HttpError(503, "The CLI hasn't been built on this server yet (run pnpm build)");
  }
}

const installScript = (base: string) => `#!/bin/sh
# Installs the commons CLI from ${base}
set -e

if ! command -v node >/dev/null 2>&1; then
  echo "commons needs Node.js 22 or newer: https://nodejs.org" >&2
  exit 1
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "commons needs Node.js 22 or newer (you have $(node -v))" >&2
  exit 1
fi

DIR="$HOME/.commons/bin"
mkdir -p "$DIR"
curl -fsSL "${base}/cli/commons.mjs" -o "$DIR/commons.tmp"
mv "$DIR/commons.tmp" "$DIR/commons"
chmod +x "$DIR/commons"

# Link into a folder that's already on PATH when there is a writable one
LINKED=""
for d in "$HOME/.local/bin" "/opt/homebrew/bin" "/usr/local/bin"; do
  case ":$PATH:" in
    *":$d:"*)
      if [ -d "$d" ] && [ -w "$d" ]; then
        ln -sf "$DIR/commons" "$d/commons"
        LINKED="$d"
        break
      fi
      ;;
  esac
done

echo "Installed commons $("$DIR/commons" --version) to $DIR/commons"
if [ -n "$LINKED" ]; then
  echo "Linked into $LINKED"
else
  echo "Add it to your PATH, e.g. in ~/.zshrc:"
  echo "  export PATH=\\"$DIR:\\$PATH\\""
fi
echo ""
echo "Next: commons login"
`;

export function registerCliDistribution(app: FastifyInstance) {
  app.get("/cli/commons.mjs", async (_req, reply) => {
    reply.type("text/javascript");
    reply.header("content-disposition", 'attachment; filename="commons"');
    reply.header("cache-control", "no-cache");
    return cliSource();
  });

  app.get("/cli/install.sh", async (_req, reply) => {
    reply.type("text/x-shellscript");
    reply.header("cache-control", "no-cache");
    return installScript(config.publicApiUrl.replace(/\/$/, ""));
  });
}
