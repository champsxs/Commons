---
title: What's new in the CLI
summary: Changes in each version of the commons CLI, and how to update.
group: Tools and agents
order: 45
keywords: changelog release version update upgrade new
---

Update with `commons update`. The CLI tells you after a command when a newer version is available (at most once a day, and never in scripts). Agents connected by URL ([MCP](/help/mcp)) always get the newest tools; just start a new agent session.

## 0.2.0

- **No Node.js needed:** the CLI is a single program for macOS (Apple Silicon and Intel), Linux (x64 and ARM) and Windows. Install with one command (PowerShell on Windows); the Node.js version is still available.
- **Install from Commons** with one command, and **sign in through your browser** with `commons login`.
- **Data:** `datasets create` (fields guessed from a file, links to existing datasets), `datasets upload` with add, add-or-update and replace, plus `--dry-run`.
- **Changing datasets:** `datasets add-field`, `datasets update` (description, visibility, departments, sharing, source, license), `datasets field` (label, description, deprecate).
- **Checking things:** `datasets usage`, `datasets history`, `pages versions` (with `--log` for build logs).
- **Pages:** `pages update` (title, visibility, allow changing data).
- **Help in the terminal:** `commons help` and `commons help <topic>`.
- **Updates:** `commons update`, and a notice when a newer version is available.
- Add or update uploads now keep columns that aren't in the file, so you can fill a new field with a file of just the key and that field.

## 0.1.0

- First version: `login` with a token, `datasets`, `datasets show`, `query`, `schema`, and pages (`new`, `pull`, `push`, `publish`, `dev`).
