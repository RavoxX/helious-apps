import SwiftUI
private struct GraphPoint {var id: String; var title: String; var position: CGPoint; var degree: Double; var color: Color}
struct NativeGraphView: View {
    let data: [String: Any]; let open: (String) -> Void
    @State private var points: [GraphPoint] = []
    @State private var edges: [(Int, Int)] = []
    @State private var pan = CGSize.zero, previousPan = CGSize.zero
    @State private var zoom = 1.0, iterations = 0, paused = false, filter = "", hover: Int?
    private let palette: [Color] = [.cyan, .purple, .mint, .orange]
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Your connected knowledge").font(.title2.bold())
            HStack {Text("\(points.count) notes · \(edges.count) links").foregroundStyle(.secondary); TextField("Filter notes…", text: $filter).frame(maxWidth: 220); Toggle("Pause layout", isOn: $paused); Button("Fit") {fit()}; Slider(value: $zoom, in: 0.02...4).frame(width: 120)}
            if points.isEmpty {ContentUnavailableView("No graph yet", systemImage: "point.3.connected.trianglepath.dotted", description: Text("Open a vault and choose Graph to see links between saved notes."))}
            else {
                GeometryReader {geometry in
                    Canvas {context, size in
                        context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Color(white: 0.065)))
                        let visible = points.map {filter.isEmpty || $0.title.localizedCaseInsensitiveContains(filter)}
                        var neighbors = Set<Int>(); if let hover {neighbors.insert(hover); for (a, b) in edges {if a == hover {neighbors.insert(b)}; if b == hover {neighbors.insert(a)}}}
                        for (a, b) in edges where visible[a] && visible[b] {
                            var path = Path(); path.move(to: screen(points[a].position, size)); path.addLine(to: screen(points[b].position, size)); context.stroke(path, with: .color(.gray.opacity(hover == nil ? 0.22 : (hover == a || hover == b) ? 0.8 : 0.05)), lineWidth: 0.65)
                        }
                        for (index, point) in points.enumerated() where visible[index] {
                            let position = screen(point.position, size); let radius = min(9, 2 + sqrt(point.degree) * 0.7)
                            context.fill(Path(ellipseIn: CGRect(x: position.x - radius, y: position.y - radius, width: radius * 2, height: radius * 2)), with: .color(point.color.opacity(hover == nil || neighbors.contains(index) ? 1 : 0.15)))
                            if hover == index {context.draw(Text(point.title).font(.caption).foregroundColor(.white), at: CGPoint(x: position.x + 12, y: position.y), anchor: .leading)}
                        }
                    }.contentShape(Rectangle())
                    .gesture(DragGesture().onChanged {pan = CGSize(width: previousPan.width + $0.translation.width, height: previousPan.height + $0.translation.height)}.onEnded {_ in previousPan = pan})
                    .simultaneousGesture(SpatialTapGesture().onEnded {value in if let index = nearest(value.location, geometry.size) {open(points[index].id)}})
                    .onContinuousHover {phase in switch phase {case .active(let location): hover = nearest(location, geometry.size); case .ended: hover = nil}}
                    .accessibilityLabel("Knowledge graph: \(points.count) notes and \(edges.count) links. Use the note explorer as the text alternative.")
                }
            }
        }.padding(22)
        .onAppear {load()}
        .onChange(of: data["nodes"] as? [[String: String]] ?? []) {_, _ in load()}
        .onReceive(Timer.publish(every: 1.0 / 30, on: .main, in: .common).autoconnect()) {_ in if !paused && iterations < 700 {step()}}
    }
    private func screen(_ point: CGPoint, _ size: CGSize) -> CGPoint {CGPoint(x: size.width / 2 + pan.width + point.x * zoom, y: size.height / 2 + pan.height + point.y * zoom)}
    private func nearest(_ location: CGPoint, _ size: CGSize) -> Int? {points.indices.min {a, b in distance(screen(points[a].position, size), location) < distance(screen(points[b].position, size), location)}.flatMap {distance(screen(points[$0].position, size), location) < 14 ? $0 : nil}}
    private func distance(_ a: CGPoint, _ b: CGPoint) -> Double {hypot(a.x - b.x, a.y - b.y)}
    private func fit() {pan = .zero; previousPan = .zero; zoom = min(1.8, 500 / max(8, sqrt(Double(points.count))) / 18)}
    private func load() {
        let nodes = (data["nodes"] as? [[String: Any]] ?? []).filter {($0["kind"] as? String) != "missing" && ($0["kind"] as? String) != "attachment"}.prefix(10000)
        points = nodes.enumerated().map {index, value in
            let id = value["id"] as? String ?? ""; let seed = id.utf8.reduce(UInt64(index + 1)) {($0 &* 31) &+ UInt64($1)}; let angle = Double(seed % 62831) / 10000; let radius = sqrt(Double((seed / 62831) % 10000) / 10000) * sqrt(Double(nodes.count)) * 18
            return GraphPoint(id: id, title: value["title"] as? String ?? value["path"] as? String ?? "Note", position: CGPoint(x: cos(angle) * radius, y: sin(angle) * radius), degree: (value["incoming"] as? Double ?? 0) + (value["outgoing"] as? Double ?? 0) + (value["degree"] as? Double ?? 0), color: palette[Int(seed % 4)])
        }
        let lookup = Dictionary(uniqueKeysWithValues: points.enumerated().map {($0.element.id, $0.offset)})
        edges = (data["edges"] as? [[String: Any]] ?? []).prefix(40000).compactMap {value in guard let a = lookup[value["source"] as? String ?? ""], let b = lookup[value["target"] as? String ?? ""] else {return nil}; return (a, b)}
        iterations = 0; fit()
    }
    private func step() {
        guard !points.isEmpty else {return}
        var grid: [String: [Int]] = [:]; var delta = Array(repeating: CGPoint.zero, count: points.count)
        for (i, point) in points.enumerated() {grid["\(Int(floor(point.position.x / 70))),\(Int(floor(point.position.y / 70)))", default: []].append(i)}
        for (i, point) in points.enumerated() {
            let x = Int(floor(point.position.x / 70)), y = Int(floor(point.position.y / 70)); var count = 0
            for dx in -1...1 {for dy in -1...1 {for j in (grid["\(x + dx),\(y + dy)"] ?? []).prefix(96) where j != i && count < 96 {count += 1; let ox = point.position.x - points[j].position.x, oy = point.position.y - points[j].position.y; let d = max(25, ox * ox + oy * oy); delta[i].x += ox / d * 15; delta[i].y += oy / d * 15}}}
            delta[i].x -= point.position.x * 0.0008; delta[i].y -= point.position.y * 0.0008
        }
        for (a, b) in edges {let dx = points[b].position.x - points[a].position.x, dy = points[b].position.y - points[a].position.y; let d = max(1, hypot(dx, dy)), force = (d - 75) * 0.012; let fx = dx / d * force, fy = dy / d * force; delta[a].x += fx; delta[a].y += fy; delta[b].x -= fx; delta[b].y -= fy}
        for i in points.indices {let d = max(1, hypot(delta[i].x, delta[i].y) / 5); points[i].position.x += delta[i].x / d; points[i].position.y += delta[i].y / d}; iterations += 1
    }
}
