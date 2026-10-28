import type { ComponentType } from "react";
import { GettingStarted } from "./sections/GettingStarted.tsx";
import { Datasets } from "./sections/Datasets.tsx";
import { Uploading } from "./sections/Uploading.tsx";
import { Cli } from "./sections/Cli.tsx";
import { Mcp } from "./sections/Mcp.tsx";
import { Pages } from "./sections/Pages.tsx";
import { Graphql } from "./sections/Graphql.tsx";

export interface HelpSection {
  /** URL part: /help/<id> */
  id: string;
  title: string;
  /** One line, shown on the help home page and in search */
  summary: string;
  group: "Basics" | "Data" | "Tools and agents" | "Pages" | "Reference";
  /** Extra words people might search for */
  keywords?: string;
  Component: ComponentType;
}

/**
 * Every help topic. To add one: write a component in ./sections (use the blocks in ./content.tsx)
 * and add it here. Order here is the order in the sidebar.
 */
export const HELP_SECTIONS: HelpSection[] = [
  { id: "getting-started", title: "Getting started", group: "Basics", Component: GettingStarted,
    summary: "What Commons is, finding data before making your own, and who can see what.",
    keywords: "visibility private shared company search" },
  { id: "datasets", title: "Datasets and references", group: "Data", Component: Datasets,
    summary: "Create datasets, choose a key field, and link to other teams' data instead of copying it.",
    keywords: "fields key reference link deprecate delete" },
  { id: "uploading", title: "Uploading and updating data", group: "Data", Component: Uploading,
    summary: "How add, add-or-update and replace treat existing rows, and what happens to bad values.",
    keywords: "upload csv json ingest upsert append replace mode blank empty" },
  { id: "cli", title: "Command line (CLI)", group: "Tools and agents", Component: Cli,
    summary: "Install the commons CLI, sign in through your browser, and use it in scripts.",
    keywords: "install login terminal script token" },
  { id: "mcp", title: "Coding agents and MCP", group: "Tools and agents", Component: Mcp,
    summary: "Connect Claude Code, Codex or another agent so it can explore data and build pages.",
    keywords: "claude codex agent mcp ai token" },
  { id: "pages", title: "Pages", group: "Pages", Component: Pages,
    summary: "Dashboards and tools built on Commons data: build, preview, publish and share.",
    keywords: "dashboard publish version preview share sandbox" },
  { id: "graphql", title: "GraphQL basics", group: "Reference", Component: Graphql,
    summary: "Query lists and single rows, follow references, and try it in GraphiQL.",
    keywords: "query api graphiql filter sort" },
];
