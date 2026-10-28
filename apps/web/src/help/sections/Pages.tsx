import { AppLink, C, Code, H2, HelpLink, List, P, Table } from "../content.tsx";

export function Pages() {
  return (
    <>
      <P>
        Pages are dashboards and small tools built on Commons data, such as a sales overview or a store ranking. Each page
        is a short piece of React code using the Commons components, so it looks and behaves like the rest of Commons.
      </P>

      <H2>Making a page</H2>
      <List>
        <li><strong>With a coding agent:</strong> ask Claude Code or Codex to build it through <HelpLink to="mcp">MCP</HelpLink> or the <HelpLink to="cli">CLI</HelpLink>. This is the usual way.</li>
        <li><strong>From the starter:</strong> <AppLink to="/pages">Pages → New page</AppLink> creates a working example to change.</li>
        <li><strong>By hand:</strong> <C>commons pages new my-page</C> gives you a folder with <C>Page.tsx</C> and an <C>AGENTS.md</C> describing the rules.</li>
      </List>

      <H2>What happens when a page is pushed</H2>
      <P>Commons builds every version on the server and refuses it, with file and line, if:</P>
      <List>
        <li>it imports anything other than React, the Commons components and its own files,</li>
        <li>it tries to reach the network or browser storage directly (<C>fetch</C>, <C>localStorage</C>…),</li>
        <li>a query asks for something that doesn't exist in the data,</li>
        <li>the TypeScript has errors.</li>
      </List>
      <P>
        Commons also records which dataset fields each version reads. Dataset owners then see the page under{" "}
        <strong>Used by</strong>, and get a warning before removing a field it needs.
      </P>

      <H2>Versions, preview and publishing</H2>
      <List>
        <li>Each push is a new version. It's a preview until you publish it.</li>
        <li>The <strong>Versions</strong> tab shows every version's build log, source and the data it uses.</li>
        <li>Publish any version that built successfully; publishing an older one rolls back.</li>
      </List>
      <Code>{`commons pages push -m "add monthly trend"
commons pages publish`}</Code>

      <H2>Sharing, and who sees what</H2>
      <P>
        A page's visibility (private or company-wide) decides who can open it. What each person sees <em>inside</em> it
        depends on their own access: the page queries data as the person viewing it. Share a sales page with the whole
        company, and only people who can see the sales dataset see numbers.
      </P>
      <Table
        head={["Setting", "Default", "Meaning"]}
        rows={[
          ["Visibility", "Private", "Who can open the page"],
          ["Allow this page to change data", "Off", "Lets the page save edits, as the viewer and within their rights"],
        ]}
      />

      <H2>Safety</H2>
      <P>
        Page code runs in a separate, locked-down frame on its own address. It can't read your Commons session, reach other
        websites, or do anything the viewer couldn't do themselves.
      </P>
    </>
  );
}
