import SwiftUI

private struct GraphPoint {
    var id: String
    var title: String
    var path: String
    var tags: [String]
    var position: CGPoint
    var incoming: Int
    var outgoing: Int
    var degree: Double
    var color: Color
}

/// Theme-aware native force-directed Knowledge Graph for macOS with node inspector and orphan filter.
struct NativeGraphView: View {
    @Environment(\.colorScheme) private var colorScheme
    let data: [String: Any]
    let open: (String) -> Void

    @State private var points: [GraphPoint] = []
    @State private var edges: [(Int, Int)] = []
    @State private var pan = CGSize.zero
    @State private var previousPan = CGSize.zero
    @State private var zoom = 1.0
    @State private var iterations = 0
    @State private var paused = false
    @State private var showOrphans = true
    @State private var filter = ""
    @State private var hover: Int?
    @State private var selected: Int?

    private let palette: [Color] = [
        Color(red: 0.33, green: 0.61, blue: 0.97),
        Color(red: 0.56, green: 0.49, blue: 0.91),
        Color(red: 0.30, green: 0.72, blue: 0.56),
        Color(red: 0.88, green: 0.62, blue: 0.31)
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Text("Connected knowledge").font(.title3.weight(.semibold))
                Text("\(points.count) notes · \(edges.count) links")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                Spacer()
                TextField("Filter title, path or #tag…", text: $filter)
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: 220)
                Toggle("Orphans", isOn: $showOrphans)
                Toggle("Pause layout", isOn: $paused)
                Button("Fit") { fit() }
                Slider(value: $zoom, in: 0.05...4.5)
                    .frame(width: 110)
            }
            .controlSize(.small)

            if let sel = selected, points.indices.contains(sel) {
                let node = points[sel]
                HStack(spacing: 10) {
                    Text(node.title).fontWeight(.semibold)
                    Text(node.path).font(.caption).foregroundStyle(.secondary)
                    Text("\(node.incoming) incoming · \(node.outgoing) outgoing")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button("Open note") { open(node.id) }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                    Button("Clear") { selected = nil }
                        .controlSize(.small)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.1)))
            }

            if points.isEmpty {
                ContentUnavailableView(
                    "No graph yet",
                    systemImage: "point.3.connected.trianglepath.dotted",
                    description: Text("Open a vault with saved Markdown notes to explore its real link graph.")
                )
            } else {
                GeometryReader { geometry in
                    let isDark = colorScheme == .dark
                    let canvasBg = isDark
                        ? Color(red: 0.043, green: 0.047, blue: 0.059)
                        : Color(red: 0.965, green: 0.973, blue: 0.985)
                    let labelColor = isDark ? Color.white : Color(red: 0.10, green: 0.12, blue: 0.15)
                    let focus = hover ?? selected

                    Canvas { context, size in
                        context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(canvasBg))
                        let needle = filter.trimmingCharacters(in: CharacterSet(charactersIn: "# ")).lowercased()
                        let visible = points.map { pt in
                            (showOrphans || pt.degree > 0)
                                && (needle.isEmpty
                                    || pt.title.lowercased().contains(needle)
                                    || pt.path.lowercased().contains(needle)
                                    || pt.tags.contains(where: { $0.contains(needle) }))
                        }
                        var neighbors = Set<Int>()
                        if let focus {
                            neighbors.insert(focus)
                            for (a, b) in edges {
                                if a == focus { neighbors.insert(b) }
                                if b == focus { neighbors.insert(a) }
                            }
                        }

                        for (a, b) in edges where visible[a] && visible[b] {
                            let highlighted = focus != nil && (focus == a || focus == b)
                            var path = Path()
                            path.move(to: screen(points[a].position, size))
                            path.addLine(to: screen(points[b].position, size))
                            let strokeColor = highlighted
                                ? Color.accentColor
                                : Color.secondary.opacity(focus == nil ? (isDark ? 0.28 : 0.35) : 0.08)
                            context.stroke(path, with: .color(strokeColor), lineWidth: highlighted ? 1.4 : 0.75)
                        }

                        let showAllLabels = points.count <= 28 || zoom > 1.35
                        for (index, point) in points.enumerated() where visible[index] {
                            let position = screen(point.position, size)
                            let radius = min(10.0, 3.0 + sqrt(point.degree) * 1.0)
                            let dimmed = focus != nil && !neighbors.contains(index)
                            let circleRect = CGRect(
                                x: position.x - radius,
                                y: position.y - radius,
                                width: radius * 2,
                                height: radius * 2
                            )
                            context.fill(
                                Path(ellipseIn: circleRect),
                                with: .color(point.color.opacity(dimmed ? 0.22 : 1.0))
                            )
                            if selected == index || hover == index {
                                let ring = circleRect.insetBy(dx: -3, dy: -3)
                                context.stroke(Path(ellipseIn: ring), with: .color(.accentColor), lineWidth: 1.5)
                            }
                            if hover == index || selected == index || (showAllLabels && !dimmed) {
                                context.draw(
                                    Text(point.title).font(.caption).foregroundColor(labelColor),
                                    at: CGPoint(x: position.x + radius + 6, y: position.y),
                                    anchor: .leading
                                )
                            }
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.08)))
                    .contentShape(Rectangle())
                    .gesture(
                        DragGesture()
                            .onChanged { pan = CGSize(width: previousPan.width + $0.translation.width, height: previousPan.height + $0.translation.height) }
                            .onEnded { _ in previousPan = pan }
                    )
                    .simultaneousGesture(
                        SpatialTapGesture(count: 2).onEnded { value in
                            if let index = nearest(value.location, geometry.size) {
                                open(points[index].id)
                            }
                        }
                    )
                    .simultaneousGesture(
                        SpatialTapGesture(count: 1).onEnded { value in
                            selected = nearest(value.location, geometry.size)
                        }
                    )
                    .onContinuousHover { phase in
                        switch phase {
                        case .active(let location): hover = nearest(location, geometry.size)
                        case .ended: hover = nil
                        }
                    }
                    .accessibilityLabel("Knowledge graph: \(points.count) notes and \(edges.count) links. Use the note explorer as the text alternative.")
                }
            }
        }
        .padding(18)
        .onAppear { load() }
        .onReceive(Timer.publish(every: 1.0 / 30, on: .main, in: .common).autoconnect()) { _ in
            if !paused && iterations < 700 { step() }
        }
    }

    private func screen(_ point: CGPoint, _ size: CGSize) -> CGPoint {
        CGPoint(x: size.width / 2 + pan.width + point.x * zoom, y: size.height / 2 + pan.height + point.y * zoom)
    }

    private func nearest(_ location: CGPoint, _ size: CGSize) -> Int? {
        points.indices
            .min { a, b in distance(screen(points[a].position, size), location) < distance(screen(points[b].position, size), location) }
            .flatMap { distance(screen(points[$0].position, size), location) < 14 ? $0 : nil }
    }

    private func distance(_ a: CGPoint, _ b: CGPoint) -> Double {
        hypot(a.x - b.x, a.y - b.y)
    }

    private func fit() {
        pan = .zero
        previousPan = .zero
        zoom = min(1.8, 500 / max(8, sqrt(Double(points.count))) / 18)
    }

    private func load() {
        let nodes = (data["nodes"] as? [[String: Any]] ?? [])
            .filter { ($0["kind"] as? String) != "missing" && ($0["kind"] as? String) != "attachment" }
            .prefix(10000)
        points = nodes.enumerated().map { index, value in
            let id = value["id"] as? String ?? ""
            let seed = id.utf8.reduce(UInt64(index + 1)) { ($0 &* 31) &+ UInt64($1) }
            let angle = Double(seed % 62831) / 10000
            let radius = sqrt(Double((seed / 62831) % 10000) / 10000) * sqrt(Double(nodes.count)) * 20
            let inc = value["incoming"] as? Int ?? Int(value["incoming"] as? Double ?? 0)
            let out = value["outgoing"] as? Int ?? Int(value["outgoing"] as? Double ?? 0)
            let deg = inc + out > 0 ? Double(inc + out) : (value["degree"] as? Double ?? 0)
            let tags = value["tags"] as? [String] ?? []
            return GraphPoint(
                id: id,
                title: value["title"] as? String ?? value["path"] as? String ?? "Note",
                path: value["path"] as? String ?? "",
                tags: tags,
                position: CGPoint(x: cos(angle) * radius, y: sin(angle) * radius),
                incoming: inc,
                outgoing: out,
                degree: deg,
                color: palette[Int(seed % 4)]
            )
        }
        let lookup = Dictionary(uniqueKeysWithValues: points.enumerated().map { ($0.element.id, $0.offset) })
        edges = (data["edges"] as? [[String: Any]] ?? []).prefix(40000).compactMap { value in
            guard let a = lookup[value["source"] as? String ?? ""],
                  let b = lookup[value["target"] as? String ?? ""] else { return nil }
            return (a, b)
        }
        iterations = 0
        selected = nil
        fit()
    }

    private func step() {
        guard !points.isEmpty else { return }
        var grid: [String: [Int]] = [:]
        var delta = Array(repeating: CGPoint.zero, count: points.count)
        for (i, point) in points.enumerated() {
            grid["\(Int(floor(point.position.x / 72))),\(Int(floor(point.position.y / 72)))", default: []].append(i)
        }
        for (i, point) in points.enumerated() {
            let x = Int(floor(point.position.x / 72)), y = Int(floor(point.position.y / 72))
            var count = 0
            for dx in -1...1 {
                for dy in -1...1 {
                    for j in (grid["\(x + dx),\(y + dy)"] ?? []).prefix(96) where j != i && count < 96 {
                        count += 1
                        let ox = point.position.x - points[j].position.x
                        let oy = point.position.y - points[j].position.y
                        let d = max(25, ox * ox + oy * oy)
                        delta[i].x += ox / d * 16
                        delta[i].y += oy / d * 16
                    }
                }
            }
            delta[i].x -= point.position.x * 0.0008
            delta[i].y -= point.position.y * 0.0008
        }
        for (a, b) in edges {
            let dx = points[b].position.x - points[a].position.x
            let dy = points[b].position.y - points[a].position.y
            let d = max(1, hypot(dx, dy))
            let force = (d - 78) * 0.012
            let fx = dx / d * force, fy = dy / d * force
            delta[a].x += fx; delta[a].y += fy
            delta[b].x -= fx; delta[b].y -= fy
        }
        for i in points.indices {
            let d = max(1, hypot(delta[i].x, delta[i].y) / 5)
            points[i].position.x += delta[i].x / d
            points[i].position.y += delta[i].y / d
        }
        iterations += 1
    }
}
