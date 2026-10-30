# Canvas

Choose **Vaults → Canvas** in the browser workspace. Create a board with a relative `.canvas` path. Its destination is the selected Space, or Personal under All spaces. Boards are server attachments protected by the existing owner/Space/session checks; they are not secret storage.

## Working on a board

- Add **text**, **file**, **link** or **group** cards. File cards reference existing vault paths; **Open note** opens a note in the current index/Space. References are literal paths and are not automatically repaired by note renames.
- Drag cards to move them, or focus one and use arrow keys (Shift moves 50 units instead of 10). The selected-card form edits content, width, height and color. Choose **Apply card changes** before saving.
- Drag empty space to pan. Pinch on touch devices, use Ctrl/Cmd + wheel, or use the zoom buttons. **Fit cards** frames all cards.
- Expand **Connections**, choose two cards and connect them. Edit labels, attachment sides and arrow ends. Removing a card removes its incident connections. Groups are visual boundaries; moving one does not move enclosed cards.
- **Undo/Redo** keeps up to 30 in-memory steps, grouping a drag into one step. **Save canvas** persists explicitly. **Download canvas** exports the current JSON draft.

Canvas text is escaped plain text. Link cards do not fetch previews; websites open only after a click. Arbitrary HTML, images, remote frames and scripts are not rendered. Imported file cards can name other safe vault-relative attachments, but the current Open note action opens Markdown notes only.

## Conflicts and drafts

Each save sends the last-read ID, revision and content hash. A concurrent change returns a conflict and preserves your unsaved board. Download your draft before discarding it; **Reload canvas → Discard canvas draft and reload** fetches the latest file. A stale delete is also rejected.

Switching boards, vault views or account-panel sections keeps unsaved canvas drafts in the current tab's memory. Page-leave warnings include canvas drafts. Logout/account clearing removes them. Reload/crash loses memory-only drafts: save or download before leaving.

Canvas files use attachment storage, which currently retains **only the latest saved file**. They do not have Markdown note version history or Deleted notes recovery. Deletion requires confirmation. Include GridFS in your backups. Native v0.8.1 can transport `.canvas` attachments through selected-Space sync, but has no native canvas editor yet.

## JSON format and interoperability

Helious supports a bounded subset of [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/). Files are UTF-8 JSON with `nodes` and `edges` arrays (missing arrays mean empty). Example:

```json
{
  "nodes": [
    {
      "id": "idea",
      "type": "text",
      "x": 0,
      "y": 0,
      "width": 280,
      "height": 180,
      "text": "An idea"
    },
    {
      "id": "note",
      "type": "file",
      "x": 360,
      "y": 0,
      "width": 280,
      "height": 180,
      "file": "Projects/Plan.md"
    }
  ],
  "edges": [
    {
      "id": "connection",
      "fromNode": "idea",
      "toNode": "note",
      "fromSide": "right",
      "toSide": "left",
      "toEnd": "arrow",
      "label": "informs"
    }
  ]
}
```

Limits: 1,000,000 characters, 500 cards, 1,000 connections; unique IDs containing 1–100 letters/digits/underscores/hyphens. Integer coordinates are within ±100,000, width 100–4,000 and height 60–4,000. Text is at most 20,000 characters; labels/fragments 200. Colors are presets `1`–`6` or `#rrggbb`. File paths use normal vault path validation; optional subpaths start with `#`. Link URLs are HTTP(S), at most 2,048 characters, without embedded credentials. Connections must reference existing nodes; sides are top/right/bottom/left and ends none/arrow (start defaults none, end defaults arrow).

Unsupported fields, including group background images, malformed files and out-of-range geometry are refused without rewriting the original. Download the original to edit it with a compatible tool. This conservative behavior avoids dropping unfamiliar metadata. Graph view remains a separate WebGL visualization of actual note links.
