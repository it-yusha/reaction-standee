// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "WKRecordPreview",
  platforms: [
    .macOS(.v13),
  ],
  products: [
    .executable(name: "WKRecordPreview", targets: ["WKRecordPreview"]),
  ],
  targets: [
    .executableTarget(name: "WKRecordPreview"),
  ]
)
