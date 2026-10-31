import SwiftUI
import AppKit
struct AccountView: View {
    @EnvironmentObject var store: WorkspaceStore
    var body: some View {
        Form {
            if store.user.isEmpty {
                Section {
                    Picker("Connection", selection: $store.customServer) {Text("Helious Cloud").tag(false); Text("Self-hosted server").tag(true)}
                        .pickerStyle(.segmented)
                    if store.customServer {
                        TextField("Server address", text: $store.origin)
                    } else {
                        LabeledContent("Server", value: "helious.work")
                    }
                } header: {
                    Text("Sign in")
                } footer: {
                    Text("Sign in to reach your server vaults. Local folders stay available offline.")
                }
                Section {
                    TextField("Email address", text: $store.email).textContentType(.username)
                    SecureField("Password", text: $store.password).textContentType(.password)
                    TextField("Authenticator or recovery code", text: $store.factor)
                } footer: {
                    Text("Sessions are kept in your macOS Keychain. Your password is never saved.")
                }
                Section {
                    HStack {
                        Button(store.busy ? "Signing in…" : "Sign in") {store.login()}
                            .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                            .disabled(store.busy || store.email.isEmpty || store.password.isEmpty)
                        Spacer()
                        Button("Create account") {store.openWeb("/app/")}.buttonStyle(.link)
                        Button("Forgot password?") {store.openWeb("/forgot-password")}.buttonStyle(.link)
                    }
                }
            } else {
                Section("Signed in") {
                    LabeledContent("Name", value: store.user["name"] as? String ?? "")
                    LabeledContent("Email", value: store.user["email"] as? String ?? "")
                    LabeledContent("Server", value: store.origin)
                    HStack {
                        Button("Refresh Cloud vaults") {store.api("cloud_vaults", "/api/vaults")}
                        Spacer()
                        Button("Sign out", role: .destructive) {store.guardDraft {store.send("logout", ["operation": "logout"])}}
                    }
                }
                Section("Cloud vaults") {
                    if store.cloudVaults.isEmpty {Text("No Cloud vaults yet.").foregroundStyle(.secondary)}
                    ForEach(store.cloudVaults) {vault in
                        Button {store.openCloud(vault)} label: {Label(vault.name, systemImage: "cloud")}.buttonStyle(.link)
                    }
                    HStack {
                        TextField("New Cloud vault name", text: $store.newPath)
                        Button("Create vault") {store.api("create_vault", "/api/vaults", method: "POST", body: ["name": store.newPath])}
                            .disabled(store.newPath.isEmpty || store.busy)
                    }
                }
                Section {
                    LabeledContent("Two-factor authentication", value: store.user["totpEnabled"] as? Bool == true ? "On" : "Off")
                    Button("Open security settings in browser") {store.openWeb("/app/")}
                } header: {
                    Text("Security & access")
                } footer: {
                    Text("Password, sessions, two-factor authentication, secrets and agent tokens are managed in your server's secure account pages.")
                }
            }
        }
        .formStyle(.grouped)
        .frame(maxWidth: 640)
        .frame(maxWidth: .infinity)
    }
}
/// Standard macOS Settings window: General, Updates and Extensions tabs.
struct SettingsView: View {
    @EnvironmentObject var store: WorkspaceStore
    var body: some View {
        TabView {
            GeneralSettings().tabItem {Label("General", systemImage: "gearshape")}
            Form {UpdateSettings(updates: store.updates)}.formStyle(.grouped)
                .tabItem {Label("Updates", systemImage: "arrow.down.circle")}
            Form {Section("Extensions") {ExtensionsManager(model: store.extensions)}}.formStyle(.grouped)
                .tabItem {Label("Extensions", systemImage: "puzzlepiece.extension")}
        }
    }
}
struct GeneralSettings: View {
    @EnvironmentObject var store: WorkspaceStore
    private var version: String {Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "development build"}
    var body: some View {
        Form {
            Section("Appearance") {
                Picker("Theme", selection: $store.appearance) {Text("Dark").tag("dark"); Text("Light").tag("light"); Text("Match macOS").tag("system")}
                    .pickerStyle(.segmented)
            }
            Section("Editor") {
                Slider(value: $store.fontSize, in: 12...28, step: 1) {Text("Text size: \(Int(store.fontSize)) pt")}
                Toggle("Wrap long lines", isOn: $store.wrap)
            }
            Section {
                HStack {Spacer(); Button("Save settings") {store.settingsSave()}.buttonStyle(.borderedProminent).disabled(store.busy)}
            }
            Section("Storage") {
                Text("Back up your Markdown folders with their .helious history and sync directory.").font(.callout).foregroundStyle(.secondary)
                Button("Open desktop settings folder") {NSWorkspace.shared.open(store.dataFolder)}
            }
            Section("About") {
                LabeledContent("Version", value: "Helious \(version)")
                Text("SwiftUI with native macOS controls. Vault and session operations use the shared Rust engine; sessions stay in Keychain.")
                    .font(.callout).foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
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
            Section {Text("Pair a local vault with selected server Spaces. Nothing is selected automatically.").foregroundStyle(.secondary)} header: {Text("Sync").font(.title2.weight(.semibold))}
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
