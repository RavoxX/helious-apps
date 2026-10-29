# Explore your knowledge graph

Open a vault and choose **Graph**. This is a working WebGL view of your own saved notes and links. The homepage graph remains a separate sample illustration.

## Navigate

- Click a note node to open it in the Markdown workspace. Opening a graph or returning to your notes preserves unsaved tab drafts in memory.
- Drag the background to pan. Scroll to zoom; on a touch screen, drag to pan and pinch to zoom. The camera buttons provide zoom in, zoom out and reset.
- Drag a node to reposition it. Its position stays in the current graph view; this does not change Markdown or save a permanent manual layout.
- Hover a node to highlight its neighbors and dim unrelated nodes. Labels appear on hover and zoom; sparse graphs show more labels automatically.
- **Note navigator** provides a searchable list and Focus/Open buttons for keyboard users and browsers without WebGL. It shows up to 40 matching visible nodes; narrow its search to reach others.

The canvas stays graphite in both app themes so fine edges and group colors remain readable. Node sizes reflect distinct incoming and outgoing neighbors and adapt to graph density. Link thickness also reflects repeated references.

## Global and local views

**Global graph** shows the permitted contents of the vault and the selected Space. **Local graph** follows connections in both directions from a selected center note, with depth from 1 to 5. You can also choose **View local graph** under a note's Connections panel. Change the center and depth under **Controls → Filters**.

Local traversal respects the current filters: it does not cross a filtered-out node to reach another note. A center excluded by a filter produces an empty view; clear the filter or choose another center.

## Filters and groups

The filter field searches titles and paths, with the same `tag:`, `-tag:`, `path:` and `file:` operators as [vault search](./knowledge#search-syntax). This graph filter does not search full note bodies. Quoted phrases and literal terms work; regex and `line:` are not supported.

- **Attachments** adds ready GridFS files and their links. Click an attachment to inspect it, then use its download action. Inline viewers remain later work.
- **Orphan notes** includes nodes with no incoming or outgoing graph connections.
- **Existing files only** hides unresolved target nodes. Disable it to see missing or ambiguous destinations. Those nodes can be inspected but cannot be opened as saved notes.

Colors can follow folders, the first tag or a single color. Add up to 12 custom query/color groups; the first matching group wins. For example, `tag:research` can color a research cluster, and `path:Projects/Helious` can color one project.

Browser vaults are owner-only. Space filters and current policies apply to graph and analytics queries on the server. Scoped MCP agents use the same policy checks, including Personal isolation. The note sidebar previews actual nearby connections and opens the interactive local graph.

## Display and forces

**Display** controls node size, link thickness, direction arrows and label threshold. Lower the label threshold to show more text. Sparse graphs cap the threshold to keep their few notes readable.

**Forces** controls center pull, repulsion, link strength and link distance. Changes recompute the layout in a background worker. **Pause graph layout** freezes it; Resume restarts it with the current forces. Reset restores the defaults. Groups, grouping, display and forces are saved per account/vault in this browser. Filters, local scope, timeline and manual positions are temporary.

## Creation timeline

The timeline reveals the current graph by each file's creation timestamp in UTC, including notes created on the same day. Drag the slider or press Play; **Show all** restores the complete view. Large graphs replay in short batches. Playback pauses when the page is hidden. Files with identical creation timestamps appear together; a graph with only one unique timestamp has no playback to run.

This is a replay of today's surviving files by their original creation dates. It does not reconstruct deleted notes or historical versions of their contents and links. [Version history](./history) is available separately.

## Performance and accessibility

Sigma 3 and Graphology render nodes and edges with WebGL. D3 computes forces in a module worker, leaving the UI thread available for camera movement and controls. Layout work settles or stops after a bounded run; Resume or changing a force restarts it. Labels are culled at distant zoom levels, and dense graphs use smaller dots. Background tabs pause layout work.

Reduced-motion mode computes a static layout and applies its result without a continuous force animation; camera transitions are immediate. The controls, list navigator and note editor remain available. If WebGL cannot start, enable browser hardware acceleration or use the navigator.

Current request limits are 50,000 total nodes (notes, ready attachments and unresolved targets), 200,000 local link occurrences, and 64 MiB of projected graph metadata. Requests exceeding a limit return 422, never a silently truncated graph. Browser responsiveness is covered with a 12,000-node fixture; actual frame rates depend on the GPU, browser and graph density. Coordinated note moves retain their separate 10,000-note/16 MiB planning limit.

## Space filtering

Use the **Space** selector above the vault views. The server removes unauthorized nodes, edges, backlinks and outgoing metadata, recomputing degree counts. Hidden notes do not become labelled missing nodes. Local traversal only sees that response. Resolution of hidden deleted paths also uses retained note metadata, under the same 50,000-record/200,000-link/64 MiB safety bounds. See [Spaces](./spaces).
