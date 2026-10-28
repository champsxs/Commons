---
title: Pages
summary: Dashboards and tools built on Commons data: build, preview, publish and share.
group: Pages
order: 60
keywords: dashboard publish version preview share sandbox form
---

Pages are dashboards and small tools built on Commons data, such as a sales overview or a store ranking. Each page is a short piece of React code using the Commons components, so it looks and behaves like the rest of Commons.

## Making a page

- **With a coding agent:** ask Claude Code or Codex to build it through [MCP](/help/mcp) or the [CLI](/help/cli). This is the usual way.
- **From the starter:** [Pages → New page](/pages?new=1) creates a working example to change.
- **By hand:** `commons pages new my-page` gives you a folder with `Page.tsx` and an `AGENTS.md` describing the rules ([Writing pages](/help/writing-pages)).

## What happens when a page is pushed

Commons builds every version on the server and refuses it, with file and line, if:

- it imports anything other than React, the Commons components and its own files,
- it tries to reach the network or browser storage directly (`fetch`, `localStorage`…),
- a query asks for something that doesn't exist in the data,
- the TypeScript has errors.

Commons also records which dataset fields each version reads. Dataset owners then see the page under **Used by**, and get a warning before removing a field it needs.

## Versions, preview and publishing

- Each push is a new version. It's a preview until you publish it.
- The **Versions** tab shows every version's build log, source and the data it uses.
- Publish any version that built successfully; publishing an older one rolls back.

```bash
commons pages push -m "add monthly trend"
commons pages publish
```

> [!NOTE]
> Opening a page shows its **published** version. A newer version you pushed stays a preview until you publish it.

## Sharing, and who sees what

A page's visibility (private, department users, or any signed-in user) decides who can open it. What each person sees *inside* it depends on their own access: the page queries data as the person viewing it. Share a sales page with the whole company, and only people who can see the sales dataset see numbers.

| Setting | Default | Meaning |
|---|---|---|
| Visibility | Private | Who can open the page |
| Allow this page to change data | Off | Lets the page save edits (forms), as the viewer and within their rights |

## Safety

Page code runs in a separate, locked-down frame on its own address. It can't read your Commons session, reach other websites, or do anything the viewer couldn't do themselves.
