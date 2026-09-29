#!/bin/sh
# Reproducible Xcode project: exports brand resources, then runs XcodeGen.
# Requirements: Node.js 22, XcodeGen (brew install xcodegen), Xcode 15+.
set -eu
cd "$(dirname "$0")"
node ../../tools/export-brand.cjs ${MEDIASYNC_BRAND_CONFIG:+--brand "$MEDIASYNC_BRAND_CONFIG"} --ios Generated
xcodegen generate --spec project.yml
echo "Open native/ios/App/MediaSync.xcodeproj or build with:"
echo "  xcodebuild -project native/ios/App/MediaSync.xcodeproj -scheme MediaSync -destination 'generic/platform=iOS Simulator' build"
