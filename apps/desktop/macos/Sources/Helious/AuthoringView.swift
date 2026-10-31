import SwiftUI
import CoreFoundation

struct AuthoringView: View {
    @EnvironmentObject var store: WorkspaceStore
    @State private var day = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f.string(from: Date())
    }()
    @State private var space = ""
    @State private var template = ""
    @State private var path = ""

    var destination: String {
        space.isEmpty ? store.spaces.first(where: { $0.kind == "personal" })?.id ?? "" : space
    }

    var body: some View {
        DisclosureGroup("Daily notes & templates") {
            VStack(alignment: .leading, spacing: 8) {
                Picker("Space", selection: $space) {
                    Text("Personal (default)").tag("")
                    ForEach(store.spaces) { Text($0.name).tag($0.id) }
                }
                Picker("Template", selection: $template) {
                    Text("Built-in blank / daily").tag("")
                    ForEach(store.notes.filter { $0.path.hasPrefix("Templates/") && $0.spaceId == destination }) {
                        Text($0.path).tag($0.id)
                    }
                }
                HStack(spacing: 6) {
                    TextField("YYYY-MM-DD", text: $day)
                        .textFieldStyle(.roundedBorder)
                    Button("Open daily") { create(true) }
                }
                HStack(spacing: 6) {
                    TextField("New path from template", text: $path)
                        .textFieldStyle(.roundedBorder)
                    Button("Create") { create(false) }
                        .disabled(path.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                Text("Save templates under `Templates/`. Variables: {{title}}, {{date}}, {{time}}, {{datetime}}, {{cursor}}.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .controlSize(.small)
            .padding(.top, 8)
            .disabled(store.busy)
        }
        .font(.caption.weight(.medium))
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }

    private func create(_ daily: Bool) {
        guard !store.dirty else {
            store.error = "Save or discard your draft before opening another note."
            return
        }
        var request = store.scope(daily ? "open_daily" : "new_from_template")
        request["day"] = day
        request["spaceId"] = destination
        request["path"] = path
        request["templateId"] = template
        store.send("create_note", request)
    }
}

/// Frontmatter property editor displayed inside the `Properties` tab of `InspectorView`.
struct PropertiesSectionView: View {
    @EnvironmentObject var store: WorkspaceStore
    @State private var name = ""
    @State private var kind = "string"
    @State private var value = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Frontmatter Properties").font(.subheadline.weight(.semibold))
                Spacer()
                Button("Read from draft") {
                    store.propertyBase = store.markdown
                    store.send("properties", ["operation": "properties", "markdown": store.markdown])
                }
                .controlSize(.small)
            }

            if !store.properties.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(store.properties.keys.sorted(), id: \.self) { key in
                            Button(key) { select(key) }
                                .buttonStyle(.bordered)
                                .controlSize(.small)
                        }
                    }
                }
            }

            TextField("Property name", text: $name)
                .textFieldStyle(.roundedBorder)
            Picker("Type", selection: $kind) {
                ForEach(["string", "number", "boolean", "json", "null"], id: \.self) { Text($0) }
            }
            .controlSize(.small)
            TextField("Property value (JSON for lists/objects)", text: $value)
                .textFieldStyle(.roundedBorder)

            HStack(spacing: 8) {
                Button("Apply to draft") { apply(false) }
                    .buttonStyle(.borderedProminent)
                Button("Remove", role: .destructive) { apply(true) }
            }
            .controlSize(.small)
            .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || store.busy)

            Text("Your source body and untouched YAML comments are preserved. Save the draft to keep changes.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .onAppear {
            store.propertyBase = store.markdown
            store.send("properties", ["operation": "properties", "markdown": store.markdown])
        }
    }

    private func select(_ key: String) {
        name = key
        guard let item = store.properties[key] else { return }
        if let string = item as? String {
            kind = "string"
            value = string
            return
        }
        if item is NSNull {
            kind = "null"
        } else if let number = item as? NSNumber {
            kind = CFGetTypeID(number) == CFBooleanGetTypeID() ? "boolean" : "number"
        } else {
            kind = "json"
        }
        value = String(
            data: (try? JSONSerialization.data(withJSONObject: item, options: [.fragmentsAllowed, .sortedKeys])) ?? Data(),
            encoding: .utf8
        ) ?? ""
    }

    private func apply(_ remove: Bool) {
        do {
            let item: Any
            if kind == "string" {
                item = value
            } else if kind == "null" || remove {
                item = NSNull()
            } else {
                item = try JSONSerialization.jsonObject(with: Data(value.utf8), options: .fragmentsAllowed)
                if kind == "boolean", !(item is NSNumber && CFGetTypeID(item as! NSNumber) == CFBooleanGetTypeID()) {
                    throw NativeFailure.message("Use true or false.")
                }
                if kind == "number", !(item is NSNumber && CFGetTypeID(item as! NSNumber) != CFBooleanGetTypeID()) {
                    throw NativeFailure.message("Use a finite number.")
                }
            }
            store.propertyBase = store.markdown
            store.send("edit_property", [
                "operation": "edit_property",
                "markdown": store.markdown,
                "name": name,
                "value": item,
                "remove": remove
            ])
        } catch {
            store.error = error.localizedDescription
        }
    }
}
