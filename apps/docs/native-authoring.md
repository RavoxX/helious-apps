# Native authoring and reading

The Phase 9 native source adds daily notes, Markdown templates, typed properties, JSON Canvas and rich reading in Rust/egui on Windows and SwiftUI/AppKit on macOS. It uses the existing vault history, OS-stored sessions and guarded server API. Neither client embeds the website. These controls are included in native 0.9; v0.8.1 predates them.

## Daily notes, templates and properties

Expand **Daily notes & templates** in the note explorer. Select a Space and an optional Markdown note under that Space's `Templates/` folder. **Open daily note** opens `Daily/YYYY-MM-DD.md`, creating it only when absent. Opening an existing daily note preserves its contents; a path in another Space is refused. **Create from template** creates a new path without overwriting an existing note.

Templates substitute `{{title}}`, `{{date}}`, `{{time}}`, `{{datetime}}` and `{{cursor}}` literally, using the local calendar/clock. Unknown variables and secret references remain unresolved. To create a template, save ordinary Markdown under `Templates/`.

Expand **Properties** in a note. **Read current properties** lists its YAML values. Select or enter a key, choose string/number/boolean/JSON/null, then **Apply property to draft** or remove the key. Lists and objects use JSON input. Save explicitly. The shared engine preserves the Markdown body and untouched comments, refuses ambiguous/unsupported YAML, limits frontmatter to 64 KiB and rejects aliases/tags/anchors. An edit finishing after the draft changes cannot replace the newer draft.

## Canvas

Choose **Canvas** in native navigation. Create or open a `.canvas` file; add text, file, HTTP(S) link and group cards. Select cards, edit their content/dimensions, drag them or move them with arrow keys. Add/remove labelled connections, undo/redo, zoom, pan/scroll and export the portable JSON file. File cards open notes only within the board's Space. External links open only after your explicit action.

**Save canvas** uses the original file identity/hash/Space. External edits and deletions fail safely and retain the draft. A server save may rotate the attachment ID; subsequent saves use the returned identity. Discard the draft explicitly before replacing it. Native local history retains board revisions; server attachments retain their latest version. Boards support 500 cards, 1,000 edges, bounded geometry and a one-million-byte JSON limit. Unsupported fields cause a refusal rather than a lossy rewrite. See [Canvas format](./canvas).

## Reading and attachments

Choose **Reading** or **Split**. Native Markdown renders headings, emphasis, tasks, tables, code highlighting, footnotes and collapsible callouts. Note/attachment embeds are on demand and restricted to the saved containing note's Space; embedded notes do not recursively fetch other embeds. Wiki and local Markdown links resolve through the native index. Raw HTML and remote images are not rendered. Secret references stay masked.

Math and Mermaid have **Render preview** controls. Math uses [LaTeX-Rust](https://github.com/jscarr64/LaTeX-Rust) with bundled STIX Two Math; diagrams use [mermaid-rs-renderer](https://github.com/1jehuang/mermaid-rs-renderer). Both produce bounded PNGs locally without JavaScript, a browser process or remote services. Native and browser renderers support different dialect details; unsupported constructs retain their source and show an error. Diagram configuration, HTML, images, click handlers and custom CSS are blocked. Limits: 16,000 source characters, 200 nodes/150 edges, at most 1,600 pixels per rendered side. Formulas are limited to 4,000 bytes and bounded syntax.

Raster images are signature-checked, decoded behind pixel/memory limits and displayed as passive previews. Audio starts only after **Play audio**; pause/resume/stop controls use native playback. PDFs render one page at a time through Windows PDF services or macOS PDFKit thumbnails, with no document scripting or interactive annotations. Encrypted/unsupported PDFs can be downloaded. A maximum of 500 pages applies. This is a visual PDF preview, not a full accessible PDF reader; use the original with your preferred reader for text selection and accessibility tools.

The renderer limits note previews to 250,000 bytes, inline notes to 100,000, and documents to 12 embeds. Clear attachment previews to release their cache. No network access is needed for local folders. Server vaults still require the configured server and existing account/Space permissions. See [browser reading](./reading) for its renderer-specific controls and limits.

[API 1 extensions](./extensions) add explicitly granted data-only editor commands, with preview/apply/save stages and no executable plugin loader.
