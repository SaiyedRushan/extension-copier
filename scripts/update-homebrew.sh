#!/usr/bin/env bash
# Points the Homebrew cask at a published release. Run after `gh release create`.
#   scripts/update-homebrew.sh 0.2.0
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:?Give the version, e.g. scripts/update-homebrew.sh 0.2.0}"
DMG="release/Extension-Copier-$VERSION.dmg"
TAP="SaiyedRushan/homebrew-tap"
CASK="Casks/extension-copier.rb"

[ -f "$DMG" ] || { echo "No $DMG. Run scripts/release.sh first."; exit 1; }
SHA="$(shasum -a 256 "$DMG" | cut -d' ' -f1)"

# The cask must match what people will actually download.
REMOTE="$(gh api "repos/SaiyedRushan/extension-copier/releases/tags/v$VERSION" \
  --jq ".assets[] | select(.name == \"Extension-Copier-$VERSION.dmg\") | .digest")"
[ "$REMOTE" = "sha256:$SHA" ] || { echo "The .dmg on GitHub doesn't match $DMG. Upload it with gh release first."; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
gh repo clone "$TAP" "$WORK" -- -q
sed -i '' -e "s/^  version \".*\"/  version \"$VERSION\"/" -e "s/^  sha256 \".*\"/  sha256 \"$SHA\"/" "$WORK/$CASK"
git -C "$WORK" commit -qam "Update Extension Copier to $VERSION"
git -C "$WORK" push -q
echo "Homebrew now installs $VERSION. People who have it can run: brew upgrade --cask extension-copier"
