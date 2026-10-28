---
title: Command line (CLI)
summary: Install the commons CLI, sign in through your browser, and use it in scripts.
group: Tools and agents
order: 40
keywords: install login terminal script token help
---

The `commons` command line tool lets you look up datasets, run queries, upload files and build pages from a terminal. It's also how coding agents work with page files on your computer. It needs [Node.js 22](https://nodejs.org) or newer.

## Install

```bash title="macOS and Linux"
curl -fsSL {{apiUrl}}/cli/install.sh | sh
```

This installs to `~/.commons/bin/commons` and links it into a folder on your PATH when it can. If it can't, it prints the line to add to your shell profile. Run the same command again to update.

On Windows, download [commons.mjs]({{apiUrl}}/cli/commons.mjs) and run it with `node commons.mjs`.

## Sign in

```bash
commons login
```

1. Your browser opens a Commons page showing a code.
2. Check it matches the code in your terminal.
3. Choose what the CLI may do, then click **Approve**.

The terminal then says who you're signed in as. Over SSH, or with `COMMONS_NO_BROWSER=1`, it just prints the link, which you can open on any device.

| Permission | Allows |
|---|---|
| Read data you can see | Queries, datasets, pages |
| Create and publish pages | `commons pages push` / `publish` |
| Create datasets and upload files | `commons datasets create` / `upload` |
| Change rows through GraphQL | GraphQL mutations |

The CLI acts as you: it never sees more than you do. Check with `commons whoami`, sign out with `commons logout`, and revoke old sign-ins under [Settings → API tokens](/settings).

### Other ways to sign in

- `commons login --token cmn_…` uses a token you created in Settings, e.g. for a server or CI job.
- For scripts, set `COMMONS_TOKEN` (and `COMMONS_URL`) instead of signing in.
<!-- if devLogin -->
- Development servers only: `commons login --email you@example.com`.
<!-- end -->

## Common commands

```bash title="Explore"
commons datasets                      # everything you can see
commons datasets sales                # search datasets and fields
commons datasets show monthly_sales   # fields, references, GraphQL names
commons query '{ allStores(first: 5) { nodes { name city { name } } } }'
```

```bash title="Data"
commons datasets create suppliers.csv --name Suppliers --visibility company   # company = any signed-in user
commons datasets upload suppliers new.csv --mode upsert --dry-run
```

`datasets create` guesses the fields from the file and tells you which columns look like links to existing datasets. Add `--link country_code=countries` to link one, or `--yes` to accept all suggestions. Use `--visibility department --department retail` to open it to a department. See [Uploading and updating data](/help/uploading) for upload modes.

```bash title="Pages"
commons pages new sales-dashboard     # a folder with a starter page and instructions for agents
cd sales-dashboard
commons pages push -m "first version" # build on the server; prints errors or a preview link
commons pages publish                 # make it live
commons pages dev                     # push a draft on every save
```

```bash title="Help"
commons help                          # list help topics
commons help uploading                # read one, the same text as this page
```

Add `--help` to any command for all its options.

> [!NOTE]
> Use the CLI when you want files on disk (pages you keep in git, scripts, scheduled uploads). For quick questions in a chat with an agent, [MCP](/help/mcp) is usually simpler.
