# Extension Copier

A Mac app that copies your Chrome extensions from one profile to another.

Pick the profile to copy from, the profile to copy to, and tick the extensions you want. The app opens each extension's Chrome Web Store page in the target profile. You click Add to Chrome, and the app notices and opens the next one. Or open every page at once as tabs and work through them in any order. Extensions installed this way update themselves like any other.

Every list you start is saved in the app's history (`~/Library/Application Support/com.rushanshah.extensioncopier/history.json`), with its progress checked against the target profile each time you look. Close the app halfway and the first screen offers to add the rest.

It reads Chrome's profile files and never writes to them. Extension settings and saved data aren't copied. Extensions that didn't come from the Web Store (ones loaded from a folder in Developer mode) are listed but can't be copied, because there's no store page to add them from.

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

Tauri signs the app with your Developer ID certificate and notarizes it when these are set. Without them, `pnpm tauri build` still works and makes an unsigned app, which is fine for trying it yourself.

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific password from appleid.apple.com"
export APPLE_TEAM_ID="TEAMID"
pnpm tauri build
```

The `.dmg` ends up in `src-tauri/target/release/bundle/dmg/`. It can't go on the Mac App Store: the App Store sandbox won't let an app read Chrome's profile folder.

## License

MIT. See [LICENSE](LICENSE).
