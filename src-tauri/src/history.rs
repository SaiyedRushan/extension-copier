//! Stores the user's history of copies as one JSON file in the app's own data
//! folder. The frontend owns the format; this side only checks it's JSON and
//! writes it safely.

use std::fs;
use std::io;
use std::path::Path;

const FILE_NAME: &str = "history.json";
const MAX_BYTES: usize = 2 * 1024 * 1024;

/// The saved history, or None if nothing has been saved yet.
pub fn read(dir: &Path) -> io::Result<Option<String>> {
    match fs::read_to_string(dir.join(FILE_NAME)) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// Replaces the saved history. Writes to a temporary file and renames it, so
/// quitting halfway never leaves a half-written file.
pub fn write(dir: &Path, json: &str) -> io::Result<()> {
    if json.len() > MAX_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "history too large",
        ));
    }
    serde_json::from_str::<serde_json::Value>(json)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e))?;
    fs::create_dir_all(dir)?;
    let tmp = dir.join(format!("{FILE_NAME}.tmp"));
    fs::write(&tmp, json)?;
    fs::rename(&tmp, dir.join(FILE_NAME))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("extension-copier-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn nothing_saved_yet_is_none() {
        assert_eq!(read(&temp_dir("empty")).unwrap(), None);
    }

    #[test]
    fn round_trips_and_creates_the_folder() {
        let dir = temp_dir("roundtrip").join("nested");
        write(&dir, r#"{"version":1,"sessions":[]}"#).unwrap();
        assert_eq!(
            read(&dir).unwrap().as_deref(),
            Some(r#"{"version":1,"sessions":[]}"#)
        );
        assert!(!dir.join("history.json.tmp").exists());
        fs::remove_dir_all(dir.parent().unwrap()).unwrap();
    }

    #[test]
    fn refuses_text_that_isnt_json() {
        let dir = temp_dir("bad");
        assert!(write(&dir, "{ nope").is_err());
        assert_eq!(read(&dir).unwrap(), None);
    }
}
