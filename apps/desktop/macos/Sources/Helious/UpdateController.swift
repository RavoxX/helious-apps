import SwiftUI
import Sparkle
@MainActor final class UpdateController: NSObject, ObservableObject, SPUUpdaterDelegate {
    @Published var status = "Updates are downloaded from GitHub and verified before installation."
    @Published var automaticChecks = true
    @Published var automaticDownloads = false
    weak var store: WorkspaceStore?
    private var feed: String?
    private var started = false
    private var startupRequested = false
    private var refreshTask: Task<Void, Never>?
    private lazy var controller = SPUStandardUpdaterController(startingUpdater: false, updaterDelegate: self, userDriverDelegate: nil)
    func start() async {
        guard !startupRequested else {return}
        startupRequested = true
        // Respect stored preferences even when startup discovery is offline.
        automaticChecks = controller.updater.automaticallyChecksForUpdates
        automaticDownloads = controller.updater.automaticallyDownloadsUpdates
        await discover(manual: false)
        // GitHub's /latest endpoint excludes prereleases. Refresh the selected
        // signed feed while running instead of pinning automatic checks to the
        // release that happened to be current when this app launched.
        refreshTask = Task { [weak self] in
            while !Task.isCancelled {
                do {try await Task.sleep(nanoseconds: 900_000_000_000)} catch {return}
                guard !Task.isCancelled, let self else {return}
                // Sparkle can change these via its permission prompt as well
                // as our Settings scene; its persisted state is authoritative.
                self.automaticChecks = self.controller.updater.automaticallyChecksForUpdates
                self.automaticDownloads = self.controller.updater.automaticallyDownloadsUpdates
                if self.automaticChecks {await self.discover(manual: false)}
            }
        }
    }
    deinit {refreshTask?.cancel()}
    func check() {Task {await discover(manual: true)}}
    private func discover(manual: Bool) async {
        do {
            var request = URLRequest(url: URL(string: "https://api.github.com/repos/RavoxX/helious-apps/releases?per_page=30")!); request.setValue("Helious-macOS-Updater", forHTTPHeaderField: "User-Agent"); request.timeoutInterval = 30
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200, let releases = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {throw NativeFailure.message("The GitHub update feed is unavailable. Try again later.")}
            let release = releases.first {($0["draft"] as? Bool) != true && (($0["assets"] as? [[String: Any]])?.contains {($0["name"] as? String) == "appcast.xml"} ?? false)}
            guard let assets = release?["assets"] as? [[String: Any]], let asset = assets.first(where: {($0["name"] as? String) == "appcast.xml"}), let url = asset["browser_download_url"] as? String, url.hasPrefix("https://github.com/RavoxX/helious-apps/releases/download/") else {status = "No signed native app releases are available yet."; return}
            feed = url
            if !started {controller.startUpdater(); started = true; automaticChecks = controller.updater.automaticallyChecksForUpdates; automaticDownloads = controller.updater.automaticallyDownloadsUpdates}
            status = "Updates are signed and delivered from RavoxX/helious-apps."
            if manual {controller.checkForUpdates(nil)}
        } catch {status = error.localizedDescription}
    }
    func feedURLString(for updater: SPUUpdater) -> String? {feed}
    func updater(_ updater: SPUUpdater, mayPerform updateCheck: SPUUpdateCheck) throws {
        if store?.dirty == true {throw NativeFailure.message("Save your draft before checking or installing updates.")}
    }
    func updaterShouldRelaunchApplication(_ updater: SPUUpdater) -> Bool {store?.dirty != true}
    func preferencesChanged() {
        controller.updater.automaticallyChecksForUpdates = automaticChecks
        controller.updater.automaticallyDownloadsUpdates = automaticDownloads
    }
}
