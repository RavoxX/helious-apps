import SwiftUI
import AppKit
final class AppDelegate: NSObject, NSApplicationDelegate {
    weak var store: WorkspaceStore?
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let store, store.dirty else {return .terminateNow}
        let alert = NSAlert(); alert.messageText = "Keep your draft"; alert.informativeText = "Save this note before quitting, or discard the unsaved draft."; alert.addButton(withTitle: "Keep editing"); alert.addButton(withTitle: "Discard and quit")
        return alert.runModal() == .alertSecondButtonReturn ? .terminateNow : .terminateCancel
    }
}
@main struct HeliousApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject private var store = WorkspaceStore()
    var body: some Scene {
        Window("Helious", id: "workspace") {
            WorkspaceView().environmentObject(store).preferredColorScheme(store.colorScheme).frame(minWidth: 980, minHeight: 640)
                .task {delegate.store = store; await store.start()}
        }.defaultSize(width: 1440, height: 940)
            .commands {
                CommandGroup(after: .appInfo) {Button("Check for updates…") {store.updates.check()}}
                CommandGroup(after: .newItem) {
                    Button("Open vault folder…") {store.openFolder()}.keyboardShortcut("o", modifiers: [.command, .shift])
                    Button("New note") {store.showNewNote = true}.keyboardShortcut("n").disabled(store.vault == nil)
                }
                CommandGroup(replacing: .saveItem) {Button("Save") {store.save()}.keyboardShortcut("s").disabled((store.note == nil && store.canvas.file.isEmpty) || store.busy)}
            }
        Settings {SettingsView().environmentObject(store).preferredColorScheme(store.colorScheme).frame(width: 580, height: 480)}
    }
}
