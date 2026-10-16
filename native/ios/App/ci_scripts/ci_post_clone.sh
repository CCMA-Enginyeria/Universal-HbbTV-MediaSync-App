#!/bin/sh
# Xcode Cloud: MediaSync.xcodeproj and App/Generated are not versioned, so generate them right
# after the clone, before Xcode Cloud resolves the project. Xcode Cloud only runs scripts from the
# ci_scripts folder next to the selected project (native/ios/App).
set -eu

export HOMEBREW_NO_INSTALL_CLEANUP=1
export HOMEBREW_NO_AUTO_UPDATE=1
# export-brand.cjs (also run by the app's pre-build script) needs Node.js; the project needs XcodeGen.
brew install node xcodegen

sh "$CI_PRIMARY_REPOSITORY_PATH/native/ios/App/generate.sh"
