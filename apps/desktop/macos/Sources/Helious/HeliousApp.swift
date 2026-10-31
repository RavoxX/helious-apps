import SwiftUI
import AppKit

@MainActor final class AppDelegate: NSObject, NSApplicationDelegate {
    weak var store: WorkspaceStore?

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let store, store.dirty else { return .terminateNow }
        let alert = NSAlert()
        alert.messageText = "Keep your draft"
        alert.informativeText = "Save your changes before quitting Helious, or discard the unsaved draft."
        alert.addButton(withTitle: "Save and quit")
        alert.addButton(withTitle: "Keep editing")
        alert.addButton(withTitle: "Discard and quit")
        switch alert.runModal() {
        case .alertFirstButtonReturn:
            store.afterSaveAction = { NSApplication.shared.reply(toApplicationShouldTerminate: true) }
            store.save()
            return .terminateLater
        case .alertThirdButtonReturn:
            return .terminateNow
        default:
            return .terminateCancel
        }
    }
}

@main struct HeliousApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject private var store = WorkspaceStore()

    var body: some Scene {
        Window("Helious", id: "workspace") {
            WorkspaceView()
                .environmentObject(store)
                .preferredColorScheme(store.colorScheme)
                .frame(minWidth: 1020, minHeight: 660)
                .task {
                    delegate.store = store
                    await store.start()
                }
        }
        .defaultSize(width: 1460, height: 940)
        .commands {
            CommandGroup(after: .appInfo) {
                Button("Check for updates…") { store.updates.check() }
            }
            CommandGroup(after: .newItem) {
                Button("Open vault folder…") { store.openFolder() }
                    .keyboardShortcut("o", modifiers: [.command, .shift])
                Button("New note…") { store.showNewNote = true }
                    .keyboardShortcut("n")
                    .disabled(store.vault == nil)
                Button("Open today's daily note") { store.openTodayDaily() }
                    .keyboardShortcut("d", modifiers: [.command])
                    .disabled(store.vault == nil)
                Divider()
                Button("Move or rename note…") { store.openRename() }
                    .keyboardShortcut("r", modifiers: [.command, .shift])
                    .disabled(store.note == nil)
            }
            CommandGroup(replacing: .saveItem) {
                Button("Save") { store.save() }
                    .keyboardShortcut("s")
                    .disabled(store.note == nil && store.canvas.file.isEmpty)
            }
            CommandMenu("Navigate") {
                Button("Quick Switch & Commands…") { store.showCommandPalette = true }
                    .keyboardShortcut("k", modifiers: [.command])
                Divider()
                Button("Workspace") { store.destination = .workspace }
                    .keyboardShortcut("1", modifiers: [.command])
                Button("Knowledge Graph") { store.destination = .graph }
                    .keyboardShortcut("2", modifiers: [.command])
                Button("Canvas Boards") { store.destination = .canvas }
                    .keyboardShortcut("3", modifiers: [.command])
                Divider()
                Button(store.showInspector ? "Hide Inspector" : "Show Inspector") {
                    store.showInspector.toggle()
                }
                .keyboardShortcut("i", modifiers: [.command, .option])
                .disabled(store.note == nil)
            }
        }

        Settings {
            SettingsView()
                .environmentObject(store)
                .preferredColorScheme(store.colorScheme)
                .frame(width: 600, height: 500)
        }
    }
}
