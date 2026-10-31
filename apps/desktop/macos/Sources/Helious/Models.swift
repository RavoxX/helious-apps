import Foundation

enum Destination: String, CaseIterable, Identifiable {
    case workspace = "Workspace"
    case graph = "Graph"
    case canvas = "Canvas"
    case sync = "Sync"
    case account = "Account"
    case settings = "Settings"

    var id: String { rawValue }
    var symbol: String {
        switch self {
        case .workspace: return "doc.text"
        case .graph: return "point.3.connected.trianglepath.dotted"
        case .canvas: return "square.grid.2x2"
        case .sync: return "arrow.triangle.2.circlepath"
        case .account: return "person.crop.circle"
        case .settings: return "gearshape"
        }
    }
}

enum ExplorerSearchMode: String, CaseIterable, Identifiable {
    case filter = "Filter"
    case fullText = "Full-text"
    var id: String { rawValue }
}

enum InspectorTab: String, CaseIterable, Identifiable {
    case context = "Context"
    case properties = "Properties"
    case extensions = "Extensions"
    case history = "History"
    var id: String { rawValue }
}

struct OpenNoteTab: Identifiable, Equatable {
    var id: String
    var path: String
    var title: String
}

struct SearchHit: Identifiable, Decodable, Equatable {
    var id: String
    var path: String
    var title: String?
    var spaceId: String?
    var snippet: String?
    var score: Int?
}

struct HeadingOutline: Identifiable, Decodable, Equatable {
    var level: Int
    var text: String
    var line: Int
    var id: String { "\(line)-\(level)-\(text)" }
}

struct LinkReference: Identifiable, Decodable, Equatable {
    var id: String
    var path: String?
    var title: String?
    var target: String?
    var snippet: String?
    var resolved: Bool?
}

struct NoteContextSummary: Decodable, Equatable {
    var wordCount: Int
    var charCount: Int
    var readingMinutes: Int
    var tags: [String]
    var headings: [HeadingOutline]
    var backlinks: [LinkReference]
    var outgoing: [LinkReference]
    var unlinkedMentions: [LinkReference]

    static let empty = NoteContextSummary(
        wordCount: 0,
        charCount: 0,
        readingMinutes: 0,
        tags: [],
        headings: [],
        backlinks: [],
        outgoing: [],
        unlinkedMentions: []
    )
}

/// Recursive folder tree built from flat `/` paths for collapsible `DisclosureGroup` navigation.
struct FolderTreeNode: Identifiable {
    var name: String
    var fullPath: String
    var children: [FolderTreeNode] = []
    var notes: [Note] = []

    var id: String { fullPath.isEmpty ? "__root__" : fullPath }

    var totalNotes: Int {
        notes.count + children.reduce(0) { $0 + $1.totalNotes }
    }

    static func build(from items: [Note]) -> FolderTreeNode {
        var root = FolderTreeNode(name: "", fullPath: "")
        for note in items {
            let parts = note.path.split(separator: "/").map(String.init)
            if parts.isEmpty { continue }
            root.insert(parts: parts[...], prefix: "", note: note)
        }
        root.sortInPlace()
        return root
    }

    private mutating func insert(parts: ArraySlice<String>, prefix: String, note: Note) {
        guard let first = parts.first else { return }
        if parts.count == 1 {
            notes.append(note)
            return
        }
        let nextPrefix = prefix.isEmpty ? first : "\(prefix)/\(first)"
        let rest = parts.dropFirst()
        if let index = children.firstIndex(where: { $0.name == first }) {
            children[index].insert(parts: rest, prefix: nextPrefix, note: note)
        } else {
            var child = FolderTreeNode(name: first, fullPath: nextPrefix)
            child.insert(parts: rest, prefix: nextPrefix, note: note)
            children.append(child)
        }
    }

    private mutating func sortInPlace() {
        children.sort { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        for index in children.indices {
            children[index].sortInPlace()
        }
        notes.sort { $0.path.localizedStandardCompare($1.path) == .orderedAscending }
    }
}

enum SecretMasker {
    static func mask(_ text: String) -> String {
        text.replacingOccurrences(
            of: "\\{\\{secret:[^}\\n]+\\}\\}",
            with: "[secret reference]",
            options: .regularExpression
        )
    }

    static func liveWordCount(_ markdown: String) -> Int {
        let stripped = stripFrontmatter(mask(markdown))
        return stripped.split { $0.isWhitespace || $0.isNewline }.count
    }

    static func liveHeadings(_ markdown: String) -> [HeadingOutline] {
        let masked = mask(markdown)
        var inFrontmatter = false
        var inFence = false
        var headings: [HeadingOutline] = []
        let lines = masked.components(separatedBy: "\n")
        for (index, rawLine) in lines.enumerated() {
            let trimmed = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            if index == 0 && trimmed == "---" {
                inFrontmatter = true
                continue
            }
            if inFrontmatter {
                if trimmed == "---" || trimmed == "..." { inFrontmatter = false }
                continue
            }
            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                inFence.toggle()
                continue
            }
            if inFence || !trimmed.hasPrefix("#") { continue }
            let hashes = trimmed.prefix { $0 == "#" }
            let level = hashes.count
            guard (1...6).contains(level) else { continue }
            let rest = trimmed.dropFirst(level)
            guard rest.first == " " || rest.first == "\t" else { continue }
            let title = rest.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "#")).trimmingCharacters(in: .whitespaces)
            if !title.isEmpty {
                headings.append(HeadingOutline(level: level, text: title, line: index + 1))
            }
        }
        return headings
    }

    static func liveTags(_ markdown: String) -> [String] {
        let stripped = stripFrontmatter(mask(markdown))
        guard let regex = try? NSRegularExpression(pattern: "(?:^|\\s)#([A-Za-z][A-Za-z0-9_/-]{0,63})") else {
            return []
        }
        let range = NSRange(stripped.startIndex..<stripped.endIndex, in: stripped)
        var found = Set<String>()
        for match in regex.matches(in: stripped, range: range) {
            if let tagRange = Range(match.range(at: 1), in: stripped) {
                found.insert(stripped[tagRange].lowercased())
            }
        }
        return found.sorted()
    }

    private static func stripFrontmatter(_ text: String) -> String {
        guard text.hasPrefix("---\n") || text.hasPrefix("---\r\n") else { return text }
        let lines = text.components(separatedBy: "\n")
        for index in lines.indices.dropFirst() {
            let trimmed = lines[index].trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed == "---" || trimmed == "..." {
                return lines.dropFirst(index + 1).joined(separator: "\n")
            }
        }
        return text
    }
}

/// Minimal SemVer parser and comparator for GitHub release tag selection.
struct SemVer: Comparable {
    let major: Int
    let minor: Int
    let patch: Int
    let prerelease: [String]

    init?(_ raw: String) {
        let cleaned = raw.hasPrefix("v") ? String(raw.dropFirst()) : raw
        if cleaned.contains("+") { return nil }
        let splitPre = cleaned.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
        let core = splitPre[0].split(separator: ".")
        guard core.count == 3,
              let major = Int(core[0]),
              let minor = Int(core[1]),
              let patch = Int(core[2]) else {
            return nil
        }
        self.major = major
        self.minor = minor
        self.patch = patch
        self.prerelease = splitPre.count > 1 && !splitPre[1].isEmpty
            ? splitPre[1].split(separator: ".").map(String.init)
            : []
    }

    static func < (lhs: SemVer, rhs: SemVer) -> Bool {
        if lhs.major != rhs.major { return lhs.major < rhs.major }
        if lhs.minor != rhs.minor { return lhs.minor < rhs.minor }
        if lhs.patch != rhs.patch { return lhs.patch < rhs.patch }
        if lhs.prerelease.isEmpty && rhs.prerelease.isEmpty { return false }
        if lhs.prerelease.isEmpty { return false }
        if rhs.prerelease.isEmpty { return true }
        for (a, b) in zip(lhs.prerelease, rhs.prerelease) where a != b {
            if let na = Int(a), let nb = Int(b) { return na < nb }
            return a < b
        }
        return lhs.prerelease.count < rhs.prerelease.count
    }
}
