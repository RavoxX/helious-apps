import SwiftUI
import CoreFoundation

struct AuthoringView: View {
    @EnvironmentObject var store: WorkspaceStore
    @State var day = { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX"); return f.string(from: Date()) }()
    @State var space = ""
    @State var template = ""
    @State var path = ""
    var destination: String {space.isEmpty ? store.spaces.first(where: {$0.kind == "personal"})?.id ?? "" : space}
    var body: some View {
        DisclosureGroup("Daily notes & templates") {
            VStack(alignment: .leading, spacing: 10) {
                Picker("Create in Space", selection: $space) {Text("Personal (default)").tag(""); ForEach(store.spaces) {Text($0.name).tag($0.id)}}
                Picker("Template", selection: $template) {Text("Built-in blank / daily").tag(""); ForEach(store.notes.filter {$0.path.hasPrefix("Templates/") && $0.spaceId == destination}) {Text($0.path).tag($0.id)}}
                TextField("Daily date (YYYY-MM-DD)", text: $day)
                Button("Open daily note") {create(true)}
                TextField("New note from template", text: $path)
                Button("Create from template") {create(false)}.disabled(path.trimmingCharacters(in: .whitespaces).isEmpty)
                Text("Save a note under Templates/. Variables: {{title}}, {{date}}, {{time}}, {{datetime}}, {{cursor}}.").font(.caption).foregroundStyle(.secondary)
            }.padding(.top, 8).disabled(store.busy)
        }.padding(12)
    }
    func create(_ daily: Bool) {
        guard !store.dirty else {store.error = "Save or discard your draft before opening another note."; return}
        var request = store.scope(daily ? "open_daily" : "new_from_template")
        request["day"] = day; request["spaceId"] = destination; request["path"] = path; request["templateId"] = template
        store.send("create_note", request)
    }
}

struct PropertiesView: View {
    @EnvironmentObject var store: WorkspaceStore
    @State var name = ""
    @State var kind = "string"
    @State var value = ""
    var body: some View {
        DisclosureGroup("Properties") {
            VStack(alignment: .leading, spacing: 10) {
                Button("Read current properties") {store.propertyBase = store.markdown; store.send("properties", ["operation": "properties", "markdown": store.markdown])}
                ScrollView(.horizontal) {HStack {ForEach(store.properties.keys.sorted(), id: \.self) {key in Button(key) {select(key)}}}}
                HStack {TextField("Property name", text: $name); Picker("Type", selection: $kind) {ForEach(["string", "number", "boolean", "json", "null"], id: \.self) {Text($0)}}.frame(width: 160)}
                TextField("Property value (JSON for lists/objects)", text: $value)
                HStack {Button("Apply property to draft") {apply(false)}; Button("Remove property", role: .destructive) {apply(true)}}.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                Text("Your source body and untouched comments are preserved. Save the draft to keep changes.").font(.caption).foregroundStyle(.secondary)
            }.padding(.top, 10).disabled(store.busy)
        }.padding(.horizontal, 16).padding(.bottom, 12)
    }
    func select(_ key: String) {
        name = key
        guard let item = store.properties[key] else {return}
        if let string = item as? String {kind = "string"; value = string; return}
        if item is NSNull {kind = "null"} else if let number = item as? NSNumber {kind = CFGetTypeID(number) == CFBooleanGetTypeID() ? "boolean" : "number"} else {kind = "json"}
        value = String(data: (try? JSONSerialization.data(withJSONObject: item, options: [.fragmentsAllowed, .sortedKeys])) ?? Data(), encoding: .utf8) ?? ""
    }
    func apply(_ remove: Bool) {
        do {
            let item: Any
            if kind == "string" {item = value} else if kind == "null" || remove {item = NSNull()} else {
                item = try JSONSerialization.jsonObject(with: Data(value.utf8), options: .fragmentsAllowed)
                if kind == "boolean", !(item is NSNumber && CFGetTypeID(item as! NSNumber) == CFBooleanGetTypeID()) {throw NativeFailure.message("Use true or false.")}
                if kind == "number", !(item is NSNumber && CFGetTypeID(item as! NSNumber) != CFBooleanGetTypeID()) {throw NativeFailure.message("Use a finite number.")}
            }
            store.propertyBase = store.markdown
            store.send("edit_property", ["operation": "edit_property", "markdown": store.markdown, "name": name, "value": item, "remove": remove])
        } catch {store.error = error.localizedDescription}
    }
}
