import SwiftUI

struct ExtensionCommand: Codable, Identifiable {
    var id: String
    var name: String
}

struct ExtensionManifest: Decodable, Identifiable {
    var id: String
    var name: String
    var version: String
    var permissions: [String]
    var commands: [ExtensionCommand]
}

struct InstalledExtension: Decodable, Identifiable {
    var manifest: ExtensionManifest
    var granted: [String]
    var enabled: Bool
    var id: String { manifest.id }
}

@MainActor final class NativeExtensions: ObservableObject {
    @Published var installed: [InstalledExtension] = []
    @Published var input = ""
    @Published var candidate: ExtensionManifest?
    @Published var consent = false
    @Published var selection = ""
    @Published var message = ""
    @Published var error = ""
    @Published var busy = false
    @Published var proposal: String?
    var proposalBase = ""
    var proposalNote = ""
    var proposalVault = ""

    func library(_ request: [String: Any], store: WorkspaceStore) {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                let response = try await store.bridge.call(request)
                installed = try decode(response["extensions"] ?? [], as: [InstalledExtension].self)
                error = ""
                proposal = nil
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    func example(store: WorkspaceStore) {
        Task {
            do {
                let response = try await store.bridge.call(["operation": "extension_example"])
                let data = try JSONSerialization.data(
                    withJSONObject: response["manifest"] ?? [:],
                    options: [.prettyPrinted, .sortedKeys]
                )
                input = String(data: data, encoding: .utf8) ?? ""
                candidate = nil
                consent = false
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    func review(store: WorkspaceStore) {
        consent = false
        candidate = nil
        guard input.utf8.count <= 65536 else {
            error = "Manifests are limited to 64 KiB."
            return
        }
        Task {
            do {
                let value = try JSONSerialization.jsonObject(with: Data(input.utf8))
                let response = try await store.bridge.call(["operation": "validate_extension", "manifest": value])
                candidate = try decode(response["manifest"] ?? [:], as: ExtensionManifest.self)
                error = ""
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    func install(store: WorkspaceStore) {
        guard consent, candidate != nil else { return }
        do {
            let manifest = try JSONSerialization.jsonObject(with: Data(input.utf8))
            library(["operation": "install_extension", "manifest": manifest, "consent": true], store: store)
            candidate = nil
            consent = false
            input = ""
        } catch {
            self.error = error.localizedDescription
        }
    }

    func preview(store: WorkspaceStore) {
        let parts = selection.split(separator: "/")
        guard parts.count == 2, !busy else { return }
        let base = store.markdown
        let note = store.note?.id ?? ""
        let vault = "\(store.source):\(store.vault?.id ?? "")"
        busy = true
        Task {
            defer { busy = false }
            do {
                let response = try await store.bridge.call([
                    "operation": "run_extension",
                    "id": String(parts[0]),
                    "command": String(parts[1]),
                    "markdown": base,
                    "path": store.note?.path ?? ""
                ])
                guard store.markdown == base,
                      store.note?.id == note,
                      "\(store.source):\(store.vault?.id ?? "")" == vault else {
                    error = "Your draft changed. Preview the command again."
                    return
                }
                proposalBase = base
                proposalNote = note
                proposalVault = vault
                proposal = response["markdown"] as? String
                message = response["message"] as? String ?? ""
                error = ""
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    func current(_ store: WorkspaceStore) -> Bool {
        proposalBase == store.markdown
            && proposalNote == store.note?.id
            && proposalVault == "\(store.source):\(store.vault?.id ?? "")"
    }
}

struct ExtensionsManager: View {
    @EnvironmentObject var store: WorkspaceStore
    @ObservedObject var model: NativeExtensions

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("API 1 uses bounded data-only commands. No scripts, network, filesystem or secret access. Permissions apply to the editor draft on this device. Apply and Save are separate actions.")
                .font(.callout)
                .foregroundStyle(.secondary)
            Button("Refresh extensions") { model.library(["operation": "extensions"], store: store) }
            ForEach(model.installed) { record in
                HStack {
                    Toggle(
                        "\(record.manifest.name) · \(record.manifest.version)",
                        isOn: Binding(
                            get: { record.enabled },
                            set: { model.library(["operation": "enable_extension", "id": record.id, "enabled": $0], store: store) }
                        )
                    )
                    Button("Remove \(record.manifest.name)") {
                        model.library(["operation": "remove_extension", "id": record.id], store: store)
                    }
                }
            }
            Text("Extension manifest (JSON)").font(.headline)
            TextEditor(text: $model.input)
                .font(.system(.body, design: .monospaced))
                .frame(minHeight: 140)
                .onChange(of: model.input) { _, _ in
                    model.candidate = nil
                    model.consent = false
                }
            HStack {
                Button("Use example manifest") { model.example(store: store) }
                Button("Review extension permissions") { model.review(store: store) }
            }
            if let manifest = model.candidate {
                Text("\(manifest.name) · \(manifest.version)").bold()
                ForEach(manifest.permissions, id: \.self) {
                    Text($0 == "editor:write" ? "• Propose changes to the current editor draft" : "• Read the current editor draft")
                }
                Toggle("I grant these editor permissions on this device.", isOn: $model.consent)
                Button("Install reviewed extension") { model.install(store: store) }
                    .disabled(!model.consent)
            }
            if !model.error.isEmpty { Text(model.error).foregroundStyle(.orange) }
        }
        .disabled(model.busy)
        .task { model.library(["operation": "extensions"], store: store) }
    }
}

/// Inspector section for running installed API 1 extension commands against the current draft.
struct ExtensionCommandsSectionView: View {
    @EnvironmentObject var store: WorkspaceStore
    @ObservedObject var model: NativeExtensions

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Extension Commands").font(.subheadline.weight(.semibold))
            Picker("Command", selection: $model.selection) {
                Text("Choose a command").tag("")
                ForEach(model.installed.filter(\.enabled)) { record in
                    ForEach(record.manifest.commands) { command in
                        Text("\(record.manifest.name) · \(command.name)").tag("\(record.id)/\(command.id)")
                    }
                }
            }
            .controlSize(.small)

            Button("Preview command") { model.preview(store: store) }
                .controlSize(.small)
                .disabled(model.selection.isEmpty || model.busy)

            if !model.message.isEmpty {
                Text(model.message).font(.caption)
            }
            if let proposal = model.proposal, proposal != model.proposalBase {
                Text("Proposed Markdown").font(.caption.weight(.semibold))
                ScrollView {
                    Text(SecretMasker.mask(proposal))
                        .font(.system(.caption, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 150)
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.04)))

                Button("Apply proposal to draft") {
                    guard model.current(store) else { return }
                    store.markdown = proposal
                    model.proposal = nil
                    model.message = "Proposal applied. Save explicitly to keep it."
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .disabled(!model.current(store))

                if !model.current(store) {
                    Text("Your draft changed. Preview the command again.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            if !model.error.isEmpty {
                Text(model.error).font(.caption).foregroundStyle(.orange)
            }
            Text("Manage permissions and install extensions in Settings (⌘,).")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .task { model.library(["operation": "extensions"], store: store) }
    }
}
