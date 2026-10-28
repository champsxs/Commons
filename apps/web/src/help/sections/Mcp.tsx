import { usePublicConfig } from "../../config.ts";
import { AppLink, C, Code, H2, H3, HelpLink, List, Note, P, Table } from "../content.tsx";

export function Mcp() {
  const { apiUrl } = usePublicConfig();
  return (
    <>
      <P>
        MCP (Model Context Protocol) lets a coding agent such as Claude Code or Codex use Commons directly: search datasets,
        run queries, and write and publish pages. The agent works with your permissions and sees only what you can see.
      </P>

      <H2>Connect by URL (recommended)</H2>
      <List ordered>
        <li>Create a token under <AppLink to="/settings">Settings → API tokens</AppLink>. Tick "Read data" and, if the agent should build pages, "Publish pages".</li>
        <li>Add Commons to your agent:</li>
      </List>
      <Code label="Claude Code">{`claude mcp add --transport http commons ${apiUrl}/mcp --header "Authorization: Bearer cmn_YOUR_TOKEN"`}</Code>
      <Code label="Codex (~/.codex/config.toml)">{`[mcp_servers.commons]
url = "${apiUrl}/mcp"
bearer_token_env_var = "COMMONS_TOKEN"`}</Code>
      <P>For Codex, put the token in the <C>COMMONS_TOKEN</C> environment variable (for example in your shell profile) rather than in the file.</P>
      <P>
        Start a new agent session so it picks up the tools. In Claude Code, <C>/mcp</C> shows whether Commons is connected.
      </P>

      <H3>Agents that can't connect by URL</H3>
      <P>
        Some agents can only start MCP servers as a local program. Install the <HelpLink to="cli">CLI</HelpLink>, sign in with{" "}
        <C>commons login</C>, and build the local server from the Commons repository (<C>pnpm build</C>). Then point the
        agent at it:
      </P>
      <Code label="Claude Code, local program">{`claude mcp add commons -- node /path/to/Commons/apps/mcp/dist/server.mjs`}</Code>

      <H2>What the agent can do</H2>
      <Table
        head={["Tool", "What it does"]}
        rows={[
          [<C>search_datasets</C>, "Find datasets and fields by name or description"],
          [<C>list_datasets</C>, "Every dataset you can see"],
          [<C>get_dataset</C>, "Fields, types, references, and the GraphQL names to query them"],
          [<C>run_query</C>, "Run a GraphQL query as you (lists are capped at 100 items)"],
          [<C>get_graphql_schema</C>, "The full GraphQL schema"],
          [<C>get_page_guide</C>, "The rules and components for writing a page"],
          [<C>list_pages</C>, <C>get_page_source</C>],
          [<C>push_page_version</C>, "Upload page code; returns build errors or a preview link"],
          [<C>publish_page_version</C>, "Make a version live"],
        ]}
      />

      <H2>Things to ask</H2>
      <List>
        <li>"What datasets in Commons have sales data, and how are they linked?"</li>
        <li>"Which city has the most stores? Use Commons."</li>
        <li>"Build a Commons page called store-ranking that ranks stores by revenue within each country, then show me the preview."</li>
        <li>"The store-ranking page should also show transactions per month. Update it and publish."</li>
      </List>
      <P>
        For pages, a good agent reads the page guide, checks the real data, writes the page, and fixes any build errors it
        gets back before showing you the preview. You decide when to publish.
      </P>

      <H2>MCP or CLI?</H2>
      <Table
        head={["Use MCP for", "Use the CLI for"]}
        rows={[[
          "Questions about the data, quick pages, anything in a chat with an agent",
          "Pages you keep as files or in git, bigger multi-file pages, scripts and scheduled uploads",
        ]]}
      />
      <P>They work well together: an agent can explore with MCP and push a page folder with the CLI.</P>

      <Note>
        Every call an agent makes is recorded with your name and the tool it used (for example <C>mcp-http</C>). Query
        results go to your agent's AI provider, so follow the company's rules about which data may be shared with which
        tools.
      </Note>
    </>
  );
}
