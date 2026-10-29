# Understand your vault

Choose **Analytics** inside a vault. Statistics are computed from the owner's saved notes and ready attachments. Unsaved editor drafts do not change the dashboard. Use **Refresh statistics** to load changes from another browser.

## Counts and connections

- **Notes** counts saved Markdown notes, excluding attachments and unresolved targets.
- **Words** sums the shared Markdown parser's word counts. Code is included as searchable text; frontmatter and raw HTML are excluded.
- **Resolved links** counts local references that resolve to saved notes or ready attachments. Repeated references count individually. External URLs are excluded.
- **Orphan notes** counts saved notes with no incoming or outgoing graph neighbors, including unresolved connections in the graph topology.
- **Unresolved links** counts unresolved local reference occurrences. These include missing, ambiguous or invalid destinations, rather than missing heading/block fragments within an existing note.

**Most linked notes** ranks up to ten notes by distinct incoming source notes. Multiple links from one source increase the link occurrence count but only count once as a backlink. Open a result to continue writing.

Each note's own About section shows words, estimated reading time (200 words/minute), last edited time and backlink count. Its Connections and Outline panels provide navigation.

## Activity heatmap

The heatmap covers the last 365 calendar days in UTC. Creating, updating, moving, automatically rewriting or deleting a note records one change per affected note. The activity record commits in the same transaction as the note mutation, so rejected or stale writes do not inflate activity.

Activity recording begins with Phase 4. Older edits are not reconstructed. The dashboard shows the first recorded change date. Hover a square for its date/count, or expand **Activity data** for an accessible table. Color intensity is relative to the busiest recorded day.

This internal activity data stays in MongoDB. It is not external tracking, an agent audit log, version recovery or proof of immutable history. Deleting a vault deletes its activity records too. Existing backup procedures include the new `note_changes` collection.

## Growth and tags

The growth chart groups current notes by original creation date and accumulates their count. Deleted notes are absent; it is not a historical net-vault-size chart. **Growth data** exposes the same values as a table.

Tag distribution counts notes per normalized tag, once per note. The first twelve tags appear as bars; **All tags** lists the remainder when needed. A note with several tags contributes to each one.

## Agent activity and access

Agent activity lists recent MCP reads and writes with token name, action and time. It contains IDs and operation metadata, never note bodies or secret values. Activity expires after 90 days. The Space selector applies to both statistics and activity. Empty activity means no matching recorded operations. See [AI connections](./mcp).

The API authorizes vault ownership before computing statistics or reading activity. Other accounts receive 404 for this vault's graph, analytics, notes, backlinks and files. Current graph/metadata limits also apply to analytics; see [graph limits](./graph#performance-and-accessibility).
