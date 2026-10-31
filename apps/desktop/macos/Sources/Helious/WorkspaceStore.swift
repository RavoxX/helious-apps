import SwiftUI
import AppKit

@MainActor final class WorkspaceStore: ObservableObject {
    let extensions = NativeExtensions()
    let bridge = NativeBridge()
    let updates = UpdateController()
    let cloud = "https://helious.work"
    let dataFolder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("com.helious.desktop", isDirectory: true)

    @Published var destination: Destination? = .workspace
    @Published var recent: [Vault] = []
    @Published var cloudVaults: [Vault] = []
    @Published var spaces: [Space] = []
    @Published var notes: [Note] = []
    @Published var vault: Vault?
    @Published var note: Note?
    @Published var openTabs: [OpenNoteTab] = []

    @Published var source = "local"
    @Published var markdown = ""
    @Published var saved = ""
    @Published var noteSpace = ""
    @Published var mode = "Source"

    // Explorer & full-text search
    @Published var search = ""
    @Published var spaceFilter = ""
    @Published var searchMode: ExplorerSearchMode = .filter
    @Published var searchResults: [SearchHit] = []
    @Published var isSearching = false

    // Inspector & Context
    @Published var showInspector = true
    @Published var inspectorTab: InspectorTab = .context
    @Published var noteContext: NoteContextSummary = .empty

    // Dialogs & Quick Switcher
    @Published var showNewNote = false
    @Published var newPath = ""
    @Published var showRenameSheet = false
    @Published var renamePath = ""
    @Published var showCommandPalette = false
    @Published var showDraftAlert = false
    @Published var confirmDelete = false

    // Account & Preferences
    @Published var user: [String: Any] = [:]
    @Published var origin = "https://helious.work"
    @Published var customServer = false
    @Published var email = ""
    @Published var password = ""
    @Published var factor = ""
    @Published var appearance = "dark"
    @Published var fontSize = 16.0
    @Published var wrap = true

    // Status & Foreground/Background Operations
    @Published var error = ""
    @Published var message = ""
    @Published var busy = false
    @Published var activeTag = ""
    var isPolling = false
    private var queued: [(String, [String: Any])] = []

    // Graph, History, Sync, Properties, Canvas
    @Published var graphData: [String: Any] = [:]
    @Published var graphRevision = 0
    @Published var versions: [[String: Any]] = []
    @Published var historical = ""
    @Published var syncConfig: [String: Any] = [:]
    @Published var syncVault = ""
    @Published var remoteSpaces: [Space] = []
    @Published var mappings: [String: String] = [:]
    @Published var personalConfirmed = false
    @Published var properties: [String: Any] = [:]
    var propertyBase = ""
    @Published var canvas = NativeCanvasStore()
    var canvasSaving = BoardDocument()

    var deferred: (() -> Void)?
    var afterSaveAction: (() -> Void)?

    var dirty: Bool {
        canvas.dirty || (note != nil && (markdown != saved || noteSpace != (note?.spaceId ?? "")))
    }

    var isSavingNote: Bool {
        busy && (activeTag == "save_note" || activeTag == "rename_note")
    }

    var colorScheme: ColorScheme? {
        appearance == "system" ? nil : appearance == "light" ? .light : .dark
    }

    func start() async {
        do {
            _ = try await bridge.call(["operation": "initialize", "dataDir": dataFolder.path])
            let status = try await bridge.call(["operation": "status"])
            consumeStatus(status)
            updates.store = self
            Task { await updates.start() }
            let settings = status["settings"] as? [String: Any] ?? [:]
            appearance = settings["theme"] as? String ?? "dark"
            fontSize = settings["fontSize"] as? Double ?? 16
            wrap = settings["wrap"] as? Bool ?? true
            if let server = status["server"] as? String {
                origin = server
                send("me", ["operation": "api", "path": "/api/auth/me"])
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func consumeStatus(_ data: [String: Any]) {
        recent = (try? decode(data["recent"] ?? [], as: [Vault].self)) ?? recent
    }

    func scope(_ operation: String) -> [String: Any] {
        ["operation": operation, "source": source, "vaultId": vault?.id ?? ""]
    }

    func api(_ tag: String, _ path: String, method: String = "GET", body: [String: Any] = [:]) {
        send(tag, ["operation": "api", "path": path, "method": method, "body": body])
    }

    /// Foreground request dispatcher with a bounded FIFO queue so saves and selections are never dropped.
    func send(_ tag: String, _ request: [String: Any]) {
        if busy {
            if queued.count < 16 {
                queued.append((tag, request))
            }
            return
        }
        busy = true
        activeTag = tag
        Task {
            do {
                let data = try await bridge.call(request)
                busy = false
                activeTag = ""
                try handle(tag, data)
            } catch {
                busy = false
                activeTag = ""
                afterSaveAction = nil
                if tag == "search_notes" { isSearching = false }
                self.error = error.localizedDescription
            }
            drainQueue()
        }
    }

    /// Non-blocking background call for periodic folder checks and backlink context refreshes.
    func sendBackground(_ tag: String, _ request: [String: Any]) {
        if tag == "status_poll" {
            guard !isPolling, !busy else { return }
            isPolling = true
        }
        Task {
            defer {
                if tag == "status_poll" { isPolling = false }
            }
            guard let data = try? await bridge.call(request) else { return }
            try? handle(tag, data)
        }
    }

    private func drainQueue() {
        guard !busy, !queued.isEmpty else { return }
        let (tag, request) = queued.removeFirst()
        send(tag, request)
    }

    func handle(_ tag: String, _ data: [String: Any]) throws {
        switch tag {
        case "canvas_list":
            canvas.files = data["files"] as? [[String: Any]] ?? []
        case "canvas_read":
            try canvas.load(data)
        case "canvas_created":
            try canvas.load(["file": data["file"] ?? [:], "document": ["nodes": [], "edges": []]])
            send("canvas_list", scope("canvas_list"))
        case "canvas_saved":
            canvas.file = data["file"] as? [String: Any] ?? [:]
            canvas.saved = canvasSaving
            message = "Canvas saved."
            send("canvas_list", scope("canvas_list"))
            runPostSaveIfNeeded()
        case "canvas_deleted":
            canvas = NativeCanvasStore()
            send("canvas_list", scope("canvas_list"))
        case "properties", "edit_property":
            guard propertyBase == markdown else {
                error = "Your draft changed while editing properties. Read them again before applying changes."
                return
            }
            properties = data["properties"] as? [String: Any] ?? [:]
            if tag == "edit_property" {
                markdown = data["markdown"] as? String ?? markdown
                message = "Properties updated in draft. Save to keep them."
            }
        case "status", "status_poll":
            consumeStatus(data)
            if source == "local", let id = vault?.id, (data["changedVaults"] as? [String] ?? []).contains(id) {
                if dirty {
                    message = "The folder changed elsewhere. Your draft is preserved."
                } else {
                    refreshNotes()
                }
            }
        case "open_local", "open_recent":
            resetVaultWorkspace()
            vault = try decode(data, as: Vault.self)
            source = "local"
            spaces = try decode(data["spaces"] ?? [], as: [Space].self)
            syncConfig = data["sync"] as? [String: Any] ?? [:]
            destination = .workspace
            refreshNotes()
        case "notes":
            notes = try decode(data["notes"] ?? [], as: [Note].self)
            if let id = note?.id, !dirty, destination == .workspace {
                read(id)
            }
        case "read_note", "save_note", "create_note", "rename_note":
            let loaded = try decode(data["note"] ?? [:], as: Note.self)
            note = loaded
            markdown = loaded.markdown ?? ""
            saved = markdown
            noteSpace = loaded.spaceId ?? ""
            versions = []
            historical = ""
            syncTab(for: loaded)
            refreshNoteContext(background: true)
            if tag == "rename_note" {
                let updated = data["updatedLinks"] as? Int ?? 0
                message = updated > 0
                    ? "Moved to \(loaded.path) (\(updated) inbound links updated)."
                    : "Moved to \(loaded.path)."
                showRenameSheet = false
                refreshNotes()
            } else if tag != "read_note" {
                message = "Note saved."
                showNewNote = false
                newPath = ""
                refreshNotes()
                if tag == "save_note" { runPostSaveIfNeeded() }
            }
            destination = .workspace
        case "search_notes":
            isSearching = false
            searchResults = (try? decode(data["results"] ?? [], as: [SearchHit].self)) ?? []
        case "note_context", "bg_note_context":
            noteContext = (try? decode(data, as: NoteContextSummary.self)) ?? .empty
        case "delete_note":
            if let deletedId = note?.id {
                openTabs.removeAll { $0.id == deletedId }
            }
            note = nil
            markdown = ""
            saved = ""
            noteContext = .empty
            refreshNotes()
        case "login", "me":
            user = data["user"] as? [String: Any] ?? [:]
            error = ""
            message = "Signed in. Choose a Cloud vault from the sidebar."
            api("cloud_vaults", "/api/vaults")
        case "cloud_vaults":
            cloudVaults = try decode(data["vaults"] ?? [], as: [Vault].self)
        case "spaces":
            spaces = try decode(data["spaces"] ?? [], as: [Space].self)
            refreshNotes()
        case "remote_spaces":
            remoteSpaces = try decode(data["spaces"] ?? [], as: [Space].self)
        case "logout":
            user = [:]
            cloudVaults = []
            if source == "server" {
                vault = nil
                resetVaultWorkspace()
            }
            message = data["serverRevoked"] as? Bool == true
                ? "Signed out."
                : "Signed out on this device. Revoke the old server session when it is available."
        case "graph":
            graphData = data
            graphRevision += 1
        case "history":
            versions = data["versions"] as? [[String: Any]] ?? []
        case "version":
            let raw = (data["version"] as? [String: Any])?["markdown"] as? String ?? ""
            historical = raw
        case "settings":
            message = "Settings saved."
        case "local_config":
            syncConfig = data["sync"] as? [String: Any] ?? [:]
            message = "Sync pairing saved."
        case "sync", "resolve_sync":
            syncConfig = data["configuration"] as? [String: Any] ?? data
            message = "Sync finished. Review any preserved conflict copies."
        case "create_vault":
            newPath = ""
            api("cloud_vaults", "/api/vaults")
        default:
            break
        }
    }

    private func resetVaultWorkspace() {
        canvas = NativeCanvasStore()
        openTabs = []
        notes = []
        note = nil
        markdown = ""
        saved = ""
        noteSpace = ""
        search = ""
        spaceFilter = ""
        searchResults = []
        noteContext = .empty
        versions = []
        historical = ""
    }

    private func syncTab(for item: Note) {
        let filename = URL(fileURLWithPath: item.path).lastPathComponent
        if let index = openTabs.firstIndex(where: { $0.id == item.id }) {
            openTabs[index].path = item.path
            openTabs[index].title = filename
        } else {
            if openTabs.count >= 12 { openTabs.removeFirst() }
            openTabs.append(OpenNoteTab(id: item.id, path: item.path, title: filename))
        }
    }

    func closeTab(_ id: String) {
        let isActive = note?.id == id
        if isActive && dirty {
            error = "Save or discard your draft before closing this tab."
            return
        }
        let prevIndex = openTabs.firstIndex(where: { $0.id == id })
        openTabs.removeAll { $0.id == id }
        if isActive {
            if let idx = prevIndex, !openTabs.isEmpty {
                let next = openTabs[max(0, min(idx - 1, openTabs.count - 1))]
                select(next.id)
            } else {
                note = nil
                markdown = ""
                saved = ""
                noteContext = .empty
            }
        }
    }

    private func runPostSaveIfNeeded() {
        guard let next = afterSaveAction else { return }
        afterSaveAction = nil
        next()
    }

    func guardDraft(_ action: @escaping () -> Void) {
        if dirty {
            deferred = action
            showDraftAlert = true
        } else {
            action()
        }
    }

    func saveAndContinue() {
        let next = deferred
        deferred = nil
        afterSaveAction = next
        save()
    }

    func discardAndContinue() {
        canvas.discard()
        markdown = saved
        noteSpace = note?.spaceId ?? ""
        let action = deferred
        deferred = nil
        action?()
    }

    func openFolder() {
        guardDraft { [weak self] in
            guard let self else { return }
            let panel = NSOpenPanel()
            panel.canChooseFiles = false
            panel.canChooseDirectories = true
            panel.canCreateDirectories = true
            panel.title = "Open or create a Helious vault"
            if panel.runModal() == .OK, let url = panel.url {
                self.send("open_local", ["operation": "open_local", "path": url.path])
            }
        }
    }

    func openRecent(_ vault: Vault) {
        guardDraft { [weak self] in
            self?.send("open_recent", ["operation": "open_recent", "id": vault.id])
        }
    }

    func openCloud(_ value: Vault) {
        guardDraft { [weak self] in
            guard let self else { return }
            self.resetVaultWorkspace()
            self.vault = value
            self.source = "server"
            self.destination = .workspace
            self.api("spaces", "/api/vaults/\(value.id)/spaces")
        }
    }

    func refreshNotes() {
        guard vault != nil else { return }
        send("notes", scope("notes"))
    }

    func read(_ id: String) {
        var value = scope("read_note")
        value["id"] = id
        send("read_note", value)
    }

    func select(_ id: String) {
        guard !id.isEmpty else { return }
        guardDraft { [weak self] in self?.read(id) }
    }

    func save() {
        if canvas.dirty {
            saveCanvas()
            return
        }
        guard let note else { return }
        var value = scope("save_note")
        value["id"] = note.id
        value["body"] = [
            "path": note.path,
            "markdown": markdown,
            "spaceId": noteSpace,
            "revision": note.revision ?? 1,
            "hash": note.hash ?? ""
        ]
        send("save_note", value)
    }

    func openRename() {
        guard let note else { return }
        renamePath = note.path
        showRenameSheet = true
    }

    func renameNote() {
        guard let note else { return }
        let trimmed = renamePath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let target = trimmed.lowercased().hasSuffix(".md") ? trimmed : "\(trimmed).md"
        var req = scope("rename_note")
        req["id"] = note.id
        req["path"] = target
        req["markdown"] = markdown
        req["spaceId"] = noteSpace
        req["hash"] = note.hash ?? ""
        req["revision"] = note.revision ?? 1
        send("rename_note", req)
    }

    func runFullTextSearch() {
        guard vault != nil else { return }
        let trimmed = search.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            searchResults = []
            return
        }
        isSearching = true
        var req = scope("search_notes")
        req["query"] = trimmed
        if !spaceFilter.isEmpty { req["spaceId"] = spaceFilter }
        req["limit"] = 60
        send("search_notes", req)
    }

    func refreshNoteContext(background: Bool = false) {
        guard vault != nil, let note else { return }
        var req = scope("note_context")
        req["id"] = note.id
        req["markdown"] = markdown
        if background {
            sendBackground("bg_note_context", req)
        } else {
            send("note_context", req)
        }
    }

    func openTodayDaily() {
        guard vault != nil else { return }
        guardDraft { [weak self] in
            guard let self else { return }
            let formatter = DateFormatter()
            formatter.dateFormat = "yyyy-MM-dd"
            formatter.locale = Locale(identifier: "en_US_POSIX")
            let targetSpace = !self.spaceFilter.isEmpty
                ? self.spaceFilter
                : (self.spaces.first(where: { $0.kind == "personal" })?.id ?? self.spaces.first?.id ?? "")
            var req = self.scope("open_daily")
            req["day"] = formatter.string(from: Date())
            req["spaceId"] = targetSpace
            req["templateId"] = ""
            self.send("create_note", req)
        }
    }

    func saveCanvas() {
        guard !canvas.file.isEmpty else { return }
        do {
            canvasSaving = canvas.document
            var req = scope("canvas_save")
            req["path"] = canvas.file["path"]
            req["spaceId"] = canvas.file["spaceId"]
            req["expected"] = canvas.file
            req["text"] = String(data: try JSONEncoder().encode(canvasSaving), encoding: .utf8) ?? ""
            send("canvas_saved", req)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func createNote() {
        guard !dirty else {
            error = "Save your current draft before creating a note."
            return
        }
        let trimmed = newPath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let targetSpace = !spaceFilter.isEmpty
            ? spaceFilter
            : (spaces.first(where: { $0.kind == "personal" })?.id ?? spaces.first?.id ?? "")
        var value = scope("create_note")
        value["body"] = [
            "path": trimmed.lowercased().hasSuffix(".md") ? trimmed : "\(trimmed).md",
            "markdown": "",
            "spaceId": targetSpace
        ]
        send("create_note", value)
    }

    func deleteNote() {
        guard let note, !dirty else { return }
        var value = scope("delete_note")
        value["id"] = note.id
        value["body"] = ["path": note.path, "hash": note.hash ?? "", "revision": note.revision ?? 1]
        send("delete_note", value)
    }

    func login() {
        let request: [String: Any] = [
            "operation": "login",
            "origin": customServer ? origin : cloud,
            "email": email,
            "password": password,
            "code": factor
        ]
        if !customServer { origin = cloud }
        send("login", request)
        password = ""
        factor = ""
    }

    func openWeb(_ path: String) {
        guard let url = URL(string: origin + path),
              ["https", "http"].contains(url.scheme ?? ""),
              url.user == nil,
              url.password == nil else { return }
        NSWorkspace.shared.open(url)
    }

    func settingsSave() {
        send("settings", [
            "operation": "settings",
            "settings": [
                "theme": appearance,
                "fontSize": Int(fontSize),
                "wrap": wrap,
                "automaticChecks": updates.automaticChecks,
                "automaticInstall": updates.automaticDownloads
            ]
        ])
    }

    func history(_ revision: Int? = nil) {
        guard let note else { return }
        var request = scope("history")
        request["id"] = note.id
        if let revision { request["revision"] = revision }
        send(revision == nil ? "history" : "version", request)
    }

    func poll() {
        sendBackground("status_poll", ["operation": "status"])
    }

    var pendingPairing: [String: Any] {
        [
            "schema": 1,
            "serverOrigin": origin,
            "ownerId": user["id"] as? String ?? "",
            "vaultId": syncVault,
            "mappings": mappings,
            "base": [:],
            "conflicts": [:],
            "auto": false
        ]
    }

    func savePairing() {
        send("local_config", [
            "operation": "local_config",
            "vaultId": vault?.id ?? "",
            "value": ["sync": pendingPairing],
            "confirmPersonal": personalConfirmed
        ])
    }
}
