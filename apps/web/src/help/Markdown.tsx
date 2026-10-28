import type { ReactNode } from "react";
import { Link } from "react-router";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { C, Code, H2, H3, Note, P } from "./content.tsx";

/** Turns a heading's text into the id used for /help/topic#anchor links. */
export const anchor = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const textOf = (node: any): string =>
  node?.type === "text" ? node.value : (node?.children ?? []).map(textOf).join("");

/**
 * Remark plugin for two things plain Markdown lacks:
 * - `> [!NOTE]` / `> [!WARNING]` blockquotes become callouts (GitHub's syntax)
 * - ```bash title="Label" puts a label on a code block
 */
function commonsMarkdown() {
  return (tree: any) => {
    const walk = (node: any) => {
      if (node.type === "blockquote") {
        const text = node.children?.[0]?.children?.[0];
        const m = text?.type === "text" && text.value.match(/^\[!(NOTE|WARNING)\]\s*/);
        if (m) {
          text.value = text.value.slice(m[0].length);
          node.data = { ...node.data, hProperties: { "data-callout": m[1].toLowerCase() } };
        }
      }
      if (node.type === "code") {
        const title = node.meta?.match(/title="([^"]*)"/)?.[1];
        node.data = { ...node.data, hProperties: { "data-title": title ?? "", "data-lang": node.lang ?? "" } };
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}

const components: Components = {
  // The topic title is shown above the body, so a file's own "# Title" is drawn as a section heading
  h1: ({ node, children }) => <H2 id={anchor(textOf(node))}>{children}</H2>,
  h2: ({ node, children }) => <H2 id={anchor(textOf(node))}>{children}</H2>,
  h3: ({ node, children }) => <H3><span id={anchor(textOf(node))} className="scroll-mt-20">{children}</span></H3>,
  p: ({ children }) => <P>{children}</P>,
  ul: ({ children }) => <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed">{children}</ul>,
  ol: ({ children }) => <ol className="mt-3 flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-relaxed">{children}</ol>,
  // Code blocks are handled by `pre`; this is inline code only
  code: ({ children }) => <C>{children}</C>,
  pre: ({ node }: any) => {
    // The title from ```lang title="…" sits on the inner <code> element
    const code = node?.children?.[0];
    return <Code label={code?.properties?.["data-title"] || code?.properties?.dataTitle || undefined}>{textOf(code).replace(/\n$/, "")}</Code>;
  },
  blockquote: ({ node, children, ...props }: any) => {
    const kind = props["data-callout"];
    return <Note tone={kind === "warning" ? "warning" : "info"}>{unwrapParagraphs(children)}</Note>;
  },
  table: ({ children }) => (
    <div className="mt-3 overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/50 text-left text-[13px] text-muted-foreground">{children}</thead>,
  tr: ({ children }) => <tr className="border-t border-border align-top first:border-t-0">{children}</tr>,
  th: ({ children }) => <th className="px-3 py-2 align-middle font-medium">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2">{children}</td>,
  a: ({ href = "", children }) =>
    href.startsWith("/") ? (
      <Link to={href} className="text-primary hover:underline">{children}</Link>
    ) : (
      <a href={href} target="_blank" rel="noreferrer" className="text-primary hover:underline">{children}</a>
    ),
  kbd: ({ children }) => <kbd className="rounded border border-border px-1 text-xs">{children}</kbd>,
};

/** Notes are already padded boxes, so their paragraphs shouldn't add their own top margin. */
function unwrapParagraphs(children: ReactNode) {
  return <div className="flex flex-col gap-2 [&>p]:mt-0">{children}</div>;
}

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, commonsMarkdown]} components={components}>
      {children}
    </ReactMarkdown>
  );
}
