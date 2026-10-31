import SwiftUI
import AppKit

/// Main window: a sidebar of destinations, vaults and the account, then the chosen destination.
struct WorkspaceView: View {
    @EnvironmentObject var store: WorkspaceStore
    private let library: [Destination] = [.workspace, .graph, .canvas, .sync]
    var body: some View {
        NavigationSplitView {
            sidebar
        } detail: {
            VStack(spacing: 0) {
                if !store.error.isEmpty {errorBanner}
                switch store.destination ?? .workspace {
                case .workspace: notesWorkspace
                case .canvas: NativeCanvasView(model: store.canvas)
                case .account: AccountView()
                case .settings: SettingsView()
                case .sync: SyncView()
                case .graph: NativeGraphView(data: store.graphData, open: {store.select($0)}).id(store.graphRevision)
                }
                statusBar
            }
            .background(store.appearance == "dark" ? Color(red: 0.055, green: 0.055, blue: 0.055) : Color(nsColor: .textBackgroundColor))
            .navigationTitle(store.vault?.name ?? "Helious")
            .navigationSubtitle((store.destination ?? .workspace).rawValue)
        }
        .toolbar {toolbar}
        .onReceive(Timer.publish(every: 3, on: .main, in: .common).autoconnect()) {_ in store.poll()}
        .onChange(of: store.destination) {_, destination in
            if destination == .graph, store.vault != nil {store.send("graph", store.scope("graph"))}
            if destination == .sync, !store.user.isEmpty {store.api("cloud_vaults", "/api/vaults")}
        }
        .alert("Keep your draft", isPresented: $store.showDraftAlert) {
            Button("Keep editing", role: .cancel) {store.deferred = nil}
            Button("Discard and continue", role: .destructive) {store.discardAndContinue()}
        } message: {Text("This note has unsaved changes. Save it before leaving, or discard the draft.")}
        .sheet(isPresented: $store.showNewNote) {newNoteSheet}
    }

    private var sidebar: some View {
        List(selection: $store.destination) {
            Section {
                ForEach(library) {item in Label(item.rawValue, systemImage: item.symbol).tag(item)}
            }
            Section("On this Mac") {
                ForEach(store.recent) {vault in
                    let open = store.source == "local" && store.vault?.id == vault.id
                    Button {store.openRecent(vault)} label: {
                        Label(vault.name, systemImage: open ? "folder.fill" : "folder")
                            .fontWeight(open ? .semibold : .regular)
                    }
                    .buttonStyle(.plain)
                    .help(vault.path ?? vault.name)
                }
                Button {store.openFolder()} label: {Label("Open folder…", systemImage: "folder.badge.plus")}
                    .buttonStyle(.plain)
            }
            Section("Helious Cloud") {
                if store.user.isEmpty {
                    Button {store.destination = .account} label: {
                        Label("Sign in to Helious Cloud", systemImage: "person.crop.circle.badge.plus")
                    }.buttonStyle(.plain)
                } else if store.cloudVaults.isEmpty {
                    Text("No Cloud vaults yet").foregroundStyle(.secondary)
                } else {
                    ForEach(store.cloudVaults) {vault in
                        let open = store.source == "server" && store.vault?.id == vault.id
                        Button {store.openCloud(vault)} label: {
                            Label(vault.name, systemImage: open ? "cloud.fill" : "cloud")
                                .fontWeight(open ? .semibold : .regular)
                        }.buttonStyle(.plain)
                    }
                }
            }
        }
        .listStyle(.sidebar)
        .navigationSplitViewColumnWidth(min: 200, ideal: 240, max: 320)
        .safeAreaInset(edge: .bottom, spacing: 0) {accountBar}
    }

    /// Sign-in state stays visible from every destination; settings sit beside it.
    private var accountBar: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 8) {
                Button {store.destination = .account} label: {
                    HStack(spacing: 8) {
                        Image(systemName: "person.crop.circle.fill").font(.title2).foregroundStyle(.secondary)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(store.user["name"] as? String ?? "Sign in").font(.callout.weight(.medium)).lineLimit(1)
                            Text(store.user.isEmpty ? "Local vaults work offline" : (store.user["email"] as? String ?? ""))
                                .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }.contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Account")
                SettingsLink {Image(systemName: "gearshape")}
                    .buttonStyle(.borderless)
                    .help("Settings (⌘,)")
                    .accessibilityLabel("Settings")
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
        }
        .background(.bar)
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .navigation) {
            Button("Open folder", systemImage: "folder.badge.plus") {store.openFolder()}
                .help("Open or create a local vault (⇧⌘O)")
        }
        ToolbarItem(placement: .principal) {
            if store.destination == .workspace, store.note != nil {
                Picker("View", selection: $store.mode) {
                    ForEach(["Source", "Reading", "Split"], id: \.self) {Text($0)}
                }
                .pickerStyle(.segmented).labelsHidden().frame(width: 230)
            }
        }
        ToolbarItemGroup(placement: .primaryAction) {
            Button("New note", systemImage: "square.and.pencil") {store.showNewNote = true}
                .disabled(store.vault == nil).help("New note (⌘N)")
            if store.destination == .workspace, store.note != nil {
                Button("Save", systemImage: "square.and.arrow.down") {store.save()}
                    .disabled(store.busy || !store.dirty).help("Save (⌘S)")
                Button("Inspector", systemImage: "sidebar.right") {store.showInspector.toggle()}
                    .help("Show Space, properties, extensions and version history")
            }
        }
    }

    private var errorBanner: some View {
        HStack(alignment: .top) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            Text(store.error).textSelection(.enabled)
            Spacer()
            Button("Dismiss") {store.error = ""}
        }
        .padding(12).background(Color.orange.opacity(0.12))
    }

    private var statusBar: some View {
        VStack(spacing: 0) {
            Divider()
            HStack {
                Text(store.dirty ? "Unsaved draft" : store.vault == nil ? "No vault open" : store.source == "local" ? "On this Mac" : "Cloud workspace")
                Spacer()
                if !store.message.isEmpty {Text(store.message).lineLimit(1)}
                if store.busy {ProgressView().controlSize(.small)}
            }
            .font(.caption).foregroundStyle(.secondary).padding(.horizontal, 14).padding(.vertical, 6)
        }
    }

    private var newNoteSheet: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("New note").font(.title2.weight(.semibold))
            TextField("Folder/Note.md", text: $store.newPath).textFieldStyle(.roundedBorder)
            Text("New notes start in Personal. Choose another Space in the inspector after creating the note.")
                .font(.callout).foregroundStyle(.secondary)
            HStack {
                Button("Cancel") {store.showNewNote = false}.keyboardShortcut(.cancelAction)
                Spacer()
                Button("Create note") {store.createNote()}
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(store.newPath.trimmingCharacters(in: .whitespaces).isEmpty || store.busy)
            }
        }
        .padding(24).frame(width: 440)
    }

    @ViewBuilder private var notesWorkspace: some View {
        if store.vault == nil {
            WelcomeView()
        } else {
            HSplitView {
                NotesList().frame(minWidth: 220, idealWidth: 260, maxWidth: 380)
                NoteEditorView().frame(minWidth: 460)
            }
        }
    }
}

/// First-run screen with the two ways in: a local folder or Helious Cloud.
struct WelcomeView: View {
    @EnvironmentObject var store: WorkspaceStore
    var body: some View {
        VStack(spacing: 24) {
            VStack(spacing: 8) {
                Text("A home for what you know.").font(.largeTitle.weight(.semibold))
                Text("Open a Markdown folder to start. Signing in adds your Cloud vaults; local vaults always work offline.")
                    .foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            HStack(alignment: .top, spacing: 16) {
                card("On this Mac", systemImage: "folder", text: "Plain Markdown files with history in a .helious folder.") {
                    Button("Open or create a local vault") {store.openFolder()}.buttonStyle(.borderedProminent)
                }
                card("Helious Cloud", systemImage: "cloud", text: store.user.isEmpty ? "Sync chosen Spaces and reach your vaults anywhere." : "Choose a Cloud vault in the sidebar to open it.") {
                    if store.user.isEmpty {Button("Sign in to Helious Cloud") {store.destination = .account}}
                }
            }
            .frame(maxWidth: 640)
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    private func card<Action: View>(_ title: String, systemImage: String, text: String, @ViewBuilder action: () -> Action) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: systemImage).font(.headline)
            Text(text).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            action()
        }
        .padding(18)
        .frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.primary.opacity(0.04)))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.primary.opacity(0.1)))
    }
}

/// Notes grouped by folder, with native list selection.
struct NotesList: View {
    @EnvironmentObject var store: WorkspaceStore
    struct Folder: Identifiable {let id: String; let notes: [Note]}
    private var filtered: [Note] {
        store.notes.filter {store.search.isEmpty || $0.path.localizedCaseInsensitiveContains(store.search) || ($0.title ?? "").localizedCaseInsensitiveContains(store.search)}
    }
    private var folders: [Folder] {
        let groups = Dictionary(grouping: filtered) {note -> String in
            let parent = (note.path as NSString).deletingLastPathComponent
            return parent.isEmpty ? "Vault root" : parent
        }
        let names = groups.keys.sorted {left, right in
            if left == "Vault root" {return true}
            if right == "Vault root" {return false}
            return left.localizedStandardCompare(right) == .orderedAscending
        }
        return names.map {name in
            Folder(id: name, notes: (groups[name] ?? []).sorted {$0.path.localizedStandardCompare($1.path) == .orderedAscending})
        }
    }
    private var selection: Binding<String?> {
        Binding(get: {store.note?.id}, set: {id in if let id, id != store.note?.id {store.select(id)}})
    }
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Notes").font(.headline)
                Text("\(store.notes.count)").foregroundStyle(.secondary)
                Spacer()
                Button {store.showNewNote = true} label: {Image(systemName: "plus")}
                    .buttonStyle(.borderless).help("New note (⌘N)").accessibilityLabel("New note")
            }
            .padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 6)
            TextField("Search notes", text: $store.search)
                .textFieldStyle(.roundedBorder).padding(.horizontal, 12).padding(.bottom, 6)
            AuthoringView()
            List(selection: selection) {
                ForEach(folders) {folder in
                    Section(folder.id) {
                        ForEach(folder.notes) {note in
                            Label {
                                Text(note.title ?? URL(fileURLWithPath: note.path).lastPathComponent).lineLimit(1)
                            } icon: {
                                Image(systemName: "doc.text")
                            }
                            .tag(note.id)
                            .help(note.path)
                        }
                    }
                }
            }
            .listStyle(.inset)
            .overlay {
                if filtered.isEmpty {
                    ContentUnavailableView(
                        store.notes.isEmpty ? "No notes yet" : "No matches",
                        systemImage: store.notes.isEmpty ? "doc.badge.plus" : "magnifyingglass",
                        description: Text(store.notes.isEmpty ? "Create one with + or ⌘N." : "Try another search."))
                }
            }
        }
    }
}

struct NoteEditorView: View {
    @EnvironmentObject var store: WorkspaceStore
    var body: some View {
        if let note = store.note {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(note.title ?? URL(fileURLWithPath: note.path).deletingPathExtension().lastPathComponent)
                        .font(.title2.weight(.semibold)).lineLimit(1)
                    HStack(spacing: 6) {
                        Text(note.path).lineLimit(1)
                        Text("·")
                        if store.dirty {Text("Unsaved changes").foregroundStyle(.orange)} else {Text("Saved")}
                    }
                    .font(.caption).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 20).padding(.vertical, 14)
                Divider()
                if store.mode == "Split" {HSplitView {source; preview}} else if store.mode == "Reading" {preview} else {source}
            }
            .inspector(isPresented: $store.showInspector) {
                NoteInspector().inspectorColumnWidth(min: 240, ideal: 290, max: 420)
            }
            .confirmationDialog("Delete this note?", isPresented: $store.confirmDelete, titleVisibility: .visible) {
                Button("Delete note", role: .destructive) {store.deleteNote()}
                Button("Cancel", role: .cancel) {}
            } message: {Text("Remove \(note.path)? Saved history is retained. A paired vault will sync this deletion.")}
        } else {
            ContentUnavailableView("Choose a note", systemImage: "doc.text", description: Text("Pick a file in the list, or create one with ⌘N."))
        }
    }
    var source: some View {NativeTextEditor(text: $store.markdown, fontSize: store.fontSize, wrap: store.wrap).padding(12).disabled(store.busy)}
    var preview: some View {NativeReadingView()}
}

/// Secondary note controls, kept out of the writing area.
struct NoteInspector: View {
    @EnvironmentObject var store: WorkspaceStore
    var body: some View {
        Form {
            Section("Note") {
                Picker("Space", selection: $store.noteSpace) {
                    ForEach(store.spaces) {Text($0.name).tag($0.id)}
                }
                Button("Load version history", systemImage: "clock.arrow.circlepath") {store.history()}
                Button("Delete note…", systemImage: "trash", role: .destructive) {store.confirmDelete = true}
                    .disabled(store.dirty || store.busy)
            }
            Section {PropertiesView()}
            Section {ExtensionCommands(model: store.extensions)}
            if !store.versions.isEmpty {
                Section("Version history") {
                    ForEach(Array(store.versions.enumerated()), id: \.offset) {_, value in
                        Button("Revision \(value["revision"] as? Int ?? 0) · \(value["recordedAt"] as? String ?? "")") {
                            store.history(value["revision"] as? Int)
                        }
                        .buttonStyle(.link)
                    }
                    if !store.historical.isEmpty {
                        ScrollView {
                            Text(store.historical).font(.system(.body, design: .monospaced)).textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .frame(maxHeight: 180)
                        Button("Use as draft") {store.markdown = store.historical; store.versions = []; store.historical = ""}
                    }
                }
            }
        }
        .formStyle(.grouped)
    }
}
