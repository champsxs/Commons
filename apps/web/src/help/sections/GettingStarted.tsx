import { AppLink, H2, HelpLink, List, P, Table } from "../content.tsx";

export function GettingStarted() {
  return (
    <>
      <P>
        Commons is where teams keep shared data. Each dataset is defined once, owned by a team, and can be linked to from
        other datasets, so everyone works from the same list of stores, countries or suppliers instead of their own copies.
        Everything you can see is also available through one GraphQL API, and as pages built on top of it.
      </P>

      <H2>Look before you create</H2>
      <P>Someone may already have the data you need. Before making a new dataset:</P>
      <List>
        <li>Search from the top bar (press <kbd className="rounded border border-border px-1 text-xs">/</kbd>). It finds datasets, individual fields and pages.</li>
        <li>Browse <AppLink to="/datasets">Datasets</AppLink> to see what each team owns, how big it is and who uses it.</li>
        <li>When you create a dataset, Commons warns you if a similar one exists and offers to link to it instead.</li>
      </List>

      <H2>Who can see what</H2>
      <P>Every dataset and page has a visibility setting, and its owner decides it:</P>
      <Table
        head={["Visibility", "Who can see it"]}
        rows={[
          ["Private", "The owner and the owning team"],
          ["Shared", "The owning team, plus the people and teams it's shared with"],
          ["Any signed-in user", "Everyone who can sign in to Commons"],
        ]}
      />
      <P>
        Only the owner, the owning team, and people given edit access can change a dataset. These rules apply everywhere: in
        the app, in GraphQL, in the CLI, to coding agents, and inside pages. A page shows each viewer only the data they're
        allowed to see.
      </P>

      <H2>Where to go next</H2>
      <List>
        <li><HelpLink to="datasets">Datasets and references</HelpLink>: create your first dataset.</li>
        <li><HelpLink to="uploading">Uploading and updating data</HelpLink>: load a file and keep it up to date.</li>
        <li><HelpLink to="mcp">Coding agents and MCP</HelpLink>: let Claude Code or Codex explore data and build pages for you.</li>
      </List>
    </>
  );
}
