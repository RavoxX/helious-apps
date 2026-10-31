import SwiftUI
import AppKit

/// Main macOS window: collapsible sidebar of destinations and vaults, split workspace, and rich status bar.
struct WorkspaceView: View {
    @EnvironmentObject var store: WorkspaceStore
    @Environment(\.colorScheme) private var colorScheme
    private let library: [Destination] = [.workspace, .graph, .canvas, .sync]

    var body: some View {
        NavigationSplitView {
            sidebar
        } detail: {
            VStack(spacing: 0) {
                if !store.error.isEmpty { errorBanner }
                switch store.destination ?? .workspace {
                case .workspace:
                    notesWorkspace
                case .canvas:
                    NativeCanvasView(model: store.canvas)
                case .account:
                    AccountView()
                case .settings:
                    SettingsView()
                case .sync:
                    SyncView()
                case .graph:
                    NativeGraphView(data: store.graphData, open: { store.select($0) })
                        .id(store.graphRevision)
                }
                statusBar
            }
            .background(
                colorScheme == .dark
                    ? Color(red: 0.051, green: 0.055, blue: 0.067)
                    : Color(nsColor: .textBackgroundColor)
            )
            .navigationTitle(store.vault?.name ?? "Helious")
            .navigationSubtitle(subtitleText)
        }
        .toolbar { toolbar }
        .onReceive(Timer.publish(every: 3, on: .main, in: .common).autoconnect()) { _ in
            store.poll()
        }
        .onChange(of: store.destination) { _, destination in
            if destination == .graph, store.vault != nil {
                store.send("graph", store.scope("graph"))
            }
            if destination == .sync, !store.user.isEmpty {
                store.api("cloud_vaults", "/api/vaults")
            }
        }
        .alert("Keep your draft", isPresented: $store.showDraftAlert) {
            Button("Save and continue") { store.saveAndContinue() }
            Button("Discard and continue", role: .destructive) { store.discardAndContinue() }
            Button("Keep editing", role: .cancel) { store.deferred = nil }
        } message: {
            Text("This note has unsaved changes. Save it before leaving, or discard the draft.")
        }
        .sheet(isPresented: $store.showNewNote) { newNoteSheet }
        .sheet(isPresented: $store.showRenameSheet) { renameNoteSheet }
        .sheet(isPresented: $store.showCommandPalette) {
            CommandPaletteView().environmentObject(store)
        }
    }

    private var subtitleText: String {
        let page = (store.destination ?? .workspace).rawValue
        guard store.vault != nil else { return page }
        let kind = store.source == "local" ? "Local" : "Cloud"
        return "\(page) · \(kind)"
    }

    private var sidebar: some View {
        List(selection: $store.destination) {
            Section {
                Button {
                    store.showCommandPalette = true
                } label: {
                    HStack {
                        Label("Quick switch", systemImage: "magnifyingglass")
                        Spacer()
                        Text("⌘K").font(.caption2.monospaced()).foregroundStyle(.secondary)
                    }
                }
                .buttonStyle(.plain)
                .help("Jump to any note or run a command (⌘K)")
            }

            Section("Workspace") {
                ForEach(library) { item in
                    Label(item.rawValue, systemImage: item.symbol).tag(item)
                }
            }

            Section("On this Mac") {
                ForEach(store.recent) { item in
                    let isOpen = store.source == "local" && store.vault?.id == item.id
                    Button {
                        store.openRecent(item)
                    } label: {
                        Label(item.name, systemImage: isOpen ? "folder.fill" : "folder")
                            .fontWeight(isOpen ? .semibold : .regular)
                    }
                    .buttonStyle(.plain)
                    .help(item.path ?? item.name)
                }
                Button {
                    store.openFolder()
                } label: {
                    Label("Open folder…", systemImage: "folder.badge.plus")
                }
                .buttonStyle(.plain)
            }

            Section("Helious Cloud") {
                if store.user.isEmpty {
                    Button {
                        store.destination = .account
                    } label: {
                        Label("Sign in to Helious Cloud", systemImage: "person.crop.circle.badge.plus")
                    }
                    .buttonStyle(.plain)
                } else if store.cloudVaults.isEmpty {
                    Text("No Cloud vaults yet").foregroundStyle(.secondary)
                } else {
                    ForEach(store.cloudVaults) { item in
                        let isOpen = store.source == "server" && store.vault?.id == item.id
                        Button {
                            store.openCloud(item)
                        } label: {
                            Label(item.name, systemImage: isOpen ? "cloud.fill" : "cloud")
                                .fontWeight(isOpen ? .semibold : .regular)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .listStyle(.sidebar)
        .navigationSplitViewColumnWidth(min: 205, ideal: 242, max: 320)
        .safeAreaInset(edge: .bottom, spacing: 0) { accountBar }
    }

    private var accountBar: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 8) {
                Button {
                    store.destination = .account
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: store.user.isEmpty ? "person.crop.circle" : "person.crop.circle.fill")
                            .font(.title2)
                            .foregroundStyle(store.user.isEmpty ? Color.secondary : Color.accentColor)
                        VStack(alignment: .leading, spacing: 1) {
                            Text((store.user["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? (store.user.isEmpty ? "Sign in" : "Connected"))
                                .font(.callout.weight(.medium))
                                .lineLimit(1)
                            Text(store.user.isEmpty ? "Local vaults work offline" : (store.user["email"] as? String ?? ""))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Account")

                SettingsLink {
                    Image(systemName: "gearshape")
                }
                .buttonStyle(.borderless)
                .help("Settings (⌘,)")
                .accessibilityLabel("Settings")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
        .background(.bar)
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .navigation) {
            Button("Open folder", systemImage: "folder.badge.plus") { store.openFolder() }
                .help("Open or create a local vault (⇧⌘O)")
            Button("Quick switch", systemImage: "magnifyingglass") { store.showCommandPalette = true }
                .help("Quick Switch & Commands (⌘K)")
        }
        ToolbarItem(placement: .principal) {
            if store.destination == .workspace, store.note != nil {
                Picker("View", selection: $store.mode) {
                    ForEach(["Source", "Reading", "Split"], id: \.self) { Text($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(width: 230)
            }
        }
        ToolbarItemGroup(placement: .primaryAction) {
            Button("Today", systemImage: "calendar") { store.openTodayDaily() }
                .disabled(store.vault == nil)
                .help("Open today's daily note (⌘D)")
            Button("New note", systemImage: "square.and.pencil") { store.showNewNote = true }
                .disabled(store.vault == nil)
                .help("New note (⌘N)")
            if store.destination == .workspace, store.note != nil {
                Button("Rename", systemImage: "pencil") { store.openRename() }
                    .help("Move or rename note and update inbound wikilinks (⇧⌘R)")
                Button("Save", systemImage: "square.and.arrow.down") { store.save() }
                    .disabled(store.isSavingNote || !store.dirty)
                    .help("Save (⌘S)")
                Button("Inspector", systemImage: "sidebar.right") { store.showInspector.toggle() }
                    .help("Toggle Context, Properties, Extensions and History (⌥⌘I)")
            }
        }
    }

    private var errorBanner: some View {
        HStack(alignment: .center, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            Text(store.error).font(.callout).textSelection(.enabled)
            Spacer()
            Button("Dismiss") { store.error = "" }
                .controlSize(.small)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(Color.orange.opacity(0.12))
    }

    private var statusBar: some View {
        let words = store.note != nil ? SecretMasker.liveWordCount(store.markdown) : 0
        let mins = words == 0 ? 0 : (words + 199) / 200
        return VStack(spacing: 0) {
            Divider()
            HStack(spacing: 10) {
                if store.dirty {
                    Text("• Unsaved draft").foregroundStyle(.orange).fontWeight(.medium)
                } else if store.vault == nil {
                    Text("No vault open")
                } else {
                    Text(store.source == "local" ? "On this Mac" : "Cloud workspace")
                }

                if store.vault != nil {
                    Text("·")
                    Text("\(store.notes.count) notes")
                }

                if store.note != nil && store.destination == .workspace {
                    Text("·")
                    Text(mins > 0 ? "\(words) words · ~\(mins) min read" : "0 words")
                }

                Spacer()

                if !store.message.isEmpty {
                    Text(store.message).lineLimit(1)
                }
                if store.source == "local", !store.syncConfig.isEmpty {
                    Label("Paired", systemImage: "checkmark.icloud")
                        .foregroundStyle(.secondary)
                }
                if store.busy {
                    ProgressView().controlSize(.small)
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
        }
    }

    private var newNoteSheet: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("New note").font(.title2.weight(.semibold))
            TextField("Folder/Note.md", text: $store.newPath)
                .textFieldStyle(.roundedBorder)
                .onSubmit { store.createNote() }
            Text("Include `/` to create nested folders automatically. Change the note's Space anytime in the Inspector.")
                .font(.callout)
                .foregroundStyle(.secondary)
            HStack {
                Button("Cancel") { store.showNewNote = false }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button("Create note") { store.createNote() }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                    .disabled(store.newPath.trimmingCharacters(in: .whitespaces).isEmpty || store.busy)
            }
        }
        .padding(24)
        .frame(width: 440)
    }

    private var renameNoteSheet: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Move or rename note").font(.title2.weight(.semibold))
            TextField("Folder/Note.md", text: $store.renamePath)
                .textFieldStyle(.roundedBorder)
                .onSubmit { store.renameNote() }
            Text("Inbound [[wikilinks]] inside the same Space are updated atomically.")
                .font(.callout)
                .foregroundStyle(.secondary)
            HStack {
                Button("Cancel") { store.showRenameSheet = false }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button("Apply rename") { store.renameNote() }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                    .disabled(store.renamePath.trimmingCharacters(in: .whitespaces).isEmpty || store.busy)
            }
        }
        .padding(24)
        .frame(width: 460)
    }

    @ViewBuilder private var notesWorkspace: some View {
        if store.vault == nil {
            WelcomeView()
        } else {
            HSplitView {
                ExplorerView().frame(minWidth: 235, idealWidth: 276, maxWidth: 400)
                EditorPaneView().frame(minWidth: 480)
            }
        }
    }
}

/// First-run screen with local vaults, recent folders, and Helious Cloud sign-in.
struct WelcomeView: View {
    @EnvironmentObject var store: WorkspaceStore

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                VStack(spacing: 8) {
                    Text("A calm home for what you know.")
                        .font(.largeTitle.weight(.semibold))
                    Text("Plain Markdown on disk with version history in .helious. Sign in when you want Cloud vaults or selective Space sync.")
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 560)
                }

                HStack(alignment: .top, spacing: 16) {
                    card(
                        "On this Mac",
                        systemImage: "folder",
                        text: "Open any folder of Markdown files. Works completely offline."
                    ) {
                        Button("Open or create a local vault") { store.openFolder() }
                            .buttonStyle(.borderedProminent)
                    }
                    card(
                        "Helious Cloud",
                        systemImage: "cloud",
                        text: store.user.isEmpty
                            ? "Reach server vaults and sync explicitly selected Spaces."
                            : "Connected as \(store.user["email"] as? String ?? ""). Choose a Cloud vault in the sidebar."
                    ) {
                        if store.user.isEmpty {
                            Button("Sign in to Helious Cloud") { store.destination = .account }
                        }
                    }
                }
                .frame(maxWidth: 660)

                if !store.recent.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Recent local vaults")
                            .font(.headline)
                        ForEach(store.recent.prefix(5)) { item in
                            Button {
                                store.openRecent(item)
                            } label: {
                                HStack {
                                    Label(item.name, systemImage: "folder")
                                        .fontWeight(.medium)
                                    Spacer()
                                    Text(item.path ?? "")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.035)))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .frame(maxWidth: 660, alignment: .leading)
                }
            }
            .padding(44)
            .frame(maxWidth: .infinity)
        }
    }

    private func card<Action: View>(
        _ title: String,
        systemImage: String,
        text: String,
        @ViewBuilder action: () -> Action
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: systemImage).font(.headline)
            Text(text)
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            action()
        }
        .padding(18)
        .frame(maxWidth: .infinity, minHeight: 154, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.primary.opacity(0.04)))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.primary.opacity(0.1)))
    }
}
