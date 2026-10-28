---
title: Getting started
summary: What Commons is, finding data before making your own, and who can see what.
group: Basics
order: 10
keywords: visibility private shared department company search
---

Commons is where teams keep shared data. Each dataset is defined once, owned by a team, and can be linked to from other datasets, so everyone works from the same list of stores, countries or suppliers instead of their own copies. Everything you can see is also available through one GraphQL API, and as pages built on top of it.

## Look before you create

Someone may already have the data you need. Before making a new dataset:

- Search from the top bar (press `/`). It finds datasets, individual fields and pages.
- Browse [Datasets](/datasets) to see what each team owns, how big it is and who uses it.
- When you create a dataset, Commons warns you if a similar one exists and offers to link to it instead.

## Who can see what

Every dataset and page has a visibility setting, and its owner decides it:

| Visibility | Who can see it |
|---|---|
| Private | The owner and the owning team |
| Shared | The owning team, plus the people and teams it's shared with |
| Department users (name) | Everyone in that department, whether through one of its teams or added individually |
| Any signed-in user | Everyone who can sign in to Commons |

Departments are groups of teams (Retail might include Retail Operations and Store Analytics), and can also include individual people. Admins set them up under Settings. When you choose "Department users", you pick one of the departments you belong to.

Seeing is not editing: only the owner, the owning team, and people given edit access can change a dataset. These rules apply everywhere: in the app, in GraphQL, in the CLI, to coding agents, and inside pages. A page shows each viewer only the data they're allowed to see.

## Where to go next

- [Datasets and references](/help/datasets): create your first dataset.
- [Uploading and updating data](/help/uploading): load a file and keep it up to date.
- [Coding agents and MCP](/help/mcp): let Claude Code or Codex explore data and build pages for you.
