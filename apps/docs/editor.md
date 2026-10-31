# The Markdown workspace

The Phase 3 workspace is available in **Vaults**: CodeMirror 6, a folder explorer, independent note panes, reading views, connections and configurable keyboard commands.

## Finding your way around

Signing in opens **Vaults**, or returns you to a workspace address you opened while signed out. The left sidebar is the map of your workspace:

- **Home** (`/app/home`) shows what needs attention (pending secret requests, low recovery codes), your vaults, AI connections, two-step verification and signed-in sessions, plus a short setup checklist until it is complete.
- **AI connections** (`/app/ai-connections`) manages agent tokens and OAuth tools.
- **Vaults** lists every vault. Choose one to open it at `/app/vaults/<id>`; **+** (Add a vault) opens the create form.
- **Settings** (`/app/settings`) groups **Account**, **Security & access** (`/app/settings/security`) and **Sessions** (`/app/settings/sessions`) as tabs. A badge shows pending approvals.
- **Help & docs** opens this guide, and **Collapse** shrinks the sidebar to icons. Your choice is remembered in this browser.

Every page has its own address, so the browser's back and forward buttons, bookmarks and "open in new tab" work. Signing in happens at `/login` (create an account at `/register` when registration is open). If you open a workspace address while signed out, you return to it after signing in. Older `/app/?mode=login` links still work. Phones show Home, Vaults, AI connections and Settings in a bottom tab bar.

Inside a vault, the top row holds **Explorer** (the note list), the **Current vault** and **Space** selectors and **Commands** (Ctrl/⌘+P). Below it, one row of tools opens panels in place: **Vault settings** (rename or delete), **Spaces & permissions**, **Daily notes & templates**, **Deleted notes**, **Hotkeys**, **Reading appearance** and **New vault**. Only one panel is open at a time; Escape from inside the panel closes it and returns focus to its button. Use **Notes** to write, **Graph** to explore connections, **Analytics** for writing activity and **Canvas** for boards with cards and connections. **Properties** edits typed YAML inside a note. See [authoring tools](./authoring) and [Canvas](./canvas) for storage, draft and compatibility limits.

The profile button in the top right (your first name) opens the account menu: account settings, active sessions, the workspace guide and sign out. It supports Tab/Enter, Escape and click-outside dismissal, including on phones. The moon/sun button beside it switches light and dark appearance. **Account settings** manages your verified email and appearance; the password reset link sends an email through the existing recovery flow. Account settings and vault settings apply to different things.

## Writing and reading

- **Source** provides Markdown syntax highlighting, line numbers, undo/redo, selection matching and editor search.
- **Live preview** shows editable source and a rendered preview together. Narrow screens stack the panels.
- **Reading** shows rendered CommonMark/GFM, callouts, highlighted code, KaTeX math, scoped note/media embeds and on-demand Mermaid diagrams. Raw HTML is skipped. See [reading and media](./reading) for syntax, supported formats and limits.
- The formatting toolbar inserts bold, italic, wiki links and tasks at the selection.
- Type `[[` for note-path completion. Click wiki or local Markdown links in the preview to open a matching note. Saved outgoing links and backlinks use the server's resolver. Use full paths for ambiguous names.
- Click an outline item to focus its line in source mode.

Use **Save note** or **Ctrl/Cmd+S**. Edits are not automatically saved. Revision conflict checks still protect against overwriting another browser's work. **Discard edits and reload** replaces your draft with the current server version.

## Tabs and drafts

Opening notes adds tabs. Switching tabs retains their unsaved drafts. Pin tabs to keep them at the front. Closing a dirty tab asks whether to keep editing or discard its draft. Arrow keys, Home and End navigate the tab strip.

Choose **Split** to display another open note beside the first one. Click or focus a pane to target keyboard commands at that note. Each pane keeps its own content, editor view and draft. Opening another note replaces the focused pane; its previous tab remains available. **Unsplit** returns to the primary pane. On phones, panes stack vertically.

Tab IDs, pane assignments, active tab and pins are saved in browser storage per account/vault. Unsaved content stays in memory, including when switching account-panel sections; it is **not** persisted across browser reloads or crashes. A page-leave warning protects outstanding drafts. Save before leaving. A restored tab fetches its current server content.

## Finding notes

The explorer groups notes by folder and loads metadata in pages, up to 10,000 notes. Expand/collapse folders and select a file. **Explorer** hides the sidebar for more writing space and opens it again on desktop or mobile. Search returns up to 100 matches; refine your query when it reaches that limit.

**Ctrl/Cmd+P** opens the command palette. **Ctrl/Cmd+O** opens the quick switcher. Both search paths in the explorer's full metadata index, even while the sidebar is hidden or a vault search is active. Commands create notes, save the focused pane, switch editor views or toggle the split. Use Tab and Enter to select, and Escape to close. The visible **Commands** button works on touch screens.

## Move, rename and bookmark

Use the pencil beside a file to enter a new relative path, or edit **Note path** and save. Desktop users can drag notes onto a folder or the **Vault root** drop target. Use the path form on touch devices or with a keyboard. Empty folders are implicit and disappear when their last note moves.

Moves update affected wiki and Markdown link destinations in the same database transaction. Aliases, fragments, link titles and code remain intact. Relative links in the moved note keep their previous targets, including attachment paths. A wiki link may become explicit, for example `[[/Archive/Decision.md#Storage|our decision]]`, to preserve its meaning. Name collisions and stale revisions cancel the entire operation. Moves currently support vaults with up to 10,000 notes and 16 MiB of Markdown.

Save a note's draft before moving it in the explorer. Clean open notes refresh after linked references change. A dirty draft stays visible and reports a server change; copy the parts you need, then reload before saving. Every successful edit and coordinated move retains attributed revisions. Use [Version history](./history) for comparisons and restoration; [back up](./deployment) before large reorganizations.

Star a file to add it to **Bookmarks**. Bookmarks use note IDs, so they follow renames. They are saved per account in this browser and displayed for the selected vault. Click the star again to remove one.

## Connections and outline

Below each note are its tags, reading time, outline, outgoing links and backlinks. Unresolved links are labelled. **Unlinked mentions** lists other notes whose extracted text contains this note's title, or filename without `.md` when there is no title. Matching is case-insensitive, includes code text, excludes already linked notes and is capped at 100 results. It is a suggestion list; it does not automatically insert links.

## Customize shortcuts

Open **Hotkeys** in the vault toolbar, edit a combination, then **Save hotkeys**. `Mod` means Ctrl on Windows and Cmd on macOS. Optional `Alt` and `Shift` modifiers precede one letter or digit. Duplicate combinations and common browser navigation keys are rejected. Restore defaults fills the form; save to apply it. Preferences stay with this account in this browser.

| Action                | Default       |
| --------------------- | ------------- |
| Save focused note     | `Mod+S`       |
| Command palette       | `Mod+P`       |
| Quick switcher        | `Mod+O`       |
| Focus new note        | `Mod+Shift+K` |
| Toggle source/reading | `Mod+E`       |
| Toggle split pane     | `Mod+Shift+E` |

The editor and reading renderer load separately from the account screen. Both themes and mobile layouts share the existing Helious tokens. No remote fonts or third-party scripts are loaded.

## Graph and analytics

Choose **Graph** or **Analytics** beside Notes to inspect the current vault. **View local graph** under a note's Connections opens the graph centered on that note. Drafts stay mounted while switching these vault views; Save explicitly before a browser reload. The graph's note actions and analytics ranking return to the editor. See the [graph guide](./graph) and [analytics guide](./analytics).

## Spaces and recovery

The **Space** selector filters notes, attachments, graph and analytics. New content uses that space, or Personal when viewing All spaces. Change **Note space** in the editor and save to reassign a note. **Spaces & permissions** manages custom spaces and agent policy eligibility; actual MCP connections are configured under AI connections in the sidebar. **Version history** reviews saved snapshots, and **Deleted notes** recovers soft-deleted content. See [Spaces](./spaces) and [History](./history) for exact permission and retention rules.
