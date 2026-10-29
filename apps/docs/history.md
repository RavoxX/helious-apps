# Version history and recovery

Every note creation, save, coordinated move, space change, restoration and deletion retains a snapshot. Snapshots include Markdown, path, saved space, revision number, action, timestamp and the account or agent identifier responsible. Changes to other notes during a coordinated move are versioned too.

History and activity are written in the same MongoDB transaction as the edit. A failed operation or stale revision creates no partial history. Snapshots are insert-only in the application: restoring always adds a new revision.

## Compare and restore

1. Open a note and choose **Version history** beside Save/Reload/Delete.
2. Select a revision. The diff compares that snapshot to the current saved content: minus lines were removed, plus lines were added.
3. Check its saved space, path and author. **Full saved content** shows the complete snapshot as plain source.
4. Choose **Restore this revision**, review the destination space, then confirm.

Save or discard your unsaved draft first. Restoring uses the latest revision number shown in the panel; another browser's intervening edit causes a conflict instead of an overwrite. Refresh history and review the new content before retrying.

Restoration keeps the note's **current path**, restores the selected Markdown literally, returns it to the snapshot's **saved space**, and makes a new current revision. It does not rename the note or rewrite historical relative links. If the snapshot used another path, the UI reminds you to review links afterward. Older revisions and the content you replaced remain recoverable.

## Recover deleted notes

Expand **Deleted notes** below the vault toolbar. The list shows up to 100 recently deleted notes in the selected space. Choose a note, review an earlier non-deletion revision, and restore it. Its ID stays the same, so bookmarks and stable references can find it again.

Deleted notes are absent from ordinary lists, search, tags, graph data and current-note analytics. Their deletion still counts as recorded activity. Deletion snapshots cannot themselves be selected as a restoration target; choose a revision with live content instead.

An active note may now occupy a deleted note's path. Recovery returns a conflict in that case and changes nothing. Move or rename the active note first if you want to recover the original at that path.

## Permissions and retention

The note's current space and each snapshot's saved space are checked separately. A principal allowed to read the new Code version of a formerly Personal note cannot retrieve the old Personal content without permission for that space too. Restoring requires write access to the current and historical spaces. Space policies themselves are owner-managed.

The panel paginates retained revision metadata, 25 at a time; the API allows up to 50 per page. Large comparisons are bounded to protect the browser: above 200,000 combined characters, 4,000 combined lines, 2,000 edits or a 100ms diff budget, use Full saved content. The snapshot is complete even when its inline diff is omitted. Diffing uses [jsdiff](https://github.com/kpdecker/jsdiff).

There is no automatic history pruning or individual permanent-note purge yet. Deleted content remains plaintext in MongoDB until the vault is deleted. Vault deletion permanently removes notes, versions, spaces, activity and attachments; it cannot be undone through this UI. Include `note_versions` and `spaces` in your database backups and account for history storage growth.

Existing Phase 4 notes receive one labelled migration baseline. No pre-upgrade edits are invented, and a baseline's timestamp records when it was captured. See [Spaces](./spaces) for upgrade and rollback guidance.
