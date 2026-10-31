import SwiftUI
import AppKit

struct BoardCard: Codable, Identifiable, Equatable {
    var id: String; var type: String; var x: Int; var y: Int; var width: Int; var height: Int
    var text: String?; var file: String?; var subpath: String?; var url: String?; var label: String?; var color: String?
    var content: String { text ?? file ?? url ?? label ?? "" }
}

struct BoardEdge: Codable, Identifiable, Equatable {
    var id: String; var fromNode: String; var toNode: String
    var fromSide: String?; var toSide: String?; var label: String?; var color: String?; var fromEnd: String?; var toEnd: String?
}

struct BoardDocument: Codable, Equatable {
    var nodes: [BoardCard] = []
    var edges: [BoardEdge] = []

    var estimatedBytes: Int {
        64 + nodes.reduce(0) { $0 + 96 + $1.content.utf8.count } + edges.count * 80
    }
}

@MainActor final class NativeCanvasStore: ObservableObject {
    @Published var files: [[String: Any]] = []
    @Published var file: [String: Any] = [:]
    @Published var document = BoardDocument()
    @Published var saved = BoardDocument()
    @Published var selected = ""
    @Published var zoom = 0.85
    var undo: [BoardDocument] = []
    private var undoSizes: [Int] = []
    private var totalUndoBytes = 0
    var redo: [BoardDocument] = []

    var dirty: Bool { !file.isEmpty && document != saved }

    func record() {
        let bytes = document.estimatedBytes
        undo.append(document)
        undoSizes.append(bytes)
        totalUndoBytes += bytes
        while undo.count > 50 || (undo.count > 1 && totalUndoBytes > 8_000_000) {
            undo.removeFirst()
            totalUndoBytes -= undoSizes.removeFirst()
        }
        redo = []
    }

    func undoEdit() {
        if let item = undo.popLast() {
            if let sz = undoSizes.popLast() { totalUndoBytes = max(0, totalUndoBytes - sz) }
            redo.append(document)
            document = item
        }
    }

    func redoEdit() {
        if let item = redo.popLast() {
            let bytes = document.estimatedBytes
            undo.append(document)
            undoSizes.append(bytes)
            totalUndoBytes += bytes
            document = item
        }
    }

    func discard() {
        document = saved
        undo = []
        undoSizes = []
        totalUndoBytes = 0
        redo = []
    }

    func load(_ data: [String: Any]) throws {
        let next = try decode(data["document"] ?? [:], as: BoardDocument.self)
        file = data["file"] as? [String: Any] ?? [:]
        document = next
        saved = next
        selected = ""
        undo = []
        undoSizes = []
        totalUndoBytes = 0
        redo = []
    }
}

struct NativeCanvasView: View {
    @EnvironmentObject var store: WorkspaceStore
    @ObservedObject var model: NativeCanvasStore
    @State var path = ""; @State var space = ""; @State var kind = "text"; @State var content = ""
    @State var cardWidth = 280; @State var cardHeight = 180
    @State var from = ""; @State var to = ""; @State var edgeLabel = ""
    @State var drag: BoardCard?; @State var showDelete = false
    var selectedSpace: String { space.isEmpty ? store.spaces.first(where: { $0.kind == "personal" })?.id ?? "" : space }
    var minX: Int { min(0, model.document.nodes.map(\.x).min() ?? 0) - 60 }
    var minY: Int { min(0, model.document.nodes.map(\.y).min() ?? 0) - 60 }
    var boardWidth: Double { max(1000, Double((model.document.nodes.map { $0.x + $0.width }.max() ?? 800) - minX + 100)) }
    var boardHeight: Double { max(700, Double((model.document.nodes.map { $0.y + $0.height }.max() ?? 500) - minY + 100)) }

    var body: some View {
        if store.vault == nil {
            ContentUnavailableView("Open a vault to use Canvas.", systemImage: "square.grid.2x2")
        } else {
            VStack(alignment: .leading, spacing: 12) {
                Text("Canvas").font(.title3.weight(.semibold))
                HStack {
                    Button("Refresh boards") { store.send("canvas_list", store.scope("canvas_list")) }
                    Picker("Open board", selection: Binding(get: { model.file["id"] as? String ?? "" }, set: { id in open(id) })) {
                        Text("Choose board").tag("")
                        ForEach(Array(model.files.enumerated()), id: \.offset) { _, file in
                            Text(file["path"] as? String ?? "Board").tag(file["id"] as? String ?? "")
                        }
                    }.frame(maxWidth: 300)
                    Picker("Space", selection: $space) {
                        Text("Personal (default)").tag("")
                        ForEach(store.spaces) { Text($0.name).tag($0.id) }
                    }.frame(maxWidth: 240)
                    TextField("Canvas/Plan.canvas", text: $path)
                        .textFieldStyle(.roundedBorder)
                    Button("Create canvas") { create() }
                        .disabled(path.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .controlSize(.small)
                .disabled(store.busy)

                if model.file.isEmpty {
                    ContentUnavailableView(
                        "Map your next idea.",
                        systemImage: "square.on.square",
                        description: Text("Create a board, then add text, files, links and groups.")
                    )
                } else {
                    HStack {
                        Button("Save canvas") { store.saveCanvas() }
                            .buttonStyle(.borderedProminent)
                            .disabled(store.busy)
                        Button("Undo") { model.undoEdit() }.disabled(model.undo.isEmpty)
                        Button("Redo") { model.redoEdit() }.disabled(model.redo.isEmpty)
                        Slider(value: $model.zoom, in: 0.15...2.5) { Text("Zoom") }.frame(width: 150)
                        Button("Export…") { export() }
                        Button("Discard board draft") { model.discard() }
                        Button("Delete board…", role: .destructive) { showDelete = true }
                            .disabled(model.dirty || store.busy)
                        if model.dirty { Text("Unsaved board").foregroundStyle(.orange) }
                    }
                    .controlSize(.small)

                    DisclosureGroup("Cards & connections") {
                        VStack(alignment: .leading, spacing: 10) {
                            HStack {
                                Picker("Type", selection: $kind) {
                                    ForEach(["text", "file", "link", "group"], id: \.self) { Text($0) }
                                }.frame(width: 150)
                                TextField("Text, vault file path, URL or group label", text: $content)
                                    .textFieldStyle(.roundedBorder)
                                Stepper("Width \(cardWidth)", value: $cardWidth, in: 100...4000, step: 20)
                                Stepper("Height \(cardHeight)", value: $cardHeight, in: 60...4000, step: 20)
                            }
                            HStack {
                                Button("Add card") { applyCard(true) }
                                Button("Apply selected card") { applyCard(false) }.disabled(model.selected.isEmpty)
                                Button("Delete selected card", role: .destructive) { deleteCard() }.disabled(model.selected.isEmpty)
                            }
                            HStack {
                                Picker("From", selection: $from) {
                                    Text("Choose card").tag("")
                                    ForEach(model.document.nodes) { Text("\($0.type) · \($0.id.prefix(8))").tag($0.id) }
                                }
                                Picker("To", selection: $to) {
                                    Text("Choose card").tag("")
                                    ForEach(model.document.nodes) { Text("\($0.type) · \($0.id.prefix(8))").tag($0.id) }
                                }
                                TextField("Connection label", text: $edgeLabel)
                                    .textFieldStyle(.roundedBorder)
                                Button("Connect cards") { connect() }.disabled(from.isEmpty || to.isEmpty)
                            }
                            ScrollView {
                                ForEach(model.document.edges) { edge in
                                    HStack {
                                        Text("\(edge.fromNode.prefix(8)) → \(edge.toNode.prefix(8)) · \(edge.label ?? "")").font(.caption)
                                        Button("Remove connection") {
                                            model.record()
                                            model.document.edges.removeAll { $0.id == edge.id }
                                        }
                                    }
                                }
                            }.frame(maxHeight: 90)
                        }
                        .controlSize(.small)
                        .padding(.top, 8)
                    }

                    Text("Drag cards. Scroll or pinch to pan/zoom. Select a card and use arrow keys to move it. Double-click file/link cards to open them.")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    ScrollView([.horizontal, .vertical]) {
                        ZStack(alignment: .topLeading) {
                            Canvas { context, _ in
                                for edge in model.document.edges {
                                    guard let a = model.document.nodes.first(where: { $0.id == edge.fromNode }),
                                          let b = model.document.nodes.first(where: { $0.id == edge.toNode }) else { continue }
                                    let p = center(a), q = center(b)
                                    var line = Path(); line.move(to: p); line.addLine(to: q)
                                    context.stroke(line, with: .color(.accentColor), lineWidth: 1.5)
                                    let angle = atan2(q.y - p.y, q.x - p.x), head = 10.0
                                    var arrow = Path()
                                    arrow.move(to: q); arrow.addLine(to: CGPoint(x: q.x - head * cos(angle - 0.45), y: q.y - head * sin(angle - 0.45)))
                                    arrow.move(to: q); arrow.addLine(to: CGPoint(x: q.x - head * cos(angle + 0.45), y: q.y - head * sin(angle + 0.45)))
                                    context.stroke(arrow, with: .color(.accentColor), lineWidth: 1.5)
                                    if let label = edge.label {
                                        context.draw(Text(SecretMasker.mask(label)).font(.caption), at: CGPoint(x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 - 10))
                                    }
                                }
                            }
                            ForEach(model.document.nodes.sorted { ($0.type == "group" ? 0 : 1) < ($1.type == "group" ? 0 : 1) }) { card in
                                cardView(card)
                            }
                        }
                        .frame(width: boardWidth * model.zoom, height: boardHeight * model.zoom)
                        .background(Color(nsColor: .underPageBackgroundColor))
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .focusable()
                    .onMoveCommand { direction in move(direction) }
                    .onDeleteCommand { deleteCard() }
                    .gesture(MagnifyGesture().onEnded { value in model.zoom = min(2.5, max(0.15, model.zoom * value.magnification)) })
                }
            }
            .padding(18)
            .onAppear { store.send("canvas_list", store.scope("canvas_list")) }
            .confirmationDialog("Delete this canvas?", isPresented: $showDelete, titleVisibility: .visible) {
                Button("Delete canvas", role: .destructive) {
                    var req = store.scope("canvas_delete")
                    req["path"] = model.file["path"]
                    req["spaceId"] = model.file["spaceId"]
                    req["expected"] = model.file
                    store.send("canvas_deleted", req)
                }
            }
        }
    }

    func cardView(_ card: BoardCard) -> some View {
        let masked = SecretMasker.mask(card.content)
        return VStack(alignment: .leading) {
            Text(card.type.capitalized).font(.caption).foregroundStyle(.secondary)
            Text(masked).font(.body).lineLimit(8)
            Spacer()
        }
        .padding(12)
        .frame(width: Double(card.width) * model.zoom, height: Double(card.height) * model.zoom, alignment: .topLeading)
        .background(card.type == "group" ? Color.secondary.opacity(0.06) : Color(nsColor: .textBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(model.selected == card.id ? Color.accentColor : Color.secondary.opacity(0.4), lineWidth: model.selected == card.id ? 2 : 1))
        .offset(x: Double(card.x - minX) * model.zoom, y: Double(card.y - minY) * model.zoom)
        .onTapGesture(count: 2) { openCard(card) }
        .onTapGesture { select(card) }
        .gesture(
            DragGesture()
                .onChanged { event in
                    if drag?.id != card.id { model.record(); drag = card; select(card) }
                    guard let old = drag, let i = model.document.nodes.firstIndex(where: { $0.id == card.id }) else { return }
                    model.document.nodes[i].x = bounded(Double(old.x) + event.translation.width / model.zoom)
                    model.document.nodes[i].y = bounded(Double(old.y) + event.translation.height / model.zoom)
                }
                .onEnded { _ in drag = nil }
        )
        .accessibilityLabel("Select \(card.type) card \(masked.prefix(60))")
        .accessibilityAddTraits(.isButton)
    }

    func center(_ card: BoardCard) -> CGPoint {
        CGPoint(x: Double(card.x - minX + card.width / 2) * model.zoom, y: Double(card.y - minY + card.height / 2) * model.zoom)
    }
    func bounded(_ number: Double) -> Int { Int(min(100000, max(-100000, number.rounded()))) }
    func select(_ card: BoardCard) { model.selected = card.id; kind = card.type; content = card.content; cardWidth = card.width; cardHeight = card.height }
    func open(_ id: String) {
        guard !id.isEmpty else { return }
        guard !model.dirty else { store.error = "Save or discard this board before opening another."; return }
        var req = store.scope("canvas_read"); req["id"] = id; store.send("canvas_read", req)
    }
    func create() {
        guard !store.dirty else { store.error = "Save or discard drafts before creating a board."; return }
        var req = store.scope("canvas_save")
        req["path"] = path.lowercased().hasSuffix(".canvas") ? path : path + ".canvas"
        req["spaceId"] = selectedSpace
        req["text"] = "{\"nodes\":[],\"edges\":[]}"
        req["expected"] = NSNull()
        store.send("canvas_created", req)
    }
    func checked(_ document: BoardDocument) {
        let base = model.document; let fileID = model.file["id"] as? String
        Task {
            do {
                let source = String(data: try JSONEncoder().encode(document), encoding: .utf8) ?? ""
                _ = try await store.bridge.call(["operation": "validate_canvas", "text": source])
                guard model.document == base, model.file["id"] as? String == fileID else {
                    store.error = "The board changed while validating your edit. Try again."
                    return
                }
                model.record()
                model.document = document
            } catch { store.error = error.localizedDescription }
        }
    }
    func applyCard(_ add: Bool) {
        var next = model.document
        let existing = next.nodes.first(where: { $0.id == model.selected })
        let index = next.nodes.count
        var card = BoardCard(id: add ? UUID().uuidString : model.selected, type: kind, x: existing?.x ?? (index % 4) * 320, y: existing?.y ?? (index / 4) * 240, width: cardWidth, height: cardHeight)
        if !add, let existing, existing.type == kind { card.color = existing.color; card.subpath = existing.subpath }
        switch kind { case "file": card.file = content; case "link": card.url = content; case "group": card.label = content; default: card.text = content }
        guard add || existing != nil else { return }
        if add { next.nodes.append(card) } else if let i = next.nodes.firstIndex(where: { $0.id == card.id }) { next.nodes[i] = card }
        checked(next); model.selected = card.id
    }
    func connect() {
        var next = model.document
        next.edges.append(BoardEdge(id: UUID().uuidString, fromNode: from, toNode: to, label: edgeLabel, toEnd: "arrow"))
        checked(next)
    }
    func deleteCard() {
        guard !model.selected.isEmpty else { return }
        model.record()
        model.document.nodes.removeAll { $0.id == model.selected }
        model.document.edges.removeAll { $0.fromNode == model.selected || $0.toNode == model.selected }
        model.selected = ""
    }
    func move(_ direction: MoveCommandDirection) {
        guard let i = model.document.nodes.firstIndex(where: { $0.id == model.selected }) else { return }
        model.record()
        switch direction {
        case .left: model.document.nodes[i].x = max(-100000, model.document.nodes[i].x - 10)
        case .right: model.document.nodes[i].x = min(100000, model.document.nodes[i].x + 10)
        case .up: model.document.nodes[i].y = max(-100000, model.document.nodes[i].y - 10)
        case .down: model.document.nodes[i].y = min(100000, model.document.nodes[i].y + 10)
        default: break
        }
    }
    func openCard(_ card: BoardCard) {
        if card.type == "file", let note = store.notes.first(where: { $0.path == card.file && $0.spaceId == (model.file["spaceId"] as? String) }) {
            store.select(note.id)
        } else if card.type == "link", let link = card.url, let url = URL(string: link), ["http", "https"].contains(url.scheme ?? "") {
            NSWorkspace.shared.open(url)
        }
    }
    func export() {
        let dialog = NSSavePanel()
        dialog.nameFieldStringValue = URL(fileURLWithPath: model.file["path"] as? String ?? "Board.canvas").lastPathComponent
        if dialog.runModal() == .OK, let url = dialog.url {
            do { try JSONEncoder().encode(model.document).write(to: url, options: .atomic) } catch { store.error = "Cannot export this board." }
        }
    }
}
