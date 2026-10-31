import SwiftUI

/// Hierarchical collapsible folder tree, Space filter, and full-text search pane for macOS.
struct ExplorerView: View {
    @EnvironmentObject var store: WorkspaceStore

    private var activeSpaceName: String {
        guard !store.spaceFilter.isEmpty else { return "All Spaces" }
        return store.spaces.first(where: { $0.id == store.spaceFilter })?.name ?? "All Spaces"
    }

    private var filteredNotes: [Note] {
        let query = store.search.trimmingCharacters(in: .whitespacesAndNewlines)
        return store.notes.filter { item in
            let matchesSpace = store.spaceFilter.isEmpty || item.spaceId == store.spaceFilter
            let matchesQuery = query.isEmpty
                || item.path.localizedCaseInsensitiveContains(query)
                || (item.title ?? "").localizedCaseInsensitiveContains(query)
            return matchesSpace && matchesQuery
        }
    }

    private var treeRoot: FolderTreeNode {
        FolderTreeNode.build(from: filteredNotes)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Text("Notes").font(.headline)
                Text("\(store.notes.count)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer()
                Menu {
                    Button("All Spaces") { store.spaceFilter = "" }
                    Divider()
                    ForEach(store.spaces) { space in
                        Button(space.name) { store.spaceFilter = space.id }
                    }
                } label: {
                    Text(activeSpaceName)
                        .font(.caption)
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
                .help("Filter explorer by Space")

                Button {
                    store.showNewNote = true
                } label: {
                    Image(systemName: "plus")
                }
                .buttonStyle(.borderless)
                .help("New note (⌘N)")
                .accessibilityLabel("New note")
            }
            .padding(.horizontal, 12)
            .padding(.top, 12)
            .padding(.bottom, 8)

            Picker("Search mode", selection: $store.searchMode) {
                ForEach(ExplorerSearchMode.allCases) { mode in
                    Text(mode.rawValue).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(.horizontal, 12)
            .padding(.bottom, 6)
            .onChange(of: store.searchMode) { _, mode in
                if mode == .fullText && !store.search.trimmingCharacters(in: .whitespaces).isEmpty {
                    store.runFullTextSearch()
                }
            }

            HStack(spacing: 6) {
                TextField(
                    store.searchMode == .filter
                        ? "Filter by name or path…"
                        : "Search text, tag:name, path:Folder…",
                    text: $store.search
                )
                .textFieldStyle(.roundedBorder)
                .onSubmit {
                    if store.searchMode == .fullText {
                        store.runFullTextSearch()
                    }
                }

                if store.searchMode == .fullText {
                    Button("Search") {
                        store.runFullTextSearch()
                    }
                    .controlSize(.small)
                    .disabled(store.search.trimmingCharacters(in: .whitespaces).isEmpty || store.isSearching)
                }
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 6)

            AuthoringView()
            Divider()

            if store.searchMode == .fullText && !store.search.trimmingCharacters(in: .whitespaces).isEmpty {
                searchResultsList
            } else {
                folderTreeList
            }
        }
    }

    private var searchResultsList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 6) {
                if store.isSearching {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text("Searching vault…").font(.caption).foregroundStyle(.secondary)
                    }
                    .padding(12)
                } else if store.searchResults.isEmpty {
                    ContentUnavailableView(
                        "No matching notes",
                        systemImage: "magnifyingglass",
                        description: Text("Try tag:name, path:Folder, or another phrase.")
                    )
                    .padding(.top, 24)
                } else {
                    Text("\(store.searchResults.count) matching notes")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 4)

                    ForEach(store.searchResults) { hit in
                        let isSelected = store.note?.id == hit.id
                        Button {
                            store.select(hit.id)
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text((hit.title?.isEmpty == false ? hit.title! : hit.path))
                                    .font(.callout.weight(.semibold))
                                    .lineLimit(1)
                                Text(hit.path)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                                if let snippet = hit.snippet, !snippet.isEmpty {
                                    Text(SecretMasker.mask(snippet))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(2)
                                }
                            }
                            .padding(8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(
                                RoundedRectangle(cornerRadius: 7)
                                    .fill(isSelected ? Color.accentColor.opacity(0.16) : Color.primary.opacity(0.035))
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 7)
                                    .strokeBorder(isSelected ? Color.accentColor.opacity(0.6) : Color.primary.opacity(0.08))
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(10)
        }
    }

    private var folderTreeList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 2) {
                if store.notes.isEmpty {
                    ContentUnavailableView(
                        "No notes yet",
                        systemImage: "doc.badge.plus",
                        description: Text("Create one with + or ⌘N.")
                    )
                    .padding(.top, 28)
                } else if filteredNotes.isEmpty {
                    ContentUnavailableView(
                        "No matches",
                        systemImage: "magnifyingglass",
                        description: Text("Try another filter or Space.")
                    )
                    .padding(.top, 28)
                } else {
                    FolderBranchView(node: treeRoot, depth: 0)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
        }
    }
}

private struct FolderBranchView: View {
    @EnvironmentObject var store: WorkspaceStore
    let node: FolderTreeNode
    let depth: Int

    var body: some View {
        ForEach(node.children) { folder in
            FolderDisclosureRow(folder: folder, depth: depth)
        }
        ForEach(node.notes) { item in
            NoteTreeRow(note: item, depth: depth)
        }
    }
}

private struct FolderDisclosureRow: View {
    let folder: FolderTreeNode
    let depth: Int
    @State private var isExpanded = true

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            FolderBranchView(node: folder, depth: depth + 1)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: isExpanded ? "folder.fill" : "folder")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(folder.name)
                    .font(.callout.weight(.medium))
                    .lineLimit(1)
                Spacer(minLength: 4)
                Text("\(folder.totalNotes)")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            .padding(.vertical, 2)
        }
        .padding(.leading, CGFloat(depth) * 10)
    }
}

private struct NoteTreeRow: View {
    @EnvironmentObject var store: WorkspaceStore
    let note: Note
    let depth: Int

    private var isSelected: Bool {
        store.note?.id == note.id
    }

    private var displayName: String {
        URL(fileURLWithPath: note.path).deletingPathExtension().lastPathComponent
    }

    var body: some View {
        Button {
            store.select(note.id)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "doc.text")
                    .font(.caption)
                    .foregroundStyle(isSelected ? Color.accentColor : Color.secondary)
                Text(displayName)
                    .font(.callout)
                    .fontWeight(isSelected ? .semibold : .regular)
                    .lineLimit(1)
                Spacer(minLength: 4)
            }
            .padding(.leading, CGFloat(depth) * 10 + 8)
            .padding(.trailing, 8)
            .padding(.vertical, 5)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(isSelected ? Color.accentColor.opacity(0.16) : Color.clear)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(note.path)
        .contextMenu {
            Button("Open Note") { store.select(note.id) }
            if isSelected {
                Button("Move or Rename…") { store.openRename() }
                Divider()
                Button("Delete Note…", role: .destructive) { store.confirmDelete = true }
                    .disabled(store.dirty)
            }
        }
    }
}
