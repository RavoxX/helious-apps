# Spaces and permissions

A vault holds notes and attachments. **Spaces** are security boundaries inside that vault: for example Personal, Code, Research or Client X. Paths remain unique across the vault, so moving a note between spaces does not require changing its Markdown links.

## Personal and Code

Every new vault contains two built-in spaces:

| Space    | Default agent policy                        | Purpose                                                                |
| -------- | ------------------------------------------- | ---------------------------------------------------------------------- |
| Personal | No agent access                             | Journals, personal knowledge and anything you have not chosen to share |
| Code     | Read/write eligibility with explicit grants | Project context you choose to make available to coding agents          |

Neither space grants access to an agent by itself. Agent authentication, token creation and MCP connections are available under AI connections in the sidebar. Tokens require explicit vault, Space and action grants. Selecting Personal additionally requires confirmation and a permitting Space policy. The server intersects token grants with current policies on every operation.

Your signed-in account can read and write all of its own spaces. Another account, including an instance administrator, cannot access your vaults through the API. Spaces do not currently provide multi-user collaboration.

## Use spaces in the app

Use the **Space** selector beside Current vault to choose All spaces or one space. The explorer, search, attachments, graph, analytics and deleted-note list use that selection. New notes and uploads use the selected space; **All spaces creates in Personal**. The new-note form states the destination.

To reassign a note, change **Note space** in the editor and save. This is an ordinary versioned edit, with the same revision-conflict protection as a content change. Unsaved space choices remain part of your in-memory draft. The owner can still open an existing tab or follow an authorized link into another space while the explorer is filtered.

Expand **Spaces & permissions** below the vault toolbar to create a custom space or change a policy. Custom spaces start with No agent access. Built-in names remain Personal and Code; custom names can be changed. An unused custom space can be deleted, but retained notes, attachments or historical revisions prevent deletion. Delete the vault only when you intend to permanently erase its content and history.

## Agent access is an intersection

The permission engine requires all of these:

- The authenticated principal belongs to the vault's owner.
- The principal explicitly names the vault and the individual space. There is no wildcard or implicit Personal grant.
- The token includes `notes:read`; a write also requires `notes:write`.
- The space's current policy permits that operation: none, read-only, or read/write.

Personal starts with policy **none**. Making it eligible in the UI requires an explicit confirmation, and a future token would still need a separate, explicit grant for that Personal space. Changing a policy to none takes effect on subsequent requests. Write operations check the current policy inside the vault transaction; an agent cannot change space policies, create spaces or manage vault settings.

Policy eligibility is not a token and does not connect a model. Resend verification and account-session checks remain required. Request headers and body fields cannot turn a normal session into an agent principal.

## Avoid indirect leaks

Server filters apply to lists, direct reads, search, tags, note creation/updates/deletion, attachments, analytics, graph data, backlinks, outgoing-link metadata and recovery/history endpoints. Graph edges and degree counts are recomputed from visible nodes. A hidden note is omitted rather than turned into a labelled missing node. Hidden deleted paths are also checked before exposing unresolved references. A move that would rewrite a note outside the agent's write permissions is rejected atomically.

Historical revisions must pass checks for both the note's **current space** and the revision's **saved space**. Moving a note from Personal into Code does not expose its old Personal revisions to a Code-only principal. Restoring an old revision also requires write permission in both spaces and returns the content to the saved space.

Permissions operate on whole notes. Text, frontmatter, filenames or links you deliberately write into an accessible note are part of that note's content; this is not automatic secret detection or redaction. Review content before moving it into a space intended for agents. Use the dedicated [encrypted secrets](./secrets) feature for credentials; it is separate from normal notes.

## Upgrade from Phase 4

Back up MongoDB, including GridFS, and stop older app instances before upgrading. Startup creates Personal and Code for each existing vault, assigns all unclassified notes and attachments to **Personal**, classifies legacy activity as Personal, and stores a labelled baseline of each current note. The migration is idempotent and marks completed vaults with schema version 5. It does not reconstruct earlier edits or grant agent access.

The note-path index now applies only to active notes. Deleting a note retains its content and history, while allowing a new note at the old path. The new index is created before the old constraint is removed. Use the Phase 5 application with this database afterward; rolling back only the app binary is not supported. Restore the pre-upgrade backup for a full rollback.

No new environment variables are needed. MongoDB must remain a replica set for transactional writes.
