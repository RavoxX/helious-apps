import SwiftUI

/// `⌘K` Quick Switcher & Command Palette sheet for macOS.
struct CommandPaletteView: View {
    @EnvironmentObject var store: WorkspaceStore
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @FocusState private var isFocused: Bool

    private struct Entry: Identifiable {
        let id: String
        let title: String
        let subtitle: String
        let symbol: String
        let badge: String
        let action: () -> Void
    }

    private var entries: [Entry] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let commandOnly = trimmed.hasPrefix(">")
        let needle = trimmed.trimmingCharacters(in: CharacterSet(charactersIn: "> ")).lowercased()
        var items: [Entry] = []

        if !commandOnly {
            for note in store.notes {
                let title = note.title ?? URL(fileURLWithPath: note.path).deletingPathExtension().lastPathComponent
                if needle.isEmpty
                    || title.lowercased().contains(needle)
                    || note.path.lowercased().contains(needle) {
                    items.append(
                        Entry(
                            id: "note-\(note.id)",
                            title: title,
                            subtitle: note.path,
                            symbol: "doc.text",
                            badge: "Note",
                            action: { store.select(note.id) }
                        )
                    )
                }
                if items.count >= 25 { break }
            }
        }

        let commands: [(String, String, String, String, () -> Void)] = [
            ("Open Today's Daily Note", "Create or open today's note in Daily/", "calendar", "⌘D", { store.openTodayDaily() }),
            ("New Note…", "Create a new Markdown note", "square.and.pencil", "⌘N", { store.showNewNote = true }),
            ("Move or Rename Active Note…", "Rename note and update inbound wikilinks", "pencil", "⇧⌘R", { store.openRename() }),
            ("Open Local Vault Folder…", "Pick or create a Markdown folder on this Mac", "folder.badge.plus", "⇧⌘O", { store.openFolder() }),
            ("Switch Appearance (Dark / Light)", "Toggle near-black dark mode and crisp light mode", "circle.lefthalf.filled", "Theme", {
                store.appearance = store.appearance == "light" ? "dark" : "light"
                store.settingsSave()
            }),
            ("Toggle Right Inspector", "Show or hide Context, Properties, Extensions and History", "sidebar.right", "⌥⌘I", {
                store.showInspector.toggle()
            }),
            ("Editor: Source Mode", "Focus on raw Markdown editing", "chevron.left.forwardslash.chevron.right", "View", {
                store.destination = .workspace
                store.mode = "Source"
            }),
            ("Editor: Reading Mode", "Read rendered Markdown, diagrams and formulas", "book", "View", {
                store.destination = .workspace
                store.mode = "Reading"
            }),
            ("Editor: Split Mode", "Side-by-side Markdown source and live reading view", "rectangle.split.2x1", "View", {
                store.destination = .workspace
                store.mode = "Split"
            }),
            ("Go to Knowledge Graph", "Explore real note connections", "point.3.connected.trianglepath.dotted", "⌘2", {
                store.destination = .graph
            }),
            ("Go to Canvas Boards", "Open portable JSON Canvas boards", "square.grid.2x2", "⌘3", {
                store.destination = .canvas
            })
        ]

        for (index, cmd) in commands.enumerated() {
            if needle.isEmpty
                || cmd.0.lowercased().contains(needle)
                || cmd.1.lowercased().contains(needle) {
                items.append(
                    Entry(
                        id: "cmd-\(index)",
                        title: cmd.0,
                        subtitle: cmd.1,
                        symbol: cmd.2,
                        badge: cmd.3,
                        action: cmd.4
                    )
                )
            }
        }
        return items
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Jump to a note, path, or type > for commands…", text: $query)
                    .textFieldStyle(.plain)
                    .font(.title3)
                    .focused($isFocused)
                    .onSubmit {
                        if let first = entries.first {
                            run(first)
                        }
                    }
                Button("Esc") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                    .controlSize(.small)
            }
            .padding(16)

            Divider()

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 4) {
                    if entries.isEmpty {
                        Text("No matching notes or commands.")
                            .foregroundStyle(.secondary)
                            .padding(20)
                    } else {
                        ForEach(Array(entries.enumerated()), id: \.element.id) { index, item in
                            Button {
                                run(item)
                            } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: item.symbol)
                                        .frame(width: 20)
                                        .foregroundStyle(index == 0 ? Color.accentColor : Color.secondary)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(item.title)
                                            .font(.callout.weight(index == 0 ? .semibold : .regular))
                                            .lineLimit(1)
                                        Text(item.subtitle)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .lineLimit(1)
                                    }
                                    Spacer()
                                    Text(item.badge)
                                        .font(.caption2.monospaced())
                                        .foregroundStyle(.secondary)
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .background(RoundedRectangle(cornerRadius: 4).fill(Color.primary.opacity(0.06)))
                                }
                                .padding(.horizontal, 10)
                                .padding(.vertical, 7)
                                .background(
                                    RoundedRectangle(cornerRadius: 7)
                                        .fill(index == 0 ? Color.accentColor.opacity(0.14) : Color.clear)
                                )
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(10)
            }
        }
        .frame(width: 560, height: 420)
        .onAppear { isFocused = true }
    }

    private func run(_ item: Entry) {
        dismiss()
        item.action()
    }
}
