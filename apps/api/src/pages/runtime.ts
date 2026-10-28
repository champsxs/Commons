import { createRequire } from "node:module";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import * as esbuild from "esbuild";
import ts from "typescript";
import { runtimeDist, uiEntry, uiModules, uiSrc } from "./paths.ts";

const requireFromUi = createRequire(join(uiModules, "noop.js"));
const reactDir = resolve(uiModules, "react");
const reactDomDir = resolve(uiModules, "react-dom");

/** Both the runtime and page builds must resolve React to the same copy. */
export const sharedAlias = { react: reactDir, "react-dom": reactDomDir, "@commons/ui": uiEntry };

/** React is CommonJS, so re-export its names explicitly to get real ES module exports. */
function reexport(specifier: string) {
  const names = Object.keys(requireFromUi(specifier)).filter((n) => /^[A-Za-z_$][\w$]*$/.test(n) && n !== "default");
  return `import * as M from ${JSON.stringify(specifier)};
const D = M.default ?? M;
export default D;
${names.map((n) => `export const ${n} = D.${n};`).join("\n")}
`;
}

const BOOT = `
import { Component, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { CommonsProvider } from "@commons/ui";

const params = new URLSearchParams(location.hash.slice(1));
let token = params.get("token") ?? "";
const appOrigin = params.get("app") ?? "*";
if (params.get("dark") === "1") document.documentElement.classList.add("dark");
history.replaceState(null, "", location.pathname);

// The app hands over fresh tokens before the old one expires
addEventListener("message", (e) => {
  if (e.source === parent && e.data?.type === "commons:token") token = e.data.token;
});

const post = (msg) => parent.postMessage(msg, appOrigin === "*" ? "*" : appOrigin);
new ResizeObserver(() => post({ type: "commons:height", height: document.documentElement.scrollHeight }))
  .observe(document.documentElement);

class Boundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { post({ type: "commons:error", message: String(error?.message ?? error) }); }
  render() {
    if (!this.state.error) return this.props.children;
    return h("div", { className: "m-6 rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm" },
      h("div", { className: "font-medium text-danger" }, "This page crashed"),
      h("pre", { className: "mt-2 whitespace-pre-wrap font-mono text-xs text-muted-foreground" }, String(this.state.error?.stack ?? this.state.error)));
  }
}

const versionId = location.pathname.split("/")[2];
const css = document.createElement("link");
css.rel = "stylesheet";
css.href = "/bundles/" + versionId + "/page.css";
document.head.appendChild(css);

const mod = await import("/bundles/" + versionId + "/page.js");
const Page = mod.default;
createRoot(document.getElementById("root")).render(
  h(CommonsProvider, {
    graphqlUrl: "/graphql",
    registryUrl: "/registry",
    credentials: "omit",
    headers: () => ({ authorization: "Bearer " + token }),
    linkTo: (dataset, id) => "/datasets/" + dataset + "/records/" + id,
    navigate: (href) => post({ type: "commons:navigate", href }),
  }, h(Boundary, null, Page ? h(Page) : h("div", { className: "p-6 text-sm" }, "Page.tsx has no default export"))),
);
`;

/** Specifier -> runtime file, used for the import map in each page's HTML shell. */
export const RUNTIME_MODULES: Record<string, string> = {
  react: "react.js",
  "react/jsx-runtime": "jsx-runtime.js",
  "react-dom/client": "react-dom-client.js",
  "@commons/ui": "commons-ui.js",
};

/**
 * Builds the shared runtime every page loads: React, @commons/ui and the boot script,
 * split so they share one copy of React.
 */
export async function buildRuntime() {
  const src = await mkdtemp(join(tmpdir(), "commons-runtime-"));
  try {
    const entries: Record<string, string> = {
      react: reexport("react"),
      "jsx-runtime": reexport("react/jsx-runtime"),
      "react-dom-client": reexport("react-dom/client"),
      "commons-ui": `export * from "@commons/ui";`,
      boot: BOOT,
    };
    for (const [name, code] of Object.entries(entries)) await writeFile(join(src, `${name}.js`), code);
    await rm(runtimeDist, { recursive: true, force: true });
    await esbuild.build({
      entryPoints: Object.keys(entries).map((n) => ({ in: join(src, `${n}.js`), out: n })),
      outdir: runtimeDist,
      bundle: true,
      splitting: true,
      format: "esm",
      target: "es2022",
      minify: true,
      jsx: "automatic",
      alias: sharedAlias,
      nodePaths: [uiModules],
      define: { "process.env.NODE_ENV": '"production"' },
      chunkNames: "chunks/[name]-[hash]",
      logLevel: "silent",
      // The boot script imports from the other runtime modules by their bare names, like pages do
      plugins: [{
        name: "boot-externals",
        setup(b) {
          b.onResolve({ filter: /^(react|react\/jsx-runtime|react-dom\/client|@commons\/ui)$/ }, (args) =>
            args.importer.endsWith("boot.js") ? { path: args.path, external: true } : undefined,
          );
        },
      }],
    });
  } finally {
    await rm(src, { recursive: true, force: true });
  }
}

let sdk: Promise<Record<string, string>> | undefined;

/** Type declarations for @commons/ui, so agents and editors can typecheck pages locally. */
export function uiTypes(): Promise<Record<string, string>> {
  sdk ??= (async () => {
    const files: string[] = [];
    const walk = async (dir: string) => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (/\.tsx?$/.test(e.name)) files.push(p);
      }
    };
    await walk(uiSrc);
    const out: Record<string, string> = {};
    const program = ts.createProgram(files, {
      declaration: true, emitDeclarationOnly: true, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2022, skipLibCheck: true,
      allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true, outDir: "/out", rootDir: uiSrc, strict: true,
    });
    program.emit(undefined, (name, text) => {
      // "./client.tsx" -> "./client.js", which editors map back to client.d.ts
      out[relative("/out", name)] = text.replace(/(from\s+["']\.{1,2}\/[^"']+)\.tsx?(["'])/g, "$1.js$2");
    });
    return out;
  })();
  return sdk;
}

export function resetUiTypes() {
  sdk = undefined;
}

export async function runtimeReady() {
  try {
    await readFile(join(runtimeDist, "boot.js"));
    return true;
  } catch {
    return false;
  }
}
