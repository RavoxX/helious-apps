import SwiftUI
import AppKit

/// Multi-tab strip, document breadcrumb bar, Markdown formatting bar, and source/reading/split editor.
struct EditorPaneView: View {
    @EnvironmentObject var store: WorkspaceStore

    private var activeSpace: Space? {
        store.spaces.first { $0.id == store.noteSpace }
    }

    private var linkCandidates: [Note] {
        store.notes
            .filter { $0.spaceId == store.noteSpace && $0.id != store.note?.id }
            .prefix(20)
            .map { $0 }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !store.openTabs.isEmpty {
                tabStrip
                Divider()
            }

            if let note = store.note {
                documentHeader(note)
                if store.mode != "Reading" {
                    formattingToolbar
                }
                Divider()
                editorContent
                    .inspector(isPresented: $store.showInspector) {
                        InspectorView()
                            .inspectorColumnWidth(min: 260, ideal: 310, max: 440)
                    }
                    .confirmationDialog("Delete this note?", isPresented: $store.confirmDelete, titleVisibility: .visible) {
                        Button("Delete note", role: .destructive) { store.deleteNote() }
                        Button("Cancel", role: .cancel) {}
                    } message: {
                        Text("Remove \(note.path)? Saved history is retained. A paired vault will sync this deletion.")
                    }
            } else {
                emptyEditorState
            }
        }
    }

    private var tabStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(store.openTabs) { tab in
                    let isActive = store.note?.id == tab.id
                    HStack(spacing: 6) {
                        Button {
                            if !isActive { store.select(tab.id) }
                        } label: {
                            HStack(spacing: 5) {
                                if isActive && store.dirty {
                                    Circle().fill(Color.orange).frame(width: 6, height: 6)
                                }
                                Text(tab.title)
                                    .font(.caption.weight(isActive ? .semibold : .regular))
                                    .lineLimit(1)
                            }
                        }
                        .buttonStyle(.plain)
                        .help(tab.path)

                        Button {
                            store.closeTab(tab.id)
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 9, weight: .semibold))
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                        .help("Close tab \(tab.title)")
                        .accessibilityLabel("Close tab \(tab.title)")
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(
                        RoundedRectangle(cornerRadius: 6)
                            .fill(isActive ? Color.accentColor.opacity(0.15) : Color.primary.opacity(0.04))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .strokeBorder(isActive ? Color.accentColor.opacity(0.55) : Color.primary.opacity(0.08))
                    )
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
        }
    }

    private func documentHeader(_ note: Note) -> some View {
        let folder = (note.path as NSString).deletingLastPathComponent
        let fileTitle = note.title ?? URL(fileURLWithPath: note.path).deletingPathExtension().lastPathComponent
        return HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    if !folder.isEmpty {
                        Text("\(folder) /")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    Text(fileTitle)
                        .font(.title3.weight(.semibold))
                        .lineLimit(1)
                    if let space = activeSpace {
                        Text(space.name)
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2)
                            .background(
                                Capsule().fill(
                                    (space.kind == "personal" ? Color.orange : Color.accentColor).opacity(0.15)
                                )
                            )
                            .foregroundStyle(space.kind == "personal" ? Color.orange : Color.accentColor)
                    }
                }
                HStack(spacing: 6) {
                    Text(note.path).lineLimit(1)
                    Text("·")
                    Text("Rev \(note.revision ?? 1)")
                    Text("·")
                    if store.dirty {
                        Text("Unsaved changes").foregroundStyle(.orange)
                    } else {
                        Text("Saved")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer()
            Button("Move / Rename…") { store.openRename() }
                .controlSize(.small)
                .help("Move or rename note and update inbound wikilinks (⇧⌘R)")
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
    }

    private var formattingToolbar: some View {
        HStack(spacing: 6) {
            Button("B") { appendSnippet("**bold**") }
                .fontWeight(.bold)
                .help("Insert bold Markdown")
            Button("I") { appendSnippet("*italic*") }
                .italic()
                .help("Insert italic Markdown")
            Button("Code") { appendSnippet("`code`") }
                .help("Insert inline code")
            Button("H2") { store.markdown += "\n## Heading\n" }
                .help("Insert section heading")
            Button("Task") { store.markdown += "\n- [ ] " }
                .help("Insert task list item")

            Menu("[[Link]]") {
                if linkCandidates.isEmpty {
                    Text("No other notes in this Space")
                } else {
                    ForEach(linkCandidates) { target in
                        let stem = target.path.hasSuffix(".md")
                            ? String(target.path.dropLast(3))
                            : target.path
                        Button(target.path) {
                            appendSnippet("[[/\(stem)]]")
                        }
                    }
                }
            }
            .fixedSize()
            .help("Insert a Space-scoped wikilink")

            Spacer()
            Text("⌘F for Find & Replace")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .controlSize(.small)
        .padding(.horizontal, 20)
        .padding(.bottom, 8)
    }

    @ViewBuilder private var editorContent: some View {
        if store.mode == "Split" {
            HSplitView {
                sourceEditor
                NativeReadingView()
            }
        } else if store.mode == "Reading" {
            NativeReadingView()
        } else {
            sourceEditor
        }
    }

    private var sourceEditor: some View {
        NativeTextEditor(text: $store.markdown, fontSize: store.fontSize, wrap: store.wrap)
            .padding(10)
            .disabled(store.isSavingNote)
    }

    private var emptyEditorState: some View {
        VStack(spacing: 14) {
            Image(systemName: "doc.text")
                .font(.system(size: 34))
                .foregroundStyle(.secondary)
            Text("Choose or create a note")
                .font(.title3.weight(.semibold))
            Text("Select a file in the explorer tree, press ⌘K to jump anywhere, or open today's daily note.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 420)
            HStack(spacing: 10) {
                Button("Quick Switch (⌘K)") { store.showCommandPalette = true }
                    .buttonStyle(.borderedProminent)
                Button("Today's Daily Note") { store.openTodayDaily() }
                Button("New Note (⌘N)") { store.showNewNote = true }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func appendSnippet(_ token: String) {
        if !store.markdown.isEmpty && !store.markdown.hasSuffix(" ") && !store.markdown.hasSuffix("\n") {
            store.markdown += " "
        }
        store.markdown += token
    }
}
