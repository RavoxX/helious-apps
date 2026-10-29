# Vaults, notes and search

Phase 2 provides server vaults stored in MongoDB and a shared Markdown engine. Phase 3 adds the [Markdown workspace](./editor) in **Vaults**, including independent panes, bookmarks, coordinated moves and hotkeys. Local folders and sync are Phase 8. Helious Cloud will use the same account workflow; the public managed service is not deployed yet.

## Work with a vault

Create or select a vault in the account panel. Add a note using a relative path such as `Projects/Helious/Overview.md`; the form adds `.md` when omitted. Notes retain the exact Markdown you save. Use **Save note** or Ctrl/Cmd+S explicitly. Tabs preserve unsaved drafts in memory and show an unsaved indicator; closing a dirty tab asks before discarding. Drafts do not survive a browser reload or crash. Save before leaving.

Each save supplies the revision you opened. If another browser saves first, your save returns 409, leaves your draft visible and preserves the newer server content. Copy your draft somewhere safe before **Discard edits and reload**. Revision counters protect concurrent edits; [version history](./history) retains complete saved snapshots for comparison and recovery.

Change **Note path**, use a file's pencil action, or drag a note onto a folder to move or rename it. A MongoDB transaction updates the path and affected link destinations together, preserving aliases, fragments and link titles. Relative outgoing Markdown links retain their destinations. Conflicts cancel the entire operation. Atomic moves are limited to 10,000 notes and 16 MiB of Markdown per vault. Notes are recoverably deleted; deleting a vault permanently erases its content and history. Use backups. See the [workspace guide](./editor) for dirty drafts and keyboard alternatives.

## Markdown metadata

The engine understands CommonMark and GFM structure and extracts:

- YAML frontmatter with scalar, array and object properties. `title` overrides the first H1; `tags` accepts a string or list.
- Headings with Unicode slugs and duplicate suffixes such as `decisions-1`.
- Inline tags such as `#project` and `#code/typescript`, stored lowercase.
- Block IDs such as `A useful paragraph. ^decision-1`.
- Local Markdown links, images and reference links, plus wiki links and embeds.

```md
---
title: Project overview
tags: [project, code/typescript]
status: active
---

# Overview

Read [[Architecture|our design]] and [[Decisions#Storage]].
Reference [[Runbook#^restart]] or embed ![[Diagram.md]].
Markdown links work too: [Architecture](./Architecture.md).
```

Code fences, inline code and raw HTML do not create wiki links or tags. Code remains searchable as text. External URLs are not graph edges. Malformed or unsafe YAML produces a warning while the Markdown remains stored. Secret reference tokens are ordinary source text and are never resolved.

## Link resolution and graph data

Wiki links first try the source folder, then the vault root, then a unique basename elsewhere. A leading slash explicitly selects the vault root, for example `[[/Projects/Overview.md]]`. Resolution is case-insensitive and Unicode-normalized. Ambiguous names remain unresolved; specify their full path. Markdown destinations resolve relative to their source note; escaping the vault is invalid. Heading and block existence are reported separately from note existence. Use `.md` explicitly for note names containing dots.

The note panel shows linked outgoing notes and backlinks. The **Graph** tab provides [global/local WebGL exploration](./graph); **Analytics** shows [statistics, activity, growth and tags](./analytics). `/graph` retains its note-only API, while `?includeFiles=true` adds ready attachments, unresolved target nodes, creation dates and word counts. Graph requests are bounded to 50,000 nodes, 200,000 local reference occurrences and 64 MiB of projected metadata, returning 422 rather than truncating. Attachment nodes and downloads work; inline attachment viewers remain later work.

## Search syntax

| Input                        | Meaning                                              |
| ---------------------------- | ---------------------------------------------------- |
| `database decision`          | Both literal terms in indexed path, title or text    |
| `"database decision"`        | A literal phrase                                     |
| `tag:code/typescript`        | Exact normalized tag, including its full nested name |
| `-tag:archive`               | Exclude a tag                                        |
| `path:Projects/Helious`      | Path contains this text, case-insensitively          |
| `file:Overview`              | Filename contains this text, case-insensitively      |
| `path:"Projects/My project"` | Quote spaces within a filter value                   |

Combine filters with words. Search uses MongoDB's `none` language full-text index, then literal filters; it does not perform fuzzy substring expansion of indexed words. No semantic search, regex, `line:` operator or negative path/file filters yet. Unsupported operators return an explicit error. Limit: 256 characters, 16 terms/filters, at most 100 results per request. The explorer and quick switcher load up to 10,000 note summaries using the paginated list API.

## Attachments and limits

Upload one file at a time, up to 20 MiB. The app places files under `Attachments/`; bytes are streamed to GridFS. Downloads require your session, use attachment disposition and never execute as inline HTML. Duplicate attachment paths return 409; delete the original before replacing it.

Paths are relative, at most 1,024 characters, 32 segments and 255 characters per segment. The `.helious` folder is reserved. Empty segments, traversal, control bytes, Windows device names, backslashes and reserved filename characters are rejected. Paths differing only by case or Unicode composition collide. Notes require `.md` and at most 1,000,000 characters. Metadata limits: 10,000 links, 10,000 block IDs, 5,000 headings and 1,000 tags per note. Frontmatter is capped at 64 KiB, with bounded nesting and aliases.

All vault content remains isolated from other accounts. Spaces and policy-aware knowledge queries are implemented; scoped agent tokens/MCP connections are available in Profile → AI connections. See [Spaces](./spaces) and [history/recovery](./history). Ordinary notes are not encrypted secrets. The temporary preview loses notes and accounts when restarted; use a persistent MongoDB deployment for real data.
