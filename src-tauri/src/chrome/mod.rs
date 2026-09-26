//! Reads Chrome's profile data on disk. Nothing in here ever writes to Chrome's folder:
//! Chrome signs its preference files and treats edits as tampering.

pub mod extensions;
pub mod launch;
pub mod locale;
pub mod profiles;
pub mod settings;

use serde::Serialize;
use std::path::PathBuf;

/// Errors the frontend turns into plain-language messages. It gets a kind, not text,
/// so all the wording lives in one place (the UI).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AppError {
    /// No `Local State` file, so Chrome has never run as this user (or isn't installed).
    ChromeNotFound,
    /// `Local State` exists but isn't valid JSON (usually caught mid-write).
    LocalStateUnreadable,
    /// The frontend asked about a profile folder that isn't in Chrome's profile list.
    ProfileNotFound,
    /// A profile's preference files exist but couldn't be read or parsed.
    PrefsUnreadable { profile: String },
    /// Not a Chrome extension id (32 letters a to p).
    BadExtensionId,
    /// Chrome couldn't be started.
    LaunchFailed,
    /// The app's own history file couldn't be read or saved.
    HistoryFailed,
    /// Chrome is open, and it has to be closed before settings can be copied.
    ChromeRunning,
    /// Copying settings (or undoing a copy) failed partway.
    SettingsCopyFailed,
    /// The backup to undo from doesn't exist any more.
    BackupNotFound,
}

/// Chrome's user data folder for the current user.
pub fn default_data_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join("Library/Application Support/Google/Chrome"))
}

/// Extension ids are 32 characters from a to p. Checked before an id is used in a
/// file path or passed to Chrome on the command line.
pub fn is_extension_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| (b'a'..=b'p').contains(&b))
}

#[cfg(test)]
pub(crate) fn fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/chrome")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_id_check() {
        assert!(is_extension_id("dhdgffkkebhmkfjojejmpbldmpobfkfo"));
        assert!(!is_extension_id("dhdgffkkebhmkfjojejmpbldmpobfkfz"));
        assert!(!is_extension_id("short"));
        assert!(!is_extension_id("--profile-directory=xxxxxxxxxxxxx"));
    }
}
