import SwiftUI
import AppKit
enum Destination: String, CaseIterable, Identifiable {
    case workspace = "Workspace", graph = "Graph", canvas = "Canvas", sync = "Sync", account = "Account", settings = "Settings"
    var id: String { rawValue }
    var symbol: String {switch self {case .workspace: return "doc.text"; case .graph: return "point.3.connected.trianglepath.dotted"; case .canvas: return "square.grid.2x2"; case .sync: return "arrow.triangle.2.circlepath"; case .account: return "person.crop.circle"; case .settings: return "gearshape"}}
}
@MainActor final class WorkspaceStore: ObservableObject {
    let bridge = NativeBridge()
    let updates = UpdateController()
    let cloud = "https://helious.work"
    let dataFolder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("com.helious.desktop", isDirectory: true)
    @Published var destination: Destination? = .workspace
    @Published var recent: [Vault] = []
    @Published var cloudVaults: [Vault] = []
    @Published var spaces: [Space] = []
    @Published var notes: [Note] = []
    @Published var vault: Vault?
    @Published var note: Note?
    @Published var source = "local"
    @Published var markdown = ""
    @Published var saved = ""
    @Published var noteSpace = ""
    @Published var search = ""
    @Published var mode = "Source"
    @Published var user: [String: Any] = [:]
    @Published var origin = "https://helious.work"
    @Published var customServer = false
    @Published var email = ""
    @Published var password = ""
    @Published var factor = ""
    @Published var error = ""
    @Published var message = ""
    @Published var busy = false
    @Published var appearance = "dark"
    @Published var fontSize = 16.0
    @Published var wrap = true
    @Published var showNewNote = false
    @Published var newPath = ""
    @Published var showDraftAlert = false
    @Published var confirmDelete = false
    @Published var graphData: [String: Any] = [:]
    @Published var versions: [[String: Any]] = []
    @Published var historical = ""
    @Published var graphRevision = 0
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
    var dirty: Bool {canvas.dirty || (note != nil && (markdown != saved || noteSpace != note?.spaceId))}
    var colorScheme: ColorScheme? {appearance == "system" ? nil : appearance == "light" ? .light : .dark}
    func start() async {
        do {
            _ = try await bridge.call(["operation": "initialize", "dataDir": dataFolder.path])
            let status = try await bridge.call(["operation": "status"])
            consumeStatus(status)
            updates.store = self
            Task {await updates.start()}
            let settings = status["settings"] as? [String: Any] ?? [:]
            appearance = settings["theme"] as? String ?? "dark"; fontSize = settings["fontSize"] as? Double ?? 16; wrap = settings["wrap"] as? Bool ?? true
            if let server = status["server"] as? String {origin = server; send("me", ["operation": "api", "path": "/api/auth/me"])}
        } catch {self.error = error.localizedDescription}
    }
    func consumeStatus(_ data: [String: Any]) {recent = (try? decode(data["recent"] ?? [], as: [Vault].self)) ?? recent}
    func scope(_ operation: String) -> [String: Any] { ["operation": operation, "source": source, "vaultId": vault?.id ?? ""] }
    func api(_ tag: String, _ path: String, method: String = "GET", body: [String: Any] = [:]) {send(tag, ["operation": "api", "path": path, "method": method, "body": body])}
    func send(_ tag: String, _ request: [String: Any]) {
        guard !busy else {return}; busy = true
        Task {
            do {let data = try await bridge.call(request); busy = false; try handle(tag, data)}
            catch {busy = false; self.error = error.localizedDescription}
        }
    }
    func handle(_ tag: String, _ data: [String: Any]) throws {
        switch tag {
        case "canvas_list": canvas.files = data["files"] as? [[String: Any]] ?? []
        case "canvas_read": try canvas.load(data)
        case "canvas_created": try canvas.load(["file": data["file"] ?? [:], "document": ["nodes": [], "edges": []]]); send("canvas_list", scope("canvas_list"))
        case "canvas_saved": canvas.file = data["file"] as? [String: Any] ?? [:]; canvas.saved = canvasSaving; message = "Canvas saved."; send("canvas_list", scope("canvas_list"))
        case "canvas_deleted": canvas = NativeCanvasStore(); send("canvas_list", scope("canvas_list"))
        case "properties", "edit_property":
            guard propertyBase == markdown else {error = "Your draft changed while editing properties. Read them again before applying changes."; return}
            properties = data["properties"] as? [String: Any] ?? [:]
            if tag == "edit_property" {markdown = data["markdown"] as? String ?? markdown; message = "Properties updated in draft. Save to keep them."}
        case "status":
            consumeStatus(data)
            if source == "local", let id = vault?.id, (data["changedVaults"] as? [String] ?? []).contains(id) {
                if dirty {message = "The folder changed elsewhere. Your draft is preserved."} else {refreshNotes()}
            }
        case "open_local", "open_recent":
            canvas = NativeCanvasStore()
            vault = try decode(data, as: Vault.self); source = "local"; spaces = try decode(data["spaces"] ?? [], as: [Space].self)
            syncConfig = data["sync"] as? [String: Any] ?? [:]; note = nil; markdown = ""; saved = ""; notes = []; destination = .workspace; refreshNotes()
        case "notes":
            notes = try decode(data["notes"] ?? [], as: [Note].self)
            if let id = note?.id, !dirty, destination == .workspace {read(id)}
        case "read_note", "save_note", "create_note":
            note = try decode(data["note"] ?? [:], as: Note.self); markdown = note?.markdown ?? ""; saved = markdown; noteSpace = note?.spaceId ?? ""; versions = []; historical = ""
            if tag != "read_note" {message = "Note saved."; showNewNote = false; newPath = ""; refreshNotes()}
            destination = .workspace
        case "delete_note": note = nil; markdown = ""; saved = ""; refreshNotes()
        case "login", "me":
            user = data["user"] as? [String: Any] ?? [:]; error = ""; message = "Signed in. Choose a Cloud vault from the sidebar."; api("cloud_vaults", "/api/vaults")
        case "cloud_vaults": cloudVaults = try decode(data["vaults"] ?? [], as: [Vault].self)
        case "spaces": spaces = try decode(data["spaces"] ?? [], as: [Space].self); refreshNotes()
        case "remote_spaces": remoteSpaces = try decode(data["spaces"] ?? [], as: [Space].self)
        case "logout":
            user = [:]; cloudVaults = []
            if source == "server" {vault = nil; note = nil; markdown = ""; saved = ""; notes = []}
            message = data["serverRevoked"] as? Bool == true ? "Signed out." : "Signed out on this device. Revoke the old server session when it is available."
        case "graph": graphData = data; graphRevision += 1
        case "history": versions = data["versions"] as? [[String: Any]] ?? []
        case "version": historical = (data["version"] as? [String: Any])?["markdown"] as? String ?? ""
        case "settings": message = "Settings saved."
        case "local_config": syncConfig = data["sync"] as? [String: Any] ?? [:]; message = "Sync pairing saved."
        case "sync", "resolve_sync": syncConfig = data["configuration"] as? [String: Any] ?? data; message = "Sync finished. Review any preserved conflict copies."
        case "create_vault": newPath = ""; api("cloud_vaults", "/api/vaults")
        default: break
        }
    }
    func guardDraft(_ action: @escaping () -> Void) {guard !busy else {error = "Wait for the current operation before changing notes or vaults."; return}; if dirty {deferred = action; showDraftAlert = true} else {action()}}
    func discardAndContinue() {canvas.discard(); markdown = saved; noteSpace = note?.spaceId ?? ""; let action = deferred; deferred = nil; action?()}
    func openFolder() {guardDraft { [weak self] in guard let self else {return}; let panel = NSOpenPanel(); panel.canChooseFiles = false; panel.canChooseDirectories = true; panel.canCreateDirectories = true; panel.title = "Open or create a Helious vault"; if panel.runModal() == .OK, let url = panel.url {self.send("open_local", ["operation": "open_local", "path": url.path])}}}
    func openRecent(_ vault: Vault) {guardDraft { [weak self] in self?.send("open_recent", ["operation": "open_recent", "id": vault.id])}}
    func openCloud(_ value: Vault) {guardDraft { [weak self] in guard let self else {return}; self.canvas = NativeCanvasStore(); self.vault = value; self.source = "server"; self.note = nil; self.markdown = ""; self.saved = ""; self.destination = .workspace; self.api("spaces", "/api/vaults/\(value.id)/spaces")}}
    func refreshNotes() {guard vault != nil else {return}; send("notes", scope("notes"))}
    func read(_ id: String) {var value = scope("read_note"); value["id"] = id; send("read_note", value)}
    func select(_ id: String) {guardDraft { [weak self] in self?.read(id)}}
    func save() {if canvas.dirty {saveCanvas(); return}; guard let note else {return}; var value = scope("save_note"); value["id"] = note.id; value["body"] = ["path": note.path, "markdown": markdown, "spaceId": noteSpace, "revision": note.revision ?? 1, "hash": note.hash ?? ""]; send("save_note", value)}
    func saveCanvas() {guard !canvas.file.isEmpty, !busy else {return}; do {canvasSaving = canvas.document; var req = scope("canvas_save"); req["path"] = canvas.file["path"]; req["spaceId"] = canvas.file["spaceId"]; req["expected"] = canvas.file; req["text"] = String(data: try JSONEncoder().encode(canvasSaving), encoding: .utf8) ?? ""; send("canvas_saved", req)} catch {self.error = error.localizedDescription}}
    func createNote() {guard !dirty else {error = "Save your current draft before creating a note."; return}; var value = scope("create_note"); value["body"] = ["path": newPath.hasSuffix(".md") ? newPath : newPath + ".md", "markdown": "", "spaceId": spaces.first(where: {$0.kind == "personal"})?.id ?? ""]; send("create_note", value)}
    func deleteNote() {guard let note, !dirty else {return}; var value = scope("delete_note"); value["id"] = note.id; value["body"] = ["path": note.path, "hash": note.hash ?? "", "revision": note.revision ?? 1]; send("delete_note", value)}
    func login() {let request: [String: Any] = ["operation": "login", "origin": customServer ? origin : cloud, "email": email, "password": password, "code": factor]; if !customServer {origin = cloud}; send("login", request); password = ""; factor = ""}
    func openWeb(_ path: String) {guard let url = URL(string: origin + path), ["https", "http"].contains(url.scheme ?? ""), url.user == nil, url.password == nil else {return}; NSWorkspace.shared.open(url)}
    func settingsSave() {send("settings", ["operation": "settings", "settings": ["theme": appearance, "fontSize": Int(fontSize), "wrap": wrap]])}
    func history(_ revision: Int? = nil) {guard let note else {return}; var request = scope("history"); request["id"] = note.id; if let revision {request["revision"] = revision}; send(revision == nil ? "history" : "version", request)}
    func poll() {guard !busy else {return}; send("status", ["operation": "status"])}
    var pendingPairing: [String: Any] { ["schema": 1, "serverOrigin": origin, "ownerId": user["id"] as? String ?? "", "vaultId": syncVault, "mappings": mappings, "base": [:], "conflicts": [:], "auto": false] }
    func savePairing() {send("local_config", ["operation": "local_config", "vaultId": vault?.id ?? "", "value": ["sync": pendingPairing], "confirmPersonal": personalConfirmed])}
}
