import SwiftUI
import AppKit
struct WorkspaceView: View {
    @EnvironmentObject var store: WorkspaceStore
    var body: some View {
        NavigationSplitView {
            List(selection: $store.destination) {
                Section {ForEach(Destination.allCases) {item in Label(item.rawValue, systemImage: item.symbol).tag(item)}}
                Section("Local vaults") {
                    Button("Open folder…", systemImage: "folder.badge.plus") {store.openFolder()}
                    ForEach(store.recent) {vault in Button(vault.name, systemImage: "folder") {store.openRecent(vault)}.help(vault.path ?? vault.name)}
                }
                Section("Cloud vaults") {
                    if store.user.isEmpty {Button("Sign in to Helious Cloud") {store.destination = .account}}
                    ForEach(store.cloudVaults) {vault in Button(vault.name, systemImage: "cloud") {store.openCloud(vault)}}
                }
            }.listStyle(.sidebar).navigationTitle("Helious").navigationSplitViewColumnWidth(min: 190, ideal: 230, max: 300)
        } detail: {
            VStack(spacing: 0) {
                if !store.error.isEmpty {
                    HStack(alignment: .top) {Image(systemName: "exclamationmark.triangle").foregroundStyle(.orange); Text(store.error).textSelection(.enabled); Spacer(); Button("Dismiss") {store.error = ""}}.padding(14).background(.quaternary)
                }
                switch store.destination ?? .workspace {
                case .workspace: notesWorkspace
                case .account: AccountView()
                case .settings: SettingsView()
                case .sync: SyncView()
                case .graph: NativeGraphView(data: store.graphData, open: {store.select($0)}).id(store.graphRevision)
                }
                Divider()
                HStack {Text(store.dirty ? "Unsaved draft" : store.source == "local" ? "On this Mac" : "Cloud workspace"); Spacer(); if !store.message.isEmpty {Text(store.message).lineLimit(2)}; if store.busy {ProgressView().controlSize(.small)}}.font(.caption).foregroundStyle(.secondary).padding(.horizontal, 14).padding(.vertical, 8)
            }.background(store.appearance == "dark" ? Color(red: 0.055, green: 0.055, blue: 0.055) : Color(nsColor: .textBackgroundColor))
        }
        .toolbar {
            ToolbarItem {Button("Open folder", systemImage: "folder.badge.plus") {store.openFolder()}}
            ToolbarItem {Button("New note", systemImage: "square.and.pencil") {store.showNewNote = true}.disabled(store.vault == nil)}
            ToolbarItem(placement: .principal) {Text(store.vault?.name ?? "Your knowledge workspace").font(.headline)}
            ToolbarItem {Button(store.user["name"] as? String ?? "Sign in", systemImage: "person.crop.circle") {store.destination = .account}}
            ToolbarItem {SettingsLink {Label("Settings", systemImage: "gearshape")}}
        }
        .onReceive(Timer.publish(every: 3, on: .main, in: .common).autoconnect()) {_ in store.poll()}
        .onChange(of: store.destination) {_, destination in
            if destination == .graph, store.vault != nil {store.send("graph", store.scope("graph"))}
            if destination == .sync, !store.user.isEmpty {store.api("cloud_vaults", "/api/vaults")}
        }
        .alert("Keep your draft", isPresented: $store.showDraftAlert) {
            Button("Keep editing", role: .cancel) {store.deferred = nil}
            Button("Discard and continue", role: .destructive) {store.discardAndContinue()}
        } message: {Text("This note has unsaved changes. Save it before leaving, or discard the draft.")}
        .sheet(isPresented: $store.showNewNote) {
            VStack(alignment: .leading, spacing: 18) {
                Text("Create a note").font(.title2)
                TextField("Folder/Note.md", text: $store.newPath).textFieldStyle(.roundedBorder)
                Text("New notes start in Personal. Choose another Space after creating the note.").font(.callout).foregroundStyle(.secondary)
                HStack {Button("Cancel") {store.showNewNote = false}; Spacer(); Button("Create note") {store.createNote()}.buttonStyle(.borderedProminent).disabled(store.newPath.trimmingCharacters(in: .whitespaces).isEmpty || store.busy)}
            }.padding(26).frame(width: 440)
        }
    }
    @ViewBuilder var notesWorkspace: some View {
        if store.vault == nil {
            ContentUnavailableView {Label("A home for what you know.", systemImage: "books.vertical")} description: {Text("Open a Markdown folder, or sign in to access your Cloud vaults.")} actions: {
                Button("Open or create a local vault") {store.openFolder()}.buttonStyle(.borderedProminent)
                Button("Sign in to Helious Cloud") {store.destination = .account}
            }
        } else {
            HSplitView {
                VStack(spacing: 0) {
                    TextField("Search notes…", text: $store.search).textFieldStyle(.roundedBorder).padding(12)
                    List {
                        ForEach(store.notes.filter {store.search.isEmpty || $0.path.localizedCaseInsensitiveContains(store.search) || ($0.title ?? "").localizedCaseInsensitiveContains(store.search)}) {note in
                            Button {store.select(note.id)} label: {HStack {Image(systemName: "doc.text").foregroundStyle(.secondary); VStack(alignment: .leading, spacing: 3) {Text(note.title ?? URL(fileURLWithPath: note.path).lastPathComponent).lineLimit(1); Text(note.path).font(.caption).foregroundStyle(.secondary).lineLimit(1)}; Spacer()}.padding(.vertical, 4)}.buttonStyle(.plain).listRowBackground(store.note?.id == note.id ? Color.accentColor.opacity(0.14) : Color.clear)
                        }
                    }.listStyle(.inset)
                }.frame(minWidth: 200, idealWidth: 250, maxWidth: 360)
                NoteEditorView().frame(minWidth: 460)
            }
        }
    }
}
struct NoteEditorView: View {
    @EnvironmentObject var store: WorkspaceStore
    var body: some View {
        if let note = store.note {
            VStack(alignment: .leading, spacing: 0) {
                HStack {Text(note.path).font(.headline).lineLimit(1); if store.dirty {Circle().fill(Color.orange).frame(width: 6, height: 6)}; Spacer(); Button("History", systemImage: "clock.arrow.circlepath") {store.history()}; Button("Save") {store.save()}.buttonStyle(.borderedProminent).disabled(store.busy)}.padding(16)
                HStack {Picker("View", selection: $store.mode) {ForEach(["Source", "Reading", "Split"], id: \.self) {Text($0)}}.pickerStyle(.segmented).frame(maxWidth: 280); Spacer(); Picker("Space", selection: $store.noteSpace) {ForEach(store.spaces) {Text($0.name).tag($0.id)}}.frame(maxWidth: 220); Button("Delete", systemImage: "trash", role: .destructive) {store.confirmDelete = true}.disabled(store.dirty || store.busy)}.padding(.horizontal, 16).padding(.bottom, 12)
                if !store.versions.isEmpty {DisclosureGroup("Version history") {
                    ScrollView {VStack(alignment: .leading) {ForEach(Array(store.versions.enumerated()), id: \.offset) {_, value in Button("Revision \(value["revision"] as? Int ?? 0) · \(value["recordedAt"] as? String ?? "")") {store.history(value["revision"] as? Int)}}}.frame(maxWidth: .infinity, alignment: .leading)}.frame(maxHeight: 140)
                    if !store.historical.isEmpty {ScrollView {Text(store.historical).font(.system(.body, design: .monospaced)).textSelection(.enabled)}.frame(maxHeight: 160); Button("Use as draft") {store.markdown = store.historical; store.versions = []; store.historical = ""}}
                }.padding(16)}
                Divider()
                if store.mode == "Split" {HSplitView {source; preview}} else if store.mode == "Reading" {preview} else {source}
            }
            .confirmationDialog("Delete this note?", isPresented: $store.confirmDelete, titleVisibility: .visible) {
                Button("Delete note", role: .destructive) {store.deleteNote()}
                Button("Cancel", role: .cancel) {}
            } message: {Text("Remove \(note.path)? Saved history is retained. A paired vault will sync this deletion.")}
        } else {ContentUnavailableView("Start with a note.", systemImage: "doc.text", description: Text("Choose a file from the explorer, or create one."))}
    }
    var source: some View {NativeTextEditor(text: $store.markdown, fontSize: store.fontSize, wrap: store.wrap).padding(12).disabled(store.busy)}
    var preview: some View {ScrollView {VStack(alignment: .leading, spacing: 10) {ForEach(Array(store.markdown.replacingOccurrences(of: "\\{\\{secret:[^}\\n]+\\}\\}", with: "[secret reference]", options: .regularExpression).components(separatedBy: "\n").enumerated()), id: \.offset) {_, line in
        if line.hasPrefix("# ") {Text(String(line.dropFirst(2))).font(.title.bold())} else if line.hasPrefix("## ") {Text(String(line.dropFirst(3))).font(.title2.bold())} else {Text((try? AttributedString(markdown: line)) ?? AttributedString(line)).textSelection(.enabled)}
    }}.frame(maxWidth: 760, alignment: .leading).padding(28).frame(maxWidth: .infinity, alignment: .center)}}
}
