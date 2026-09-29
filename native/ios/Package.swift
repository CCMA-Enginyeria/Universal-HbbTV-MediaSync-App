// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MediaSyncCore",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [.library(name: "MediaSyncCore", targets: ["MediaSyncCore"])],
    targets: [
        .target(name: "MediaSyncCore"),
        .testTarget(name: "MediaSyncCoreTests", dependencies: ["MediaSyncCore"])
    ]
)