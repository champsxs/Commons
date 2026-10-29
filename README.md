# Commons

An internal registry where teams define datasets, reuse and link to each other's data, upload files, query everything through one GraphQL API, and build pages on top of it, by hand or with a coding agent like Claude Code or Codex.

## Run it

Requires Docker, Node 22+ and pnpm.

```bash
pnpm install
pnpm db:up        # Postgres 17 + MinIO
pnpm db:reset     # create the schema and load sample data
pnpm dev          # web app on http://localhost:5173, API on :4000, page sandbox on :4100
pnpm test         # API integration tests (uses the commons_test database)
```

Open http://localhost:5173 and pick a sample user (development sign-in; SSO comes later):

| User | Team | Sees |
|---|---|---|
| Alice Andersson | Data Platform (admin) | everything |
| Bob Berg | Retail Operations | data open to any signed-in user, plus Retail's shared sales |
| Carol Chen | Retail Operations | same as Bob |
| Dave Dahl | none | only data open to any signed-in user |

Sample datasets: `countries` ← `cities` ← `stores` ← `monthly_sales` (shared with Retail Operations only).
Sample departments: Retail (team Retail Operations) and Data & Analytics (team Data Platform).

## What's in the box

```
apps/api       Fastify + PostGraphile v5: registry, ingest, GraphQL, page builds, page sandbox server
apps/web       React app: search, dataset builder, upload, data browser, pages, API tokens
apps/mcp       MCP server so coding agents can explore data and push pages
packages/ui    @commons/ui: the components and hooks the app and every page use
packages/cli   the `commons` command line tool
templates/page starter page folder, with AGENTS.md / CLAUDE.md for coding agents
```

### Datasets and references

- Defining a dataset creates a real table in the `data` schema. A **reference** field (`city`) becomes a foreign key (`city_id`) plus a link record, so the registry knows who uses what.
- The builder can start from a CSV/JSON file: it guesses field types and a key field, then suggests reuse. It flags similar existing datasets ("this may already exist") and columns that should link to one ("`city_code` → Cities").
- **GraphQL** is generated from the tables and rebuilt whenever a dataset changes. References work both ways: `store { city { country } }` and `city { stores }`.
- **Permissions** are enforced by Postgres row-level security. Datasets are private (owner and team), shared (plus the teams/people it's shared with), open to **department users** (everyone in one department), or open to any signed-in user (stored as `company`).
- **Departments** are groups above teams: a department contains whole teams and can also list individual people. Admins manage them under Settings. Owners choosing "Department users (name)" pick one of the departments they belong to. Department access is read-only, like every visibility level; editing still needs the owning team or an explicit share.

### Ingest

CSV, JSON or JSON Lines. Values are validated per field type, and reference codes (`STO`) are resolved to rows in one lookup per field. Unknown codes are reported by value ("no cities with city_code XYZ"). Modes are add, add-or-update (by key) and replace, and you can check a file first without writing.

### Safety between datasets

- Referencing a dataset requires view access to it. Owners can also mark a dataset as not referenceable.
- References can only target unique fields.
- Deleting a referenced row is blocked; nothing cascades into another team's data.
- Fields that other datasets match on can't be removed; fields used by published pages need an explicit force.
- Datasets that others reference can't be deleted.

### Pages as code

A page is a React component (`Page.tsx`) built from `@commons/ui`. It is pushed as source and **built on the server**:

1. File rules: only `react`, `@commons/ui` and the page's own files may be imported.
2. Banned browser APIs: `fetch`, `XMLHttpRequest`, `WebSocket`, storage, `eval` and dynamic `import()`.
3. Every `gql` query is validated against the live GraphQL schema, with file and line in errors.
4. Strict TypeScript.
5. esbuild bundle plus the page's own Tailwind CSS, stored in MinIO.

Each version records which dataset fields it reads, so a field's "used by" list includes pages. Versions can be previewed, published and rolled back.

Pages run on a **separate origin** (`:4100`) in a sandboxed iframe with a strict CSP, so page code can't reach the app's cookies or DOM, or call any other host. The page gets a 30-minute token that queries data **as the person viewing it**, read-only unless the owner allows writes. The same page shows different numbers to different people, according to their permissions.

## Bring your own coding agent

### CLI

**Install.** Commons serves its own CLI. It needs Node.js 22+:

```bash
curl -fsSL http://localhost:4000/cli/install.sh | sh
```

This installs to `~/.commons/bin/commons` and links it into a folder already on your PATH when it can. The server's address is built in; set `PUBLIC_API_URL` on the server to the address people's machines use. Run the same command again to update.

**Sign in.** `commons login` opens the Commons web app. Check the code matches, choose what the CLI may do, and approve. Over SSH, or with `COMMONS_NO_BROWSER=1`, it prints the link to open on any device. `--token` uses a token from Settings → API tokens instead; `--email` works on development servers only.

**Use it:**

```bash
commons datasets                              # what's there
commons datasets show monthly_sales           # fields, references, GraphQL names
commons query '{ allStores(first: 3) { nodes { name city { name } } } }'

commons datasets create suppliers.csv --name Suppliers --visibility company --yes
                                              # guesses fields; --yes links columns to existing datasets it recognises
commons datasets upload suppliers new.csv --mode upsert --dry-run
                                              # exit code 1 when rows have problems, so it works in scripts and CI

commons pages new sales-dashboard             # starter folder with AGENTS.md, CLAUDE.md, types and schema
cd sales-dashboard
# ask Claude Code / Codex: "build a page comparing monthly sales by store"
commons pages push -m "first version"         # prints build errors with file:line, or a preview URL
commons pages publish
```

`commons pages dev` pushes a draft on every save. `commons help <topic>` prints the same help as the web app. Dataset commands need the "Create datasets and upload files" permission when you sign in.

**Updates.** After a command, the CLI says when the server offers a newer version, at most once a day. It never does this with `--json`, when output isn't a terminal, in CI, or with `COMMONS_NO_UPDATE_CHECK=1`. `commons update` downloads the new version, checks that it starts, swaps it in, and prints what's new. Every response to the CLI carries the latest version in a header, so no extra request is needed. The audit log records each CLI version (`cli@0.2.0`), so you can see who still runs an old one.

**Releasing a new CLI version:**
1. Bump `version` in `packages/cli/package.json`.
2. Add a `## x.y.z` section at the top of `help/whats-new.md`; `commons update` prints the sections newer than the user's version.
3. Run `pnpm build` and deploy. The server serves whatever it has built.
4. If an API change would break older CLIs, set `CLI_MIN_VERSION`. Older CLIs are then told to run `commons update`, and updating and help keep working for them.

**Developing the CLI itself:** `pnpm build`, then `node packages/cli/dist/commons.mjs`. Development builds can't self-update; use `git pull` and `pnpm build`.

### MCP

There are two ways to connect an agent. Both offer the same tools and act with the permissions of the token's user.

**By URL (remote MCP).** The API serves MCP at `/mcp`. Create a token under Settings → API tokens, then:

```bash
claude mcp add --transport http commons http://localhost:4000/mcp --header "Authorization: Bearer cmn_..."
```

`localhost` works for agents running on the same machine. Agents elsewhere, including cloud agents, need the server's real address.

**As a local program (stdio).** The agent starts `apps/mcp/dist/server.mjs` itself. It uses the same sign-in as the CLI (`~/.commons/config.json` from `commons login`, or `COMMONS_URL` + `COMMONS_TOKEN`).

Claude Code (`.mcp.json` in your project, or `claude mcp add`):

```json
{ "mcpServers": { "commons": { "command": "node", "args": ["/path/to/Commons/apps/mcp/dist/server.mjs"] } } }
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.commons]
command = "node"
args = ["/path/to/Commons/apps/mcp/dist/server.mjs"]
```

Tools:
- **Read:** `whoami`, `search_datasets`, `list_datasets`, `get_dataset`, `suggest_reuse`, `dataset_usage`, `upload_history`, `get_graphql_schema`, `run_query` (lists capped at 100 items), `get_help`, `list_pages`, `get_page_source`, `list_page_versions`, `get_page_guide`.
- **Change:** `set_description`, `add_field`, `push_page_version`, `publish_page_version`.
- **Not in MCP on purpose:** deletes, uploads, visibility, departments.

Every call is recorded in the audit log with the user and client (`web`, `cli`, `mcp`, `page`, plus `:claude-code` or `:codex` when detected).

### Tokens

| Scope | Allows |
|---|---|
| `data:read` | GraphQL queries |
| `data:write` | GraphQL mutations |
| `datasets:write` | creating and changing datasets, uploads |
| `pages:write` | pushing and publishing pages |

The web app's session has all scopes. Page tokens are read-only and can't use the registry API.

## Help

Help topics are Markdown files in `help/`. The same text is used in three places:
- **Web app:** `/help`, with a sidebar, filter, copy buttons and in-app links.
- **CLI:** `commons help` lists the topics; `commons help uploading` prints one.
- **Agents:** the MCP tool `get_help`.

The page guide for agents (`templates/page/AGENTS.md`) is also a topic, `writing-pages`.

To add a topic, add a Markdown file with front matter:

```markdown
---
title: Scheduled uploads
summary: One line for lists and search
group: Data            # Basics, Data, Tools and agents, Pages or Reference
order: 35              # position within the group
keywords: cron nightly automation
---

Text, `## headings`, tables, and code blocks (```bash title="Label"```).

> [!NOTE]
> Callouts use GitHub's syntax: [!NOTE] or [!WARNING].
```

- `{{apiUrl}}` and `{{webOrigin}}` become the server's public addresses.
- Text between `<!-- if devLogin -->` and `<!-- end -->` appears only on development servers.
- Link to other topics with `/help/<id>`, or to a heading with `/help/<id>#heading-text`.
- Topics are read from disk on each request, so changes show up without a restart.

## API overview

| | |
|---|---|
| `GET /api/search?q=` | datasets, fields, pages |
| `GET/POST /api/datasets` | list / create |
| `POST /api/datasets/suggest` | similar datasets and likely references for a proposed dataset |
| `GET/PATCH/DELETE /api/datasets/:slug` | details (with GraphQL names), settings, sharing |
| `POST/PATCH/DELETE /api/datasets/:slug/fields[/:name]` | add, describe/deprecate, remove fields |
| `GET /api/datasets/:slug/usage` | datasets and pages that depend on it |
| `POST /api/infer` | guess fields from a file |
| `POST /api/datasets/:slug/ingest` | upload a file |
| `GET/POST /api/pages`, `GET/PATCH/DELETE /api/pages/:slug` | pages |
| `POST /api/pages/:slug/versions` | push source; returns build result |
| `POST /api/pages/:slug/publish` | make a version live |
| `GET /api/sdk` | UI kit types, GraphQL schema and page template |
| `GET /api/config` | public addresses (API, web app, page sandbox) |
| `GET /cli/version` | latest and minimum CLI version |
| `GET /api/help`, `/api/help/:id` | help topics as Markdown (`?links=absolute` for use outside the app) |
| `POST /graphql`, `GET /graphiql` | GraphQL |

## Known limits of this MVP

- **Sign-in:** development login only. SSO goes behind the same user and team model.
- **Sorting performance:** every field can be sorted and filtered on. Very large datasets will need indexes on commonly used fields.
- **Builds:** pages build one at a time, in the API process. A separate worker is the next step under load.
- **Built-in agent:** not included yet. Pages come from coding agents via the CLI/MCP, or by hand.
- **Not yet built:** many-to-many references (lists of references), scheduled ingestion and Iceberg storage.
