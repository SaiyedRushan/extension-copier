# Extension Copier

A Mac app that copies your Chrome extensions from one profile to another.

Website: https://saiyedrushan.github.io/extension-copier/

Pick the profile to copy from, the profile to copy to, and tick the extensions you want. The app opens each extension's Chrome Web Store page in the target profile. You click Add to Chrome, and the app notices and opens the next one. Or open every page at once as tabs and work through them in any order. Extensions installed this way update themselves like any other.

Every list you start is saved in the app's history (`~/Library/Application Support/com.rushanshah.extensioncopier/history.json`), with its progress checked against the target profile each time you look. Close the app halfway and the first screen offers to add the rest.

Once extensions are installed, you can also copy their settings and saved data (your Dark Reader site list, your Tampermonkey scripts). Chrome has to be closed for that. The app copies each extension's own data folders into the target profile and moves whatever the target had for them into a backup first, so the copy can be undone. Chrome's signed preference files are never written, so site access you granted and Incognito settings stay behind, as does anything an extension keeps in the storage Chrome shares between sites.

Apart from that settings copy, the app only reads Chrome's files. Extensions that didn't come from the Web Store (ones loaded from a folder in Developer mode) are listed but can't be copied, because there's no store page to add them from.

## Develop

Needs Node 20+, pnpm and Rust (`rustup`).

```sh
pnpm install
pnpm tauri dev
```

Checks:

```sh
pnpm typecheck
pnpm test                                   # install flow logic
cd src-tauri && cargo test                  # Chrome file parsing, against tests/fixtures
cd src-tauri && cargo clippy --all-targets -- -D warnings
```

To see what the app would read from your own Chrome (read-only):

```sh
cd src-tauri && cargo test real_chrome -- --ignored --nocapture
```

## Release

`scripts/release.sh` builds one app for both Apple silicon and Intel Macs, signs it with your Developer ID certificate, has Apple notarize it, and packs it into a `.dmg` in `release/`.

One-time setup: make an app-specific password at account.apple.com, then save it in your keychain (it asks for the password):

```sh
xcrun notarytool store-credentials extension-copier --apple-id YOUR_APPLE_ID --team-id YOUR_TEAM_ID
```

Each release:

```sh
APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)" scripts/release.sh
gh release create v0.1.0 release/Extension-Copier-0.1.0.dmg
```

Without a certificate, `pnpm tauri build` still makes an unsigned app, which is fine for trying it on your own Mac. It can't go on the Mac App Store: the App Store sandbox won't let an app read Chrome's profile folder.

## License

MIT. See [LICENSE](LICENSE).
