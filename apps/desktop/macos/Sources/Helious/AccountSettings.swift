import SwiftUI
import AppKit
struct AccountView: View {
    @EnvironmentObject var store: WorkspaceStore
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Text("Account").font(.largeTitle.bold())
                if store.user.isEmpty {
                    Text("Sign in to access your server vaults. Local folders remain available offline.").foregroundStyle(.secondary)
                    Picker("Connection", selection: $store.customServer) {Text("Helious Cloud").tag(false); Text("Self-hosted server").tag(true)}.pickerStyle(.segmented)
                    if store.customServer {TextField("Server address", text: $store.origin).textFieldStyle(.roundedBorder)} else {Text("helious.work · connection required").font(.callout).foregroundStyle(.secondary)}
                    Form {
                        TextField("Email address", text: $store.email).textContentType(.username)
                        SecureField("Password", text: $store.password).textContentType(.password)
                        TextField("Authenticator or recovery code", text: $store.factor)
                    }.formStyle(.grouped).frame(height: 170)
                    Button(store.busy ? "Signing in…" : "Sign in") {store.login()}.buttonStyle(.borderedProminent).disabled(store.busy || store.email.isEmpty || store.password.isEmpty)
                    HStack {Button("Create account") {store.openWeb("/app/")}; Button("Forgot password?") {store.openWeb("/forgot-password")}}
                    Text("Sessions are kept in your macOS Keychain. Your password is never saved. If Cloud is unavailable, open a local vault from the sidebar.").font(.callout).foregroundStyle(.secondary)
                } else {
                    Text(store.user["name"] as? String ?? "Your account").font(.title2)
                    Text(store.user["email"] as? String ?? ""); Text(store.origin).foregroundStyle(.secondary)
                    HStack {Button("Refresh Cloud vaults") {store.api("cloud_vaults", "/api/vaults")}; Button("Sign out", role: .destructive) {store.guardDraft {store.send("logout", ["operation": "logout"])}}}
                    Divider(); Text("Cloud vaults").font(.headline)
                    ForEach(store.cloudVaults) {vault in Button(vault.name, systemImage: "cloud") {store.openCloud(vault)}}
                    HStack {TextField("New Cloud vault name", text: $store.newPath); Button("Create vault") {store.api("create_vault", "/api/vaults", method: "POST", body: ["name": store.newPath])}.disabled(store.newPath.isEmpty || store.busy)}
                    Divider(); Text("Security & access").font(.headline)
                    Text(store.user["totpEnabled"] as? Bool == true ? "Two-factor authentication is enabled." : "Two-factor authentication is not enabled.")
                    Text("Manage password, sessions, two-factor authentication, secrets and agent tokens in your server's secure account panel.").foregroundStyle(.secondary)
                    Button("Open security settings in browser") {store.openWeb("/app/")}
                }
            }.frame(maxWidth: 540, alignment: .leading).padding(36).frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
struct SettingsView: View {
    @EnvironmentObject var store: WorkspaceStore
    var body: some View {
        Form {
            Section("Appearance") {Picker("Theme", selection: $store.appearance) {Text("Dark").tag("dark"); Text("Light").tag("light"); Text("System").tag("system")}.pickerStyle(.segmented)}
            Section("Editor") {Slider(value: $store.fontSize, in: 12...28, step: 1) {Text("Text size: \(Int(store.fontSize))")}; Toggle("Wrap long lines", isOn: $store.wrap)}
            Section("Extensions") {ExtensionsManager(model: store.extensions)}
            Section("Storage") {Text("Back up your Markdown folders with their .helious history and sync directory.").font(.callout).foregroundStyle(.secondary); Button("Open desktop settings folder") {NSWorkspace.shared.open(store.dataFolder)}}
            UpdateSettings(updates: store.updates)
            Section("About") {Text("Helious 0.9.0 · SwiftUI + native macOS controls"); Text("Vault and session operations use the shared Rust engine. Sessions stay in Keychain.").font(.callout).foregroundStyle(.secondary)}
            Button("Save settings") {store.settingsSave()}.disabled(store.busy)
        }.formStyle(.grouped)
    }
}
struct UpdateSettings: View {
    @ObservedObject var updates: UpdateController
    var body: some View {
        Section("Updates") {
            Toggle("Check for updates automatically", isOn: $updates.automaticChecks).onChange(of: updates.automaticChecks) {_, _ in updates.preferencesChanged()}
            Toggle("Download and install updates automatically", isOn: $updates.automaticDownloads).onChange(of: updates.automaticDownloads) {_, _ in updates.preferencesChanged()}
            Text(updates.status).font(.callout).foregroundStyle(.secondary)
            Button("Check for updates…") {updates.check()}
        }
    }
}
struct SyncView: View {
    @EnvironmentObject var store: WorkspaceStore
    var conflicts: [[String: Any]] {(store.syncConfig["conflicts"] as? [String: [String: Any]] ?? [:]).values.sorted {($0["path"] as? String ?? "") < ($1["path"] as? String ?? "")}}
    var hasPersonal: Bool {store.mappings.contains {local, remote in store.spaces.contains {$0.id == local && $0.kind == "personal"} || store.remoteSpaces.contains {$0.id == remote && $0.kind == "personal"}}}
    var body: some View {
        Form {
            Section {Text("Sync").font(.largeTitle.bold()); Text("Pair a local vault with selected server Spaces. Nothing is selected automatically.").foregroundStyle(.secondary)}
            if store.source != "local" || store.vault == nil {Text("Open a local folder, then return here to configure its sync.")}
            else if store.user.isEmpty {Button("Sign in to Cloud or a self-hosted server") {store.destination = .account}}
            else if !store.syncConfig.isEmpty {
                Section("Pairing") {Text(store.syncConfig["serverOrigin"] as? String ?? store.origin); Button("Sync now") {store.send("sync", ["operation": "sync", "vaultId": store.vault!.id])}.disabled(store.busy || store.dirty)}
                ForEach(Array(conflicts.enumerated()), id: \.offset) {_, conflict in
                    Section("Conflict: \(conflict["path"] as? String ?? "")") {Text("Preserved copy: \(conflict["copy"] as? String ?? "")").font(.callout); HStack {ForEach(["local", "server"], id: \.self) {choice in Button("Use \(choice) version") {store.send("resolve_sync", ["operation": "resolve_sync", "vaultId": store.vault!.id, "path": conflict["path"] as? String ?? "", "choice": choice])}.disabled(store.busy || store.dirty)}}}
                }
                Button("Stop pairing (keep files)", role: .destructive) {store.mappings = [:]; store.send("local_config", ["operation": "local_config", "vaultId": store.vault!.id, "value": ["sync": NSNull()]])}
            } else {
                Section("Choose Spaces") {
                    Picker("Server vault", selection: $store.syncVault) {Text("Choose a vault").tag(""); ForEach(store.cloudVaults) {Text($0.name).tag($0.id)}}
                        .onChange(of: store.syncVault) {_, id in store.mappings = [:]; store.personalConfirmed = false; if !id.isEmpty {store.api("remote_spaces", "/api/vaults/\(id)/spaces")}}
                    ForEach(store.spaces) {local in
                        Picker(local.name, selection: Binding(get: {store.mappings[local.id] ?? ""}, set: {if $0.isEmpty {store.mappings.removeValue(forKey: local.id)} else {store.mappings[local.id] = $0}})) {
                            Text("Do not sync").tag(""); ForEach(store.remoteSpaces) {Text($0.name).tag($0.id)}
                        }
                    }
                    if hasPersonal {Toggle("I explicitly want to sync the selected Personal Space.", isOn: $store.personalConfirmed)}
                    Button("Save sync pairing") {store.savePairing()}.disabled(store.busy || store.mappings.isEmpty || store.syncVault.isEmpty || (hasPersonal && !store.personalConfirmed))
                }
            }
        }.formStyle(.grouped)
    }
}
