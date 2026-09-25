use std::path::PathBuf;
use std::process::{Command, Stdio};

const CHROME_BUNDLE_ID: &str = "com.google.Chrome";

pub fn store_url(extension_id: &str) -> String {
    format!("https://chromewebstore.google.com/detail/{extension_id}")
}

/// Finds Google Chrome.app, wherever the user put it.
pub fn find_chrome_app() -> Option<PathBuf> {
    let from_spotlight = Command::new("mdfind")
        .arg(format!("kMDItemCFBundleIdentifier == '{CHROME_BUNDLE_ID}'"))
        .stderr(Stdio::null())
        .output()
        .ok()
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .and_then(|text| {
            text.lines()
                .map(PathBuf::from)
                .find(|p| p.extension().is_some_and(|e| e == "app") && p.is_dir())
        });

    from_spotlight.or_else(|| {
        let home = std::env::var_os("HOME").map(PathBuf::from);
        [
            Some(PathBuf::from("/Applications/Google Chrome.app")),
            home.map(|h| h.join("Applications/Google Chrome.app")),
        ]
        .into_iter()
        .flatten()
        .find(|p| p.is_dir())
    })
}

/// Opens `urls` as tabs in a Chrome window for the given profile.
///
/// `open -n` starts a fresh Chrome process. If Chrome is already running, that
/// process hands the URLs and profile to the running one and quits; if not, it
/// becomes the running Chrome. Plain `open -a` would drop the arguments when
/// Chrome is already open. All URLs go in one launch so several pages don't race
/// to start Chrome.
pub fn open_in_profile(
    app: &std::path::Path,
    profile_dir: &str,
    urls: &[String],
) -> std::io::Result<()> {
    let status = Command::new("open")
        .arg("-n")
        .arg("-a")
        .arg(app)
        .arg("--args")
        .arg(format!("--profile-directory={profile_dir}"))
        .args(urls)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err(std::io::Error::other(format!("open exited with {status}")))
    }
}
