// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "ZeroChatApple",
    platforms: [
        .iOS(.v16),
        .macOS(.v14)
    ],
    products: [
        .library(name: "ZeroChatCore", targets: ["ZeroChatCore"]),
        .executable(name: "ZeroChatAppleApp", targets: ["ZeroChatAppleApp"])
    ],
    targets: [
        .systemLibrary(name: "Czlib", path: "Sources/Czlib"),
        .target(name: "ZeroChatCore", dependencies: ["Czlib"]),
        .executableTarget(
            name: "ZeroChatAppleApp",
            dependencies: ["ZeroChatCore"],
            path: "App",
            exclude: ["Info.plist", "ZeroChat.entitlements"],
            resources: [.process("Assets.xcassets")]
        ),
        .testTarget(
            name: "ZeroChatCoreTests",
            dependencies: ["ZeroChatCore"]
        )
    ]
)
