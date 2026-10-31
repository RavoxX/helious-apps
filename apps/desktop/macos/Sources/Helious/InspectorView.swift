import SwiftUI

/// 4-tab right Inspector for macOS: Context (Tags, Outline, Backlinks, Outgoing, Mentions),
/// Properties, Extensions, and secret-masked Version History.
struct InspectorView: View {
    @EnvironmentObject var store: WorkspaceStore

    private var liveHeadings: [HeadingOutline] {
        let local = SecretMasker.liveHeadings(store.markdown)
        return local.isEmpty ? store.noteContext.headings : local
    }

    private var liveTags: [String] {
        let combined = Set(SecretMasker.liveTags(store.markdown)).union(store.noteContext.tags)
        return combined.sorted()
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Note Details").font(.subheadline.weight(.semibold))
                    Spacer()
                    if let path = store.note?.path {
                        Text(path)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                Picker("Space", selection: $store.noteSpace) {
                    ForEach(store.spaces) { Text($0.name).tag($0.id) }
                }
                .controlSize(.small)

                HStack(spacing: 8) {
                    Button("Reload") {
                        if store.dirty {
                            store.error = "Save or discard your draft before reloading."
                        } else if let id = store.note?.id {
                            store.read(id)
                        }
                    }
                    Button("Rename…") { store.openRename() }
                    Spacer()
                    Button("Delete…", role: .destructive) { store.confirmDelete = true }
                        .disabled(store.dirty || store.busy)
                }
                .controlSize(.small)
            }
            .padding(14)

            Divider()

            Picker("Inspector section", selection: $store.inspectorTab) {
                ForEach(InspectorTab.allCases) { tab in
                    Text(tab.rawValue).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .onChange(of: store.inspectorTab) { _, tab in
                if tab == .history && store.versions.isEmpty {
                    store.history()
                }
            }

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    switch store.inspectorTab {
                    case .context:
                        contextSection
                    case .properties:
                        PropertiesSectionView()
                    case .extensions:
                        ExtensionCommandsSectionView(model: store.extensions)
                    case .history:
                        historySection
                    }
                }
                .padding(14)
            }
        }
    }

    private var contextSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            if !liveTags.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Tags").font(.subheadline.weight(.semibold))
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(liveTags, id: \.self) { tag in
                                Button("#\(tag)") {
                                    store.searchMode = .fullText
                                    store.search = "tag:\(tag)"
                                    store.runFullTextSearch()
                                }
                                .buttonStyle(.bordered)
                                .controlSize(.small)
                            }
                        }
                    }
                }
                Divider()
            }

            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Outline").font(.subheadline.weight(.semibold))
                    Text("\(liveHeadings.count)").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                }
                if liveHeadings.isEmpty {
                    Text("Add `#` headings to generate a table of contents.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(liveHeadings) { heading in
                        HStack {
                            Text(heading.text)
                                .font(.caption)
                                .lineLimit(1)
                                .padding(.leading, CGFloat(max(0, heading.level - 1)) * 10)
                            Spacer()
                            Text("L\(heading.line)")
                                .font(.caption2.monospacedDigit())
                                .foregroundStyle(.tertiary)
                        }
                        .padding(.vertical, 2)
                    }
                }
            }

            Divider()

            HStack {
                Text("Connected Notes").font(.subheadline.weight(.semibold))
                Spacer()
                Button("Refresh") { store.refreshNoteContext() }
                    .controlSize(.mini)
            }

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text("Backlinks").font(.caption.weight(.semibold))
                    Text("\(store.noteContext.backlinks.count)")
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(Capsule().fill(Color.accentColor.opacity(0.15)))
                }
                if store.noteContext.backlinks.isEmpty {
                    Text("No notes in this Space link here yet.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(store.noteContext.backlinks) { item in
                        Button {
                            store.select(item.id)
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.title ?? item.path ?? "Note")
                                    .font(.caption.weight(.medium))
                                    .foregroundStyle(Color.accentColor)
                                if let snippet = item.snippet, !snippet.isEmpty {
                                    Text(SecretMasker.mask(snippet))
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(2)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text("Outgoing Links").font(.caption.weight(.semibold))
                    Text("\(store.noteContext.outgoing.count)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                if store.noteContext.outgoing.isEmpty {
                    Text("Use `[[Note]]` to connect ideas.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(store.noteContext.outgoing) { item in
                        if item.resolved == true && !item.id.isEmpty {
                            Button(item.title ?? item.path ?? item.target ?? "Note") {
                                store.select(item.id)
                            }
                            .buttonStyle(.link)
                            .font(.caption)
                        } else {
                            HStack(spacing: 6) {
                                Text("[[\(item.target ?? "")]]")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text("unresolved")
                                    .font(.caption2)
                                    .foregroundStyle(.orange)
                            }
                        }
                    }
                }
            }

            if !store.noteContext.unlinkedMentions.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Unlinked Mentions (\(store.noteContext.unlinkedMentions.count))")
                        .font(.caption.weight(.semibold))
                    ForEach(store.noteContext.unlinkedMentions) { item in
                        Button(item.title ?? item.path ?? "Note") {
                            store.select(item.id)
                        }
                        .buttonStyle(.link)
                        .font(.caption)
                    }
                }
            }
        }
    }

    private var historySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Version History").font(.subheadline.weight(.semibold))
                Spacer()
                Button("Reload") { store.history() }
                    .controlSize(.small)
            }
            if store.versions.isEmpty {
                Text("Every save keeps a revision. Select Reload to inspect or restore.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(Array(store.versions.prefix(50).enumerated()), id: \.offset) { _, value in
                    let rev = value["revision"] as? Int ?? 0
                    let action = humanAction(value["action"] as? String ?? "")
                    let stamp = value["recordedAt"] as? String ?? ""
                    Button("Rev \(rev) · \(action) · \(stamp)") {
                        store.history(rev)
                    }
                    .buttonStyle(.link)
                    .font(.caption)
                }
            }
            if !store.historical.isEmpty {
                Divider()
                Text("Historical content (read only)").font(.caption.weight(.semibold))
                ScrollView {
                    Text(SecretMasker.mask(store.historical))
                        .font(.system(.caption, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 200)
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.04)))

                Button("Use as draft") {
                    store.markdown = store.historical
                    store.versions = []
                    store.historical = ""
                    store.message = "Historical revision copied to draft. Save to keep it."
                }
                .controlSize(.small)
            }
        }
    }

    private func humanAction(_ raw: String) -> String {
        switch raw {
        case "local-create", "create": return "Created"
        case "local-edit", "update": return "Saved"
        case "local-move", "move": return "Moved"
        case "local-delete", "delete": return "Deleted"
        case "import": return "Imported"
        case "external-edit": return "External edit"
        case "": return "Revision"
        default: return raw
        }
    }
}
