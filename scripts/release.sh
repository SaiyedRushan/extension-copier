#!/usr/bin/env bash
# Builds a signed and notarized Extension Copier .dmg that runs on both Apple
# silicon and Intel Macs.
#
# One-time setup:
#   1. A "Developer ID Application" certificate in your keychain.
#   2. Notarization credentials saved in your keychain (it asks for an
#      app-specific password from account.apple.com):
#        xcrun notarytool store-credentials extension-copier \
#          --apple-id YOUR_APPLE_ID --team-id YOUR_TEAM_ID
#
# Then:
#   APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)" scripts/release.sh
#
# The .dmg ends up in release/.

set -euo pipefail
cd "$(dirname "$0")/.."

: "${APPLE_SIGNING_IDENTITY:?Set APPLE_SIGNING_IDENTITY to your Developer ID Application certificate name}"
PROFILE="${NOTARY_PROFILE:-extension-copier}"
TARGET="universal-apple-darwin"
VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
APP="src-tauri/target/$TARGET/release/bundle/macos/Extension Copier.app"
OUT="release"
DMG="$OUT/Extension-Copier-$VERSION.dmg"

# Submits a file to Apple and waits. Prints Apple's log and stops if it's rejected.
notarize() {
  local file="$1" result id status
  echo "Sending $(basename "$file") to Apple for notarization. This usually takes a few minutes."
  result="$(xcrun notarytool submit "$file" --keychain-profile "$PROFILE" --wait --output-format json)"
  id="$(node -pe 'JSON.parse(process.argv[1]).id' "$result")"
  status="$(node -pe 'JSON.parse(process.argv[1]).status' "$result")"
  if [ "$status" != "Accepted" ]; then
    echo "Apple didn't accept it (status: $status). Their log:"
    xcrun notarytool log "$id" --keychain-profile "$PROFILE"
    exit 1
  fi
}

echo "Checking the notarization credentials in your keychain."
xcrun notarytool history --keychain-profile "$PROFILE" > /dev/null

rustup target add aarch64-apple-darwin x86_64-apple-darwin > /dev/null

# Tauri signs the app with APPLE_SIGNING_IDENTITY. Without APPLE_ID it skips
# notarizing, which happens below using the keychain credentials instead.
env -u APPLE_ID -u APPLE_PASSWORD -u APPLE_TEAM_ID pnpm tauri build --target "$TARGET" --bundles app

rm -rf "$OUT"
mkdir -p "$OUT/stage"

ditto -c -k --keepParent "$APP" "$OUT/app.zip"
notarize "$OUT/app.zip"
xcrun stapler staple "$APP"

# The disk image holds the app and a shortcut to Applications to drag it onto.
cp -R "$APP" "$OUT/stage/"
ln -s /Applications "$OUT/stage/Applications"
hdiutil create -volname "Extension Copier" -srcfolder "$OUT/stage" -ov -format UDZO "$DMG" > /dev/null
codesign --sign "$APPLE_SIGNING_IDENTITY" --timestamp "$DMG"
notarize "$DMG"
xcrun stapler staple "$DMG"

rm -rf "$OUT/stage" "$OUT/app.zip"

echo "Checking the result the way Gatekeeper will:"
spctl --assess --type open --context context:primary-signature --verbose "$DMG"
spctl --assess --type execute --verbose "$APP"
lipo -archs "$APP"/Contents/MacOS/*

echo "Done: $DMG"
