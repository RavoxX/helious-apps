import SwiftUI
import AppKit
import PDFKit
import AVFoundation
import CryptoKit

struct ReadSpan: Decodable {var text: String; var bold: Bool; var italic: Bool; var code: Bool; var strike: Bool; var target: String; var syntax: String; var math: Bool; var color: String}
struct ReadBlock: Decodable {var kind: String; var text: String; var spans: [ReadSpan]; var children: [ReadBlock]; var target: String; var syntax: String; var language: String; var level: Int; var title: String; var collapse: String}
struct ReadAsset {var kind: String; var path: String; var id: String; var blocks: [ReadBlock]; var data: Data?}
@MainActor final class NativeReaderModel: ObservableObject {
    @Published var blocks: [ReadBlock] = []
    @Published var assets: [String: ReadAsset] = [:]
    @Published var errors: [String: String] = [:]
    @Published var loading: Set<String> = []
    var key = ""
    func load(_ source: String, key: String, dark: Bool, bridge: NativeBridge) async {
        self.key = key; blocks = []; assets = [:]; errors = [:]; loading = []
        do {try await Task.sleep(for: .milliseconds(350)); let result = try await bridge.call(["operation": "reading_document", "markdown": source, "dark": dark]); guard self.key == key, !Task.isCancelled else {return}; blocks = try decode(result["blocks"] ?? [], as: [ReadBlock].self)} catch {if self.key == key, !Task.isCancelled {errors["document"] = error.localizedDescription}}
    }
    func request(_ request: [String: Any], key: String, store: WorkspaceStore) {
        guard !loading.contains(key) else {return}; let documentKey = self.key; loading.insert(key)
        Task {do {let result = try await store.bridge.call(request); guard self.key == documentKey else {return}; defer {loading.remove(key)}
            guard assets.count < 20 else {throw NativeFailure.message("Clear previews before opening more attachments.")}
            let data = (result["data"] as? String).flatMap {Data(base64Encoded: $0)}
            if (data?.count ?? 0) + assets.values.reduce(0, {$0 + ($1.data?.count ?? 0)}) > 32*1024*1024 {throw NativeFailure.message("Preview memory limit reached. Clear previews or download the original.")}
            assets[key] = ReadAsset(kind: result["kind"] as? String ?? "", path: result["path"] as? String ?? "", id: result["id"] as? String ?? "", blocks: (try? decode(result["blocks"] ?? [], as: [ReadBlock].self)) ?? [], data: data)
        } catch {if self.key == documentKey {loading.remove(key); errors[key] = error.localizedDescription}}}
    }
    func openLink(_ target: String, syntax: String, store: WorkspaceStore) {
        if let url = URL(string: target), ["http", "https"].contains(url.scheme ?? ""), url.user == nil, url.password == nil {NSWorkspace.shared.open(url); return}
        let context = store.vault?.id; var request = store.scope("reading_resolve"); request["path"] = store.note?.path ?? ""; request["spaceId"] = store.note?.spaceId ?? ""; request["target"] = target; request["syntax"] = syntax
        Task {do {let result = try await store.bridge.call(request); guard store.vault?.id == context, let id = result["id"] as? String else {return}; store.select(id)} catch {store.error = error.localizedDescription}}
    }
}
struct NativeReadingView: View {
    @EnvironmentObject var store: WorkspaceStore
    @StateObject var model = NativeReaderModel()
    @Environment(\.colorScheme) var scheme
    var signature: String {SHA256.hash(data: Data("\(store.source):\(store.vault?.id ?? ""):\(store.note?.id ?? ""):\(scheme):\(store.markdown)".utf8)).map {String(format: "%02x", $0)}.joined()}
    var body: some View {
        ScrollView {VStack(alignment: .leading, spacing: 14) {
            HStack {Text("Reading · local renderers").font(.caption).foregroundStyle(.secondary); Spacer(); Button("Clear attachment previews") {model.assets = [:]; model.errors = [:]}}
            if let error = model.errors["document"] {Text(error).foregroundStyle(.orange)}
            ForEach(Array(model.blocks.enumerated()), id: \.offset) {index, block in NativeReadBlock(block: block, model: model, key: "\(signature)/\(index)", nested: false).id("\(signature)/\(index)")}
        }.frame(maxWidth: 820, alignment: .leading).padding(24).frame(maxWidth: .infinity, alignment: .center)}
            .task(id: signature) {await model.load(store.markdown, key: signature, dark: scheme == .dark, bridge: store.bridge)}
    }
}
struct NativeReadBlock: View {
    @EnvironmentObject var store: WorkspaceStore
    @Environment(\.colorScheme) var scheme
    let block: ReadBlock; @ObservedObject var model: NativeReaderModel; let key: String; let nested: Bool
    @State var expanded = true
    var children: AnyView {AnyView(VStack(alignment: .leading, spacing: 10) {ForEach(Array(block.children.enumerated()), id: \.offset) {index, child in NativeReadBlock(block: child, model: model, key: "\(key)/\(index)", nested: nested)}})}
    var body: some View {
        Group {switch block.kind {
        case "rule": Divider()
        case "code": VStack(alignment: .leading, spacing: 8) {HStack {Text(block.language.isEmpty ? "Plain text" : block.language).font(.caption); Spacer(); Button("Copy code") {NSPasteboard.general.clearContents(); NSPasteboard.general.setString(block.text, forType: .string)}}; ScrollView(.horizontal) {Text(attributed(block.spans, code: true)).font(.system(size: store.fontSize - 1, design: .monospaced)).textSelection(.enabled)}}.padding(14).background(.quaternary, in: RoundedRectangle(cornerRadius: 6))
        case "math", "diagram": VStack(alignment: .leading, spacing: 10) {Text(block.kind == "math" ? "Formula" : "Mermaid diagram").font(.caption).foregroundStyle(.secondary); preview(block.text, operation: block.kind == "math" ? "render_formula" : "render_diagram", key: key); DisclosureGroup("Source") {Text(block.text).font(.system(.body, design: .monospaced)).textSelection(.enabled)}}.padding(14).background(.quaternary, in: RoundedRectangle(cornerRadius: 6))
        case "embed": if nested {Text("Embedded reference: \(block.target). Open its note directly.").font(.caption).foregroundStyle(.secondary)} else {VStack(alignment: .leading, spacing: 10) {Text(block.title.isEmpty ? block.target : block.title).font(.caption).foregroundStyle(.secondary); if let asset = model.assets[key] {NativeReadAsset(asset: asset, model: model, key: key)} else {Button("Preview embedded note or attachment") {var request = store.scope("reading_embed"); request["path"] = store.note?.path ?? ""; request["spaceId"] = store.note?.spaceId ?? ""; request["target"] = block.target; request["syntax"] = block.syntax; model.request(request, key: key, store: store)}}; status(key)}.padding(14).overlay(RoundedRectangle(cornerRadius: 6).stroke(.quaternary))}
        case "callout": if block.collapse.isEmpty {VStack(alignment: .leading, spacing: 10) {Text(block.title).bold(); children}.padding(14).background(.quaternary, in: RoundedRectangle(cornerRadius: 6))} else {DisclosureGroup(block.title, isExpanded: $expanded) {children}.padding(14).background(.quaternary, in: RoundedRectangle(cornerRadius: 6)).onAppear {expanded = block.collapse != "closed"}}
        case "quote": children.padding(.leading, 16).overlay(alignment: .leading) {Rectangle().fill(.secondary.opacity(0.4)).frame(width: 2)}
        case "list": VStack(alignment: .leading, spacing: 8) {ForEach(Array(block.children.enumerated()), id: \.offset) {index, item in HStack(alignment: .top) {Text(block.level == 0 ? "•" : "\(block.level + index)."); NativeReadBlock(block: item, model: model, key: "\(key)/\(index)", nested: nested)}}}
        case "table": ScrollView(.horizontal) {VStack(alignment: .leading, spacing: 6) {ForEach(Array(block.children.enumerated()), id: \.offset) {row, item in HStack(alignment: .top, spacing: 24) {ForEach(Array(item.children.enumerated()), id: \.offset) {cell, value in NativeReadBlock(block: value, model: model, key: "\(key)/\(row)/\(cell)", nested: nested).frame(minWidth: 120, maxWidth: 260, alignment: .leading)}}; Divider()}}}
        default: VStack(alignment: .leading, spacing: 10) {
            if block.kind == "footnote" {Text("[\(block.title)]").bold()}
            if !block.spans.isEmpty {Text(attributed(block.spans)).font(.system(size: block.kind == "heading" ? max(18, 32 - Double(block.level)*2.5) : store.fontSize)).textSelection(.enabled)}
            ForEach(Array(block.spans.enumerated()), id: \.offset) {index, span in if !span.target.isEmpty {Button("Open \(span.text)") {model.openLink(span.target, syntax: span.syntax, store: store)}}; if span.math {preview(span.text, operation: "render_formula", key: "\(key)-math-\(index)")}}
            children
        }
        }}
    }
    func attributed(_ spans: [ReadSpan], code: Bool = false) -> AttributedString {
        var result = AttributedString()
        for span in spans {var piece = AttributedString(span.text); if span.bold {piece.inlinePresentationIntent = .stronglyEmphasized}; if span.italic {piece.inlinePresentationIntent = .emphasized}; if span.code || code {piece.font = .system(.body, design: .monospaced)}; if span.strike {piece.strikethroughStyle = .single}; if !span.target.isEmpty {piece.foregroundColor = .accentColor}; if span.color.count == 7, let hex = UInt32(span.color.dropFirst(), radix: 16) {piece.foregroundColor = Color(red: Double((hex >> 16)&255)/255, green: Double((hex >> 8)&255)/255, blue: Double(hex&255)/255)}; result.append(piece)}
        return result
    }
    @ViewBuilder func preview(_ text: String, operation: String, key: String) -> some View {
        if let asset = model.assets[key] {NativeReadAsset(asset: asset, model: model, key: key)} else {Button(operation == "render_formula" ? "Render formula: \(text.prefix(60))" : "Render preview") {model.request(["operation": operation, "text": text, "dark": scheme == .dark], key: key, store: store)}}; status(key)
    }
    @ViewBuilder func status(_ key: String) -> some View {if model.loading.contains(key) {ProgressView().controlSize(.small)}; if let error = model.errors[key] {Text(error).font(.caption).foregroundStyle(.orange)}}
}
struct NativeReadAsset: View {
    @EnvironmentObject var store: WorkspaceStore
    let asset: ReadAsset; @ObservedObject var model: NativeReaderModel; let key: String
    @State var pdf: PDFDocument?; @State var page = 0; @State var pageImage: NSImage?; @State var audio: AVAudioPlayer?; @State var error = ""
    var body: some View {VStack(alignment: .leading, spacing: 10) {
        switch asset.kind {
        case "image": if let data = asset.data, let image = NSImage(data: data) {Image(nsImage: image).resizable().scaledToFit().frame(maxWidth: 760).accessibilityLabel("Rendered preview")}
        case "note": Button("Open \(asset.path)") {store.select(asset.id)}; ForEach(Array(asset.blocks.enumerated()), id: \.offset) {index, block in NativeReadBlock(block: block, model: model, key: "\(key)/note/\(index)", nested: true)}
        case "pdf": HStack {Button("Previous page") {page -= 1; renderPage()}.disabled(page == 0 || pdf == nil); Text("Page \(page + 1) of \(pdf?.pageCount ?? 0)"); Button("Next page") {page += 1; renderPage()}.disabled(pdf == nil || page + 1 >= (pdf?.pageCount ?? 0))}; if let image = pageImage {Image(nsImage: image).resizable().scaledToFit().accessibilityLabel("PDF page \(page + 1)")}
        case "audio": HStack {Button("Play audio") {do {guard let data = asset.data else {return}; audio?.stop(); audio = try AVAudioPlayer(data: data); audio?.play()} catch {self.error = "This audio format could not be decoded."}}; Button("Pause / resume") {if audio?.isPlaying == true {audio?.pause()} else {audio?.play()}}; Button("Stop audio") {audio?.stop()}}
        default: EmptyView()
        }
        if !asset.path.isEmpty, asset.data != nil {Button("Save attachment…") {saveAttachment()}}
        if !error.isEmpty {Text(error).font(.caption).foregroundStyle(.orange)}
    }.onAppear {if asset.kind == "pdf", let data = asset.data {pdf = PDFDocument(data: data); if let pdf, pdf.pageCount <= 500, !pdf.isLocked {renderPage()} else {pdf = nil; error = "Use an unencrypted PDF of at most 500 pages, or download the original."}}}.onDisappear {audio?.stop()}}
    func renderPage() {guard let page = pdf?.page(at: page) else {return}; page.displaysAnnotations = false; let bounds = page.bounds(for: .mediaBox); guard bounds.width.isFinite, bounds.height.isFinite, bounds.width > 0, bounds.height > 0 else {error = "Invalid PDF page geometry."; return}; let scale = min(1400/bounds.width, 1600/bounds.height, 1.5); pageImage = page.thumbnail(of: CGSize(width: bounds.width*scale, height: bounds.height*scale), for: .mediaBox)}
    func saveAttachment() {guard let data = asset.data else {return}; let panel = NSSavePanel(); panel.nameFieldStringValue = URL(fileURLWithPath: asset.path).lastPathComponent; if panel.runModal() == .OK, let url = panel.url {do {try data.write(to: url, options: .atomic)} catch {self.error = "Cannot save the attachment."}}}
}
