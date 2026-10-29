// swift-tools-version: 5.10
import PackageDescription
import Foundation
let nativeLibrary = ProcessInfo.processInfo.environment["HELIOUS_CORE_LIB"] ?? "../target/aarch64-apple-darwin/release"
let package = Package(
    name: "HeliousMac", platforms: [.macOS(.v14)],
    products: [.executable(name: "Helious", targets: ["Helious"])],
    dependencies: [.package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.1")],
    targets: [
        .target(name: "CBridge", publicHeadersPath: "include"),
        .executableTarget(name: "Helious", dependencies: ["CBridge", .product(name: "Sparkle", package: "Sparkle")],
            linkerSettings: [.unsafeFlags(["-L", nativeLibrary, "-lhelious_native", "-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"]),
                .linkedFramework("Security"), .linkedFramework("CoreFoundation"),
                .linkedFramework("CoreServices"), .linkedFramework("SystemConfiguration"),
                .linkedLibrary("resolv"), .linkedLibrary("iconv")]),
    ]
)
