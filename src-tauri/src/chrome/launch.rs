//! Finding Chrome and opening pages in a given profile, per operating system.
//! `find_chrome` returns the .app bundle on macOS and the executable elsewhere.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub fn store_url(extension_id: &str) -> String {
    format!("https://chromewebstore.google.com/detail/{extension_id}")
}

/// Finds Google Chrome.app, wherever the user put it.
#[cfg(target_os = "macos")]
pub fn find_chrome() -> Option<PathBuf> {
    let from_spotlight = Command::new("mdfind")
        .arg("kMDItemCFBundleIdentifier == 'com.google.Chrome'")
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

/// Finds chrome.exe: the usual install folders first, then the path Chrome
/// registers with Windows.
#[cfg(target_os = "windows")]
pub fn find_chrome() -> Option<PathBuf> {
    let under = |var: &str| {
        std::env::var_os(var)
            .map(|base| PathBuf::from(base).join(r"Google\Chrome\Application\chrome.exe"))
    };
    let installed = ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"]
        .into_iter()
        .filter_map(under)
        .find(|p| p.is_file());

    installed.or_else(|| {
        ["HKLM", "HKCU"].into_iter().find_map(|hive| {
            let key =
                format!(r"{hive}\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe");
            let out = Command::new("reg")
                .args(["query", &key, "/ve"])
                .stderr(Stdio::null())
                .output()
                .ok()?;
            // A line like: (Default)    REG_SZ    C:\...\chrome.exe
            String::from_utf8_lossy(&out.stdout)
                .lines()
                .find_map(|line| line.split("REG_SZ").nth(1))
                .map(|path| PathBuf::from(path.trim()))
                .filter(|p| p.is_file())
        })
    })
}

/// Finds Chrome's launcher on the PATH or in its default install folder.
#[cfg(target_os = "linux")]
pub fn find_chrome() -> Option<PathBuf> {
    let names = ["google-chrome", "google-chrome-stable"];
    let on_path = std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .flat_map(|dir| names.iter().map(move |name| dir.join(name)))
            .find(|p| p.is_file())
    });
    on_path
        .or_else(|| Some(PathBuf::from("/opt/google/chrome/google-chrome")).filter(|p| p.is_file()))
}

/// Opens `urls` as tabs in a Chrome window for the given profile.
///
/// `open -n` starts a fresh Chrome process. If Chrome is already running, that
/// process hands the URLs and profile to the running one and quits; if not, it
/// becomes the running Chrome. Plain `open -a` would drop the arguments when
/// Chrome is already open. All URLs go in one launch so several pages don't race
/// to start Chrome.
#[cfg(target_os = "macos")]
pub fn open_in_profile(chrome: &Path, profile_dir: &str, urls: &[String]) -> std::io::Result<()> {
    let status = Command::new("open")
        .arg("-n")
        .arg("-a")
        .arg(chrome)
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

/// Runs Chrome with the profile and URLs. As on macOS, a second Chrome process
/// passes them to the running one and quits; if Chrome is closed, this one
/// becomes Chrome. It isn't waited on, since it may run for hours, but a thread
/// collects it when it exits.
#[cfg(not(target_os = "macos"))]
pub fn open_in_profile(chrome: &Path, profile_dir: &str, urls: &[String]) -> std::io::Result<()> {
    let mut child = Command::new(chrome)
        .arg(format!("--profile-directory={profile_dir}"))
        .args(urls)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}
