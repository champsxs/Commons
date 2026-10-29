---
title: Coding agents and MCP
summary: Connect Claude Code, Codex or another agent so it can explore data and build pages.
group: Tools and agents
order: 50
keywords: claude codex agent mcp ai token tools
---

MCP (Model Context Protocol) lets a coding agent such as Claude Code or Codex use Commons directly: search datasets, run queries, read this help, and write and publish pages. The agent works with your permissions and sees only what you can see.

## Connect by URL (recommended)

1. Create a token under [Settings → API tokens](/settings). Tick "Read data" and, if the agent should build pages, "Publish pages".
2. Add Commons to your agent:

```bash title="Claude Code"
claude mcp add --transport http commons {{apiUrl}}/mcp --header "Authorization: Bearer cmn_YOUR_TOKEN"
```

```toml title="Codex (~/.codex/config.toml)"
[mcp_servers.commons]
url = "{{apiUrl}}/mcp"
bearer_token_env_var = "COMMONS_TOKEN"
```

For Codex, put the token in the `COMMONS_TOKEN` environment variable (for example in your shell profile) rather than in the file.

Start a new agent session so it picks up the tools. In Claude Code, `/mcp` shows whether Commons is connected.

### Agents that can't connect by URL

Some agents can only start MCP servers as a local program. Install the [CLI](/help/cli), sign in with `commons login`, and build the local server from the Commons repository (`pnpm build`). Then point the agent at it:

```bash title="Claude Code, local program"
claude mcp add commons -- node /path/to/Commons/apps/mcp/dist/server.mjs
```

## What the agent can do

| Tool | What it does |
|---|---|
| `whoami` | Who the agent is acting as, and with which permissions |
| `search_datasets` | Find datasets and fields by name or description |
| `list_datasets` | Every dataset you can see |
| `get_dataset` | Fields, types, references, and the GraphQL names to query them |
| `suggest_reuse` | Before proposing a new dataset: similar existing datasets, and columns that should link to one |
| `dataset_usage` | Datasets and published pages that depend on a dataset |
| `upload_history` | Recent uploads to a dataset, with results |
| `run_query` | Run a GraphQL query as you (lists are capped at 100 items) |
| `get_graphql_schema` | The full GraphQL schema |
| `get_help` | These help topics, so the agent can check how Commons works |
| `set_description` | Describe a dataset or field (and a field's label) you can edit; agents confirm wording with you first |
| `add_field` | Add a field to a dataset you can edit. Agents are told to confirm with you first; needs a token allowed to "Create datasets and upload files" |
| `get_page_guide` | The rules and components for writing a page |
| `list_pages`, `get_page_source` | Existing pages and their code |
| `list_page_versions` | A page's versions: live, failed, who pushed them, which fields each reads |
| `push_page_version` | Upload page code; returns build errors or a preview link |
| `publish_page_version` | Make a version live |

## Things to ask

- "What datasets in Commons have sales data, and how are they linked?"
- "Which city has the most stores? Use Commons."
- "Build a Commons page called store-ranking that ranks stores by revenue within each country, then show me the preview."
- "The store-ranking page should also show transactions per month. Update it and publish."
- "If I upload this file to suppliers with add or update, what happens to suppliers missing from it? Check the Commons help."
- "Add a region field to suppliers (text, 'Sales region')."
- "Our suppliers dataset has no descriptions. Look at the data and suggest one for each field."
- "Did last night's stores upload work?"

For pages, a good agent reads the page guide, checks the real data, writes the page, and fixes any build errors it gets back before showing you the preview. You decide when to publish.

## MCP or CLI?

| Use MCP for | Use the CLI for |
|---|---|
| Questions about the data, quick pages, anything in a chat with an agent | Pages you keep as files or in git, bigger multi-file pages, scripts and scheduled uploads |

They work well together: an agent can explore with MCP and push a page folder with the CLI.

Some things are deliberately left out of MCP: deleting datasets, fields or pages, uploading files (agents with a terminal can use `commons datasets upload`), changing visibility, and managing departments.

> [!NOTE]
> Every call an agent makes is recorded with your name and the tool it used (for example `mcp-http`). Query results go to your agent's AI provider, so follow the company's rules about which data may be shared with which tools.
