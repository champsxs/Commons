import { usePublicConfig } from "../../config.ts";
import { AppLink, C, Code, H2, H3, HelpLink, List, Note, P, Table } from "../content.tsx";

export function Cli() {
  const { apiUrl, devLogin } = usePublicConfig();
  return (
    <>
      <P>
        The <C>commons</C> command line tool lets you look up datasets, run queries, upload files and build pages from a
        terminal. It's also how coding agents work with page files on your computer. It needs{" "}
        <a className="text-primary hover:underline" href="https://nodejs.org" target="_blank" rel="noreferrer">Node.js 22</a> or newer.
      </P>

      <H2>Install</H2>
      <Code label="macOS and Linux">{`curl -fsSL ${apiUrl}/cli/install.sh | sh`}</Code>
      <P>
        This installs to <C>~/.commons/bin/commons</C> and links it into a folder on your PATH when it can. If it can't, it
        prints the line to add to your shell profile. Run the same command again to update.
      </P>
      <P>
        On Windows, download <a className="text-primary hover:underline" href={`${apiUrl}/cli/commons.mjs`}>commons.mjs</a> and
        run it with <C>node commons.mjs</C>.
      </P>

      <H2>Sign in</H2>
      <Code>commons login</Code>
      <List ordered>
        <li>Your browser opens a Commons page showing a code.</li>
        <li>Check it matches the code in your terminal.</li>
        <li>Choose what the CLI may do, then click <strong>Approve</strong>.</li>
      </List>
      <P>
        The terminal then says who you're signed in as. Over SSH, or with <C>COMMONS_NO_BROWSER=1</C>, it just prints the
        link, which you can open on any device.
      </P>
      <Table
        head={["Permission", "Allows"]}
        rows={[
          ["Read data you can see", "Queries, datasets, pages"],
          ["Create and publish pages", <>commons pages push / publish</>],
          ["Create datasets and upload files", <>commons datasets create / upload</>],
          ["Change rows through GraphQL", "GraphQL mutations"],
        ]}
      />
      <P>
        The CLI acts as you: it never sees more than you do. Check with <C>commons whoami</C>, sign out with{" "}
        <C>commons logout</C>, and revoke old sign-ins under <AppLink to="/settings">Settings → API tokens</AppLink>.
      </P>
      <H3>Other ways to sign in</H3>
      <List>
        <li><C>commons login --token cmn_…</C> uses a token you created in Settings, e.g. for a server or CI job.</li>
        <li>For scripts, set <C>COMMONS_TOKEN</C> (and <C>COMMONS_URL</C>) instead of signing in.</li>
        {devLogin && <li>Development servers only: <C>commons login --email you@example.com</C>.</li>}
      </List>

      <H2>Common commands</H2>
      <Code label="Explore">{`commons datasets                      # everything you can see
commons datasets sales                # search datasets and fields
commons datasets show monthly_sales   # fields, references, GraphQL names
commons query '{ allStores(first: 5) { nodes { name city { name } } } }'`}</Code>
      <Code label="Data">{`commons datasets create suppliers.csv --name Suppliers --visibility company   # company = any signed-in user
commons datasets upload suppliers new.csv --mode upsert --dry-run`}</Code>
      <P>
        <C>datasets create</C> guesses the fields from the file and tells you which columns look like links to existing
        datasets. Add <C>--link country_code=countries</C> to link one, or <C>--yes</C> to accept all suggestions. See{" "}
        <HelpLink to="uploading">Uploading and updating data</HelpLink> for upload modes.
      </P>
      <Code label="Pages">{`commons pages new sales-dashboard     # a folder with a starter page and instructions for agents
cd sales-dashboard
commons pages push -m "first version" # build on the server; prints errors or a preview link
commons pages publish                 # make it live
commons pages dev                     # push a draft on every save`}</Code>
      <P>Add <C>--help</C> to any command for all its options.</P>

      <Note>
        Use the CLI when you want files on disk (pages you keep in git, scripts, scheduled uploads). For quick questions in a
        chat with an agent, <HelpLink to="mcp">MCP</HelpLink> is usually simpler.
      </Note>
    </>
  );
}
