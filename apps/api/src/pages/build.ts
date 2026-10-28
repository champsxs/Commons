import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import * as esbuild from "esbuild";
import ts from "typescript";
import { compile, optimize } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { GraphQLError, TypeInfo, getNamedType, parse, validate, visit, visitWithTypeInfo, type GraphQLSchema } from "postgraphile/graphql";
import { PAGE_IMPORTS, uiEntry, uiModules, uiSrc } from "./paths.ts";

export interface BuildIssue {
  kind: "files" | "import" | "safety" | "graphql" | "type" | "bundle";
  file?: string;
  line?: number;
  message: string;
}

export interface TypeMapEntry {
  datasetId: string;
  slug: string;
  /** GraphQL field name -> dataset field name */
  fields: Record<string, string>;
}

export interface BuildOutput {
  ok: boolean;
  issues: BuildIssue[];
  notes: string[];
  js?: string;
  css?: string;
  deps: { datasetId: string; field: string }[];
  durationMs: number;
}

const FILE_RE = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(tsx|ts|json|md|graphql|txt)$/;
const MAX_BYTES = 512 * 1024;

/** Browser APIs page code must not touch: pages only talk to Commons through @commons/ui. */
const FORBIDDEN = new Map([
  ["fetch", "use useCommonsQuery from @commons/ui instead of fetch"],
  ["XMLHttpRequest", "use useCommonsQuery from @commons/ui"],
  ["WebSocket", "pages can't open network connections"],
  ["EventSource", "pages can't open network connections"],
  ["sendBeacon", "pages can't send data elsewhere"],
  ["importScripts", "pages can't load scripts"],
  ["Worker", "pages can't start workers"],
  ["SharedWorker", "pages can't start workers"],
  ["eval", "eval is not allowed"],
  ["Function", "the Function constructor is not allowed"],
  ["localStorage", "pages have no storage; keep state in React"],
  ["sessionStorage", "pages have no storage; keep state in React"],
  ["indexedDB", "pages have no storage; keep state in React"],
  ["cookie", "pages can't read cookies"],
]);

const isScript = (f: string) => /\.tsx?$/.test(f);

function lineOf(sf: ts.SourceFile, pos: number) {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

/** Import rules and banned APIs, checked on the syntax tree. */
function checkSafety(file: string, sf: ts.SourceFile, issues: BuildIssue[]) {
  const visitNode = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      if (!spec.startsWith("./") && !spec.startsWith("../") && !(PAGE_IMPORTS as readonly string[]).includes(spec)) {
        issues.push({ kind: "import", file, line: lineOf(sf, node.getStart(sf)), message: `Can't import "${spec}". Pages can import react, @commons/ui and their own files.` });
      }
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        issues.push({ kind: "safety", file, line: lineOf(sf, node.getStart(sf)), message: "Dynamic import() is not allowed in pages" });
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
        issues.push({ kind: "safety", file, line: lineOf(sf, node.getStart(sf)), message: "require() is not allowed; use import" });
      }
    }
    if (ts.isIdentifier(node) && FORBIDDEN.has(node.text)) {
      const p = node.parent;
      const isDeclarationName =
        (ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) ||
          ts.isShorthandPropertyAssignment(p) || ts.isBindingElement(p) || ts.isVariableDeclaration(p) || ts.isParameter(p) ||
          ts.isFunctionDeclaration(p) || ts.isImportSpecifier(p) || ts.isJsxAttribute(p)) && (p as any).name === node;
      if (!isDeclarationName) {
        issues.push({ kind: "safety", file, line: lineOf(sf, node.getStart(sf)), message: `"${node.text}" isn't available to pages: ${FORBIDDEN.get(node.text)}` });
      }
    }
    if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && FORBIDDEN.has(node.argumentExpression.text)) {
      issues.push({ kind: "safety", file, line: lineOf(sf, node.getStart(sf)), message: `"${node.argumentExpression.text}" isn't available to pages` });
    }
    ts.forEachChild(node, visitNode);
  };
  visitNode(sf);
}

interface FoundQuery {
  file: string;
  line: number;
  text: string;
}

const GRAPHQL_CALLEES = new Set(["useCommonsQuery", "useCommonsMutation", "runGraphql"]);

/** Finds GraphQL documents: gql`...` templates, and string literals passed to the query hooks. */
function findQueries(file: string, sf: ts.SourceFile, notes: string[]): FoundQuery[] {
  const found: FoundQuery[] = [];
  const add = (lit: ts.Node, text: string) => found.push({ file, line: lineOf(sf, lit.getStart(sf)), text });
  const visitNode = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node) && ts.isIdentifier(node.tag) && node.tag.text === "gql") {
      if (ts.isNoSubstitutionTemplateLiteral(node.template)) add(node.template, node.template.text);
      else notes.push(`${file}:${lineOf(sf, node.getStart(sf))}: a query built with \${...} can't be checked before it runs`);
    }
    if (ts.isCallExpression(node)) {
      const callee = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : "";
      const arg = node.arguments[callee === "runGraphql" ? 1 : 0];
      if (GRAPHQL_CALLEES.has(callee) && arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) add(arg, arg.text);
    }
    ts.forEachChild(node, visitNode);
  };
  visitNode(sf);
  return found;
}

function checkQueries(queries: FoundQuery[], schema: GraphQLSchema, typeMap: Map<string, TypeMapEntry>, issues: BuildIssue[]) {
  const deps = new Map<string, { datasetId: string; field: string }>();
  for (const q of queries) {
    let doc;
    try {
      doc = parse(q.text);
    } catch (e) {
      const err = e as GraphQLError;
      issues.push({ kind: "graphql", file: q.file, line: q.line + (err.locations?.[0]?.line ?? 1) - 1, message: err.message });
      continue;
    }
    const errors = validate(schema, doc);
    for (const err of errors) {
      issues.push({ kind: "graphql", file: q.file, line: q.line + (err.locations?.[0]?.line ?? 1) - 1, message: err.message });
    }
    if (errors.length) continue;
    const info = new TypeInfo(schema);
    visit(doc, visitWithTypeInfo(info, {
      Field(node) {
        const parent = info.getParentType();
        const entry = parent && typeMap.get(getNamedType(parent).name);
        const field = entry?.fields[node.name.value];
        if (entry && field) deps.set(`${entry.datasetId}:${field}`, { datasetId: entry.datasetId, field });
      },
    }));
  }
  return [...deps.values()];
}

function typecheck(dir: string, files: string[], issues: BuildIssue[]) {
  const typesReact = resolve(uiModules, "@types/react");
  const program = ts.createProgram(files.map((f) => join(dir, f)), {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    lib: ["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    allowImportingTsExtensions: true,
    resolveJsonModule: true,
    types: [],
    baseUrl: dir,
    paths: {
      "@commons/ui": [uiEntry],
      react: [join(typesReact, "index.d.ts")],
      "react/jsx-runtime": [join(typesReact, "jsx-runtime.d.ts")],
    },
  });
  for (const sf of program.getSourceFiles()) {
    if (!sf.fileName.startsWith(dir)) continue;
    for (const d of [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)]) {
      issues.push({
        kind: "type",
        file: relative(dir, sf.fileName),
        line: d.start !== undefined ? lineOf(sf, d.start) : undefined,
        message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
      });
    }
  }
}

async function bundle(dir: string, issues: BuildIssue[]) {
  try {
    const result = await esbuild.build({
      entryPoints: [join(dir, "Page.tsx")],
      bundle: true,
      write: false,
      format: "esm",
      target: "es2022",
      minify: true,
      jsx: "automatic",
      // Shared with the runtime through the import map; never bundled into the page
      external: [...PAGE_IMPORTS, "react-dom", "react-dom/client"],
      logLevel: "silent",
      absWorkingDir: dir,
    });
    return result.outputFiles[0].text;
  } catch (e: any) {
    for (const err of e.errors ?? [{ text: String(e) }]) {
      issues.push({ kind: "bundle", file: err.location?.file, line: err.location?.line, message: err.text });
    }
    return undefined;
  }
}

/** Tailwind CSS for the page: the UI kit's design tokens plus every class the page uses. */
async function buildCss(dir: string): Promise<string> {
  const stylesPath = join(uiSrc, "styles.css");
  const input = await readFile(stylesPath, "utf8");
  const compiler = await compile(input, { base: uiSrc, from: stylesPath, onDependency: () => {} });
  const scanner = new Scanner({
    sources: [
      ...compiler.sources.map((s) => ({ ...s, negated: s.negated ?? false })),
      { base: uiSrc, pattern: "**/*", negated: false },
      { base: dir, pattern: "**/*", negated: false },
    ],
  });
  const css = compiler.build(scanner.scan());
  return optimize(css, { minify: true }).code;
}

/**
 * Builds a page from source: file and import rules, banned APIs, GraphQL checked against the
 * live schema, TypeScript, then the bundle and its CSS. Never trusts anything prebuilt.
 */
export async function buildPage(files: Record<string, string>, schema: GraphQLSchema, typeMap: Map<string, TypeMapEntry>): Promise<BuildOutput> {
  const started = Date.now();
  const issues: BuildIssue[] = [];
  const notes: string[] = [];
  const names = Object.keys(files);
  const done = (extra: Partial<BuildOutput> = {}): BuildOutput => ({
    ok: issues.length === 0, issues, notes, deps: [], durationMs: Date.now() - started, ...extra,
  });

  for (const n of names) {
    if (!FILE_RE.test(n) || n.includes("..")) issues.push({ kind: "files", file: n, message: "File names may only use letters, digits, - _ . / and end in .tsx, .ts, .json, .md, .graphql or .txt" });
  }
  if (!files["Page.tsx"]) issues.push({ kind: "files", message: "A page needs a Page.tsx whose default export is the page component" });
  const size = Object.values(files).reduce((s, c) => s + Buffer.byteLength(c), 0);
  if (size > MAX_BYTES) issues.push({ kind: "files", message: `Page source is ${Math.round(size / 1024)} KB; the limit is ${MAX_BYTES / 1024} KB` });
  if (issues.length) return done();

  const dir = await mkdtemp(join(tmpdir(), "commons-page-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      await mkdir(dirname(join(dir, name)), { recursive: true });
      await writeFile(join(dir, name), content);
    }
    const scripts = names.filter(isScript);
    const queries: FoundQuery[] = [];
    for (const f of scripts) {
      const sf = ts.createSourceFile(f, files[f], ts.ScriptTarget.ES2022, true, f.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      checkSafety(f, sf, issues);
      queries.push(...findQueries(f, sf, notes));
    }
    for (const f of names.filter((n) => n.endsWith(".graphql"))) queries.push({ file: f, line: 1, text: files[f] });
    const deps = checkQueries(queries, schema, typeMap, issues);
    typecheck(dir, scripts, issues);
    if (issues.length) return done({ deps });
    const js = await bundle(dir, issues);
    if (!js) return done({ deps });
    const css = await buildCss(dir);
    notes.push(`${queries.length} quer${queries.length === 1 ? "y" : "ies"} checked against the live schema`);
    return done({ js, css, deps });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function formatIssues(issues: BuildIssue[]) {
  return issues.map((i) => `${i.file ? `${i.file}${i.line ? `:${i.line}` : ""}: ` : ""}[${i.kind}] ${i.message}`).join("\n");
}
