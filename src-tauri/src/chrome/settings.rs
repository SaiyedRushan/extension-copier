//! Copies extensions' saved settings from one profile to another.
//!
//! This is the one place the app writes into Chrome's folder, and only into
//! per-extension data folders, which Chrome doesn't sign. Chrome's signed
//! preference files are never touched. Chrome has to be closed, because it keeps
//! these databases locked while it runs.
//!
//! Before anything in the target profile is replaced, it's moved into a backup
//! folder in the app's own data dir, so every copy can be undone.

use super::{extensions, AppError};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPreview {
    pub id: String,
    /// The source profile has saved data for this extension that can be copied.
    pub has_data: bool,
    /// Some of its data is in storage Chrome shares between all sites and
    /// extensions, which can't be copied on its own. That part stays behind.
    pub partial: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyResult {
    /// Pass to `undo` to put the target's old settings back.
    pub backup_id: String,
    pub copied: Vec<String>,
    /// Ids whose copy failed. Their old settings in the target were put back.
    pub failed: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BackupManifest {
    to: String,
    entries: Vec<BackupEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BackupEntry {
    /// Path inside the target profile folder.
    rel: String,
    /// The target had data here before the copy, now kept in the backup.
    existed: bool,
}

const MANIFEST: &str = "manifest.json";

/// The folders an extension's own data lives in, relative to a profile folder.
fn stores(id: &str) -> [String; 4] {
    [
        format!("Local Extension Settings/{id}"),
        format!("Sync Extension Settings/{id}"),
        format!("IndexedDB/chrome-extension_{id}_0.indexeddb.leveldb"),
        format!("IndexedDB/chrome-extension_{id}_0.indexeddb.blob"),
    ]
}

/// True while Chrome is running on this data folder. Chrome keeps a
/// `SingletonLock` link there naming its process, e.g. `my-mac.local-48039`.
pub fn chrome_running(data_dir: &Path) -> bool {
    let Ok(target) = fs::read_link(data_dir.join("SingletonLock")) else {
        return false;
    };
    let Some(pid) = target
        .to_string_lossy()
        .rsplit('-')
        .next()
        .and_then(|p| p.parse::<u32>().ok())
    else {
        // A lock we can't read: safer to assume Chrome is open.
        return true;
    };
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

/// What copying each extension's settings would involve.
pub fn preview(data_dir: &Path, from: &str, ids: &[String]) -> Vec<SettingsPreview> {
    let source = data_dir.join(from);
    let shared = shared_local_storage(&source);
    ids.iter()
        .map(|id| SettingsPreview {
            id: id.clone(),
            has_data: stores(id).iter().any(|rel| source.join(rel).is_dir()),
            partial: contains(&shared, format!("chrome-extension://{id}").as_bytes()),
        })
        .collect()
}

/// Copies each extension's data folders from `from` to `to`. Only extensions
/// installed in `to` are copied; anything they had there is moved to a backup.
pub fn copy(
    data_dir: &Path,
    from: &str,
    to: &str,
    ids: &[String],
    backups_root: &Path,
) -> Result<CopyResult, AppError> {
    if chrome_running(data_dir) {
        return Err(AppError::ChromeRunning);
    }
    let installed = extensions::installed_ids(data_dir, to)?;
    let source = data_dir.join(from);
    let target = data_dir.join(to);
    let backup_id = new_backup_id();
    let backup_dir = backups_root.join(&backup_id);
    fs::create_dir_all(&backup_dir).map_err(|_| AppError::SettingsCopyFailed)?;

    let mut manifest = BackupManifest {
        to: to.to_string(),
        entries: Vec::new(),
    };
    let mut copied = Vec::new();
    let mut failed = Vec::new();

    for id in ids.iter().filter(|id| installed.contains(*id)) {
        let mut done: Vec<BackupEntry> = Vec::new();
        let result = stores(id).iter().try_for_each(|rel| {
            let src = source.join(rel);
            if !src.is_dir() {
                // Nothing saved in the source: leave whatever the target has.
                return Ok(());
            }
            let dst = target.join(rel);
            let existed = dst.exists();
            if existed {
                move_dir(&dst, &backup_dir.join(rel))?;
            }
            // Recorded before copying, so a half-finished copy is still cleaned up.
            done.push(BackupEntry {
                rel: rel.clone(),
                existed,
            });
            copy_dir(&src, &dst)
        });
        match result {
            Ok(()) => {
                if !done.is_empty() {
                    copied.push(id.clone());
                }
                manifest.entries.extend(done);
            }
            Err(_) => {
                // Put this extension's target folders back as they were.
                let _ = restore(&target, &backup_dir, &done);
                failed.push(id.clone());
            }
        }
    }

    let json = serde_json::to_string_pretty(&manifest).map_err(|_| AppError::SettingsCopyFailed)?;
    fs::write(backup_dir.join(MANIFEST), json).map_err(|_| AppError::SettingsCopyFailed)?;
    Ok(CopyResult {
        backup_id,
        copied,
        failed,
    })
}

/// Puts back what the target had before a copy, and deletes the backup.
pub fn undo(data_dir: &Path, backups_root: &Path, backup_id: &str) -> Result<(), AppError> {
    if !is_backup_id(backup_id) {
        return Err(AppError::BackupNotFound);
    }
    if chrome_running(data_dir) {
        return Err(AppError::ChromeRunning);
    }
    let backup_dir = backups_root.join(backup_id);
    let raw =
        fs::read_to_string(backup_dir.join(MANIFEST)).map_err(|_| AppError::BackupNotFound)?;
    let manifest: BackupManifest =
        serde_json::from_str(&raw).map_err(|_| AppError::BackupNotFound)?;
    if manifest.to.contains('/') || manifest.to.contains("..") {
        return Err(AppError::BackupNotFound);
    }
    restore(&data_dir.join(&manifest.to), &backup_dir, &manifest.entries)
        .map_err(|_| AppError::SettingsCopyFailed)?;
    fs::remove_dir_all(&backup_dir).map_err(|_| AppError::SettingsCopyFailed)
}

/// The profile folder a backup belongs to, so the caller can check it's still a
/// real profile before undoing.
pub fn backup_target(backups_root: &Path, backup_id: &str) -> Option<String> {
    if !is_backup_id(backup_id) {
        return None;
    }
    let raw = fs::read_to_string(backups_root.join(backup_id).join(MANIFEST)).ok()?;
    serde_json::from_str::<BackupManifest>(&raw)
        .ok()
        .map(|m| m.to)
}

fn restore(target: &Path, backup_dir: &Path, entries: &[BackupEntry]) -> io::Result<()> {
    for entry in entries.iter().rev() {
        let dst = target.join(&entry.rel);
        if dst.exists() {
            fs::remove_dir_all(&dst)?;
        }
        if entry.existed {
            move_dir(&backup_dir.join(&entry.rel), &dst)?;
        }
    }
    Ok(())
}

fn new_backup_id() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    millis.to_string()
}

fn is_backup_id(id: &str) -> bool {
    !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit())
}

/// Rename when possible; copy and delete when the backup is on another volume.
fn move_dir(from: &Path, to: &Path) -> io::Result<()> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)?;
    }
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    copy_dir(from, to)?;
    fs::remove_dir_all(from)
}

/// Copies a folder's files and subfolders. Symlinks are skipped: Chrome doesn't
/// put any in these folders, and following one could reach outside them.
fn copy_dir(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let dest: PathBuf = to.join(entry.file_name());
        if kind.is_dir() {
            copy_dir(&entry.path(), &dest)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), dest)?;
        }
    }
    Ok(())
}

/// The raw bytes of the profile's shared Local Storage database. Only searched
/// for extension origins, never parsed.
fn shared_local_storage(profile: &Path) -> Vec<u8> {
    let Ok(entries) = fs::read_dir(profile.join("Local Storage/leveldb")) else {
        return Vec::new();
    };
    let mut bytes = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let is_data = path.extension().is_some_and(|e| e == "ldb" || e == "log");
        if is_data {
            if let Ok(mut b) = fs::read(&path) {
                bytes.append(&mut b);
            }
        }
    }
    bytes
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    !needle.is_empty() && haystack.windows(needle.len()).any(|w| w == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const C: &str = "cccccccccccccccccccccccccccccccc";

    struct Sandbox {
        root: PathBuf,
    }

    impl Sandbox {
        /// A fake Chrome folder: "From" has data for A, B and C; "To" has A and
        /// B installed, with its own settings for A.
        fn new(name: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "extension-copier-settings-{name}-{}",
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&root);
            let s = Sandbox { root };
            for id in [A, B, C] {
                s.write(
                    &format!("chrome/From/Local Extension Settings/{id}/000001.log"),
                    &format!("from {id}"),
                );
            }
            s.write(
                &format!("chrome/From/IndexedDB/chrome-extension_{A}_0.indexeddb.leveldb/CURRENT"),
                "from idb",
            );
            s.write(
                "chrome/From/Local Storage/leveldb/000003.log",
                &format!("junk chrome-extension://{B} junk"),
            );
            s.write(
                &format!("chrome/To/Local Extension Settings/{A}/000001.log"),
                "to A",
            );
            s.write(
                &format!("chrome/To/Sync Extension Settings/{A}/000001.log"),
                "to A sync",
            );
            let prefs = format!(
                r#"{{"extensions":{{"settings":{{"{A}":{{"manifest":{{"name":"A"}}}},"{B}":{{"manifest":{{"name":"B"}}}}}}}}}}"#
            );
            s.write("chrome/To/Secure Preferences", &prefs);
            s
        }

        fn write(&self, rel: &str, text: &str) {
            let path = self.root.join(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, text).unwrap();
        }

        fn read(&self, rel: &str) -> Option<String> {
            fs::read_to_string(self.root.join(rel)).ok()
        }

        fn data(&self) -> PathBuf {
            self.root.join("chrome")
        }

        fn backups(&self) -> PathBuf {
            self.root.join("backups")
        }
    }

    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn ids(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn previews_what_can_be_copied() {
        let s = Sandbox::new("preview");
        let p = preview(
            &s.data(),
            "From",
            &ids(&[A, B, "dddddddddddddddddddddddddddddddd"]),
        );
        assert_eq!(
            p,
            vec![
                SettingsPreview {
                    id: A.into(),
                    has_data: true,
                    partial: false
                },
                SettingsPreview {
                    id: B.into(),
                    has_data: true,
                    partial: true
                },
                SettingsPreview {
                    id: "dddddddddddddddddddddddddddddddd".into(),
                    has_data: false,
                    partial: false
                },
            ]
        );
    }

    #[test]
    fn copies_installed_ones_and_backs_up_what_it_replaces() {
        let s = Sandbox::new("copy");
        let result = copy(&s.data(), "From", "To", &ids(&[A, B, C]), &s.backups()).unwrap();

        // C isn't installed in To, so it's left alone.
        assert_eq!(result.copied, ids(&[A, B]));
        assert!(result.failed.is_empty());
        assert_eq!(
            s.read(&format!(
                "chrome/To/Local Extension Settings/{A}/000001.log"
            ))
            .as_deref(),
            Some(&*format!("from {A}"))
        );
        assert_eq!(
            s.read(&format!(
                "chrome/To/IndexedDB/chrome-extension_{A}_0.indexeddb.leveldb/CURRENT"
            ))
            .as_deref(),
            Some("from idb")
        );
        assert!(s
            .read(&format!(
                "chrome/To/Local Extension Settings/{C}/000001.log"
            ))
            .is_none());
        // The source had no sync data for A, so the target's is kept.
        assert_eq!(
            s.read(&format!("chrome/To/Sync Extension Settings/{A}/000001.log"))
                .as_deref(),
            Some("to A sync")
        );
        // The replaced folder is in the backup.
        let backup = format!(
            "backups/{}/Local Extension Settings/{A}/000001.log",
            result.backup_id
        );
        assert_eq!(s.read(&backup).as_deref(), Some("to A"));
        // The source is untouched.
        assert_eq!(
            s.read(&format!(
                "chrome/From/Local Extension Settings/{A}/000001.log"
            ))
            .as_deref(),
            Some(&*format!("from {A}"))
        );
    }

    #[test]
    fn undo_puts_the_old_settings_back() {
        let s = Sandbox::new("undo");
        let result = copy(&s.data(), "From", "To", &ids(&[A, B]), &s.backups()).unwrap();
        assert_eq!(
            backup_target(&s.backups(), &result.backup_id).as_deref(),
            Some("To")
        );

        undo(&s.data(), &s.backups(), &result.backup_id).unwrap();
        assert_eq!(
            s.read(&format!(
                "chrome/To/Local Extension Settings/{A}/000001.log"
            ))
            .as_deref(),
            Some("to A")
        );
        // B had nothing in To before, so undo removes the copied folder.
        assert!(!s
            .data()
            .join(format!("To/Local Extension Settings/{B}"))
            .exists());
        assert!(!s
            .data()
            .join(format!(
                "To/IndexedDB/chrome-extension_{A}_0.indexeddb.leveldb"
            ))
            .exists());
        assert!(!s.backups().join(&result.backup_id).exists());
    }

    #[test]
    fn refuses_while_chrome_is_open() {
        let s = Sandbox::new("running");
        std::os::unix::fs::symlink(
            format!("my-mac.local-{}", std::process::id()),
            s.data().join("SingletonLock"),
        )
        .unwrap();
        assert!(chrome_running(&s.data()));
        assert_eq!(
            copy(&s.data(), "From", "To", &ids(&[A]), &s.backups()),
            Err(AppError::ChromeRunning)
        );
        // Nothing was changed.
        assert_eq!(
            s.read(&format!(
                "chrome/To/Local Extension Settings/{A}/000001.log"
            ))
            .as_deref(),
            Some("to A")
        );
    }

    #[test]
    fn a_leftover_lock_from_a_crash_doesnt_count_as_running() {
        let s = Sandbox::new("stale");
        std::os::unix::fs::symlink("my-mac.local-2147480000", s.data().join("SingletonLock"))
            .unwrap();
        assert!(!chrome_running(&s.data()));
    }

    #[test]
    fn undo_rejects_made_up_backup_ids() {
        let s = Sandbox::new("badid");
        assert_eq!(
            undo(&s.data(), &s.backups(), "../etc"),
            Err(AppError::BackupNotFound)
        );
        assert_eq!(
            undo(&s.data(), &s.backups(), "123"),
            Err(AppError::BackupNotFound)
        );
    }
}
