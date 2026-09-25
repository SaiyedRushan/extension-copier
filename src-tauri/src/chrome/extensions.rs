use super::{locale, AppError};
use base64::Engine;
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashSet;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Extension {
    pub id: String,
    pub name: String,
    pub version: String,
    /// False when the extension is turned off in this profile.
    pub enabled: bool,
    /// The icon as a data URL, or None if it couldn't be read.
    pub icon: Option<String>,
    /// True when it came from the Chrome Web Store, so it can be added to another
    /// profile from its store page.
    pub copyable: bool,
}

// Values of the `location` field in Chrome's extension prefs.
const LOCATION_INTERNAL: i64 = 1; // installed by the user, normally from the Web Store
const LOCATION_UNPACKED: i64 = 4; // "Load unpacked" in Developer mode
const LOCATION_COMMAND_LINE: i64 = 8; // --load-extension

const MAX_ICON_BYTES: u64 = 512 * 1024;

/// The extensions the user installed in a profile, sorted by name. Chrome's own
/// built-in extensions and ones installed by Chrome or an admin are left out.
pub fn list_extensions(
    data_dir: &Path,
    profile_dir: &str,
    locales: &[String],
) -> Result<Vec<Extension>, AppError> {
    let profile_path = data_dir.join(profile_dir);
    let settings = read_settings(&profile_path, profile_dir)?;

    let mut out: Vec<Extension> = settings
        .iter()
        .filter_map(|(id, entry)| {
            let copyable = match classify(entry)? {
                Kind::FromStore => true,
                Kind::NotFromStore => false,
            };
            Some(describe(&profile_path, id, entry, copyable, locales))
        })
        .collect();

    out.sort_by_key(|e| e.name.to_lowercase());
    Ok(out)
}

/// Every extension id present in a profile, whatever put it there. Used both for
/// "Already in <profile>" and for noticing when the user has added one.
pub fn installed_ids(data_dir: &Path, profile_dir: &str) -> Result<HashSet<String>, AppError> {
    let settings = read_settings(&data_dir.join(profile_dir), profile_dir)?;
    Ok(settings
        .into_iter()
        .filter(|(_, entry)| manifest(entry).is_some())
        .map(|(id, _)| id)
        .collect())
}

enum Kind {
    FromStore,
    NotFromStore,
}

/// None means "don't show it": a leftover from an uninstall, part of Chrome itself,
/// installed by Chrome or policy, or a legacy Chrome app.
fn classify(entry: &Value) -> Option<Kind> {
    let manifest = manifest(entry)?;
    if manifest.contains_key("app") {
        return None;
    }
    match entry.get("location").and_then(Value::as_i64)? {
        LOCATION_INTERNAL if entry.get("from_webstore").and_then(Value::as_bool) == Some(true) => {
            Some(Kind::FromStore)
        }
        LOCATION_INTERNAL | LOCATION_UNPACKED | LOCATION_COMMAND_LINE => Some(Kind::NotFromStore),
        _ => None,
    }
}

fn manifest(entry: &Value) -> Option<&Map<String, Value>> {
    entry.get("manifest").and_then(Value::as_object)
}

/// Merges `extensions.settings` from `Preferences` and `Secure Preferences`.
/// Current Chrome keeps it all in Secure Preferences; older versions split it.
fn read_settings(profile_path: &Path, profile_dir: &str) -> Result<Map<String, Value>, AppError> {
    let unreadable = || AppError::PrefsUnreadable {
        profile: profile_dir.to_string(),
    };
    let mut merged: Map<String, Value> = Map::new();

    for file in ["Preferences", "Secure Preferences"] {
        let raw = match fs::read_to_string(profile_path.join(file)) {
            Ok(raw) => raw,
            Err(e) if e.kind() == ErrorKind::NotFound => continue,
            Err(_) => return Err(unreadable()),
        };
        let json: Value = serde_json::from_str(&raw).map_err(|_| unreadable())?;
        let Some(settings) = json
            .pointer("/extensions/settings")
            .and_then(Value::as_object)
        else {
            continue;
        };
        for (id, entry) in settings {
            match (merged.get_mut(id), entry) {
                (Some(Value::Object(existing)), Value::Object(fields)) => {
                    existing.extend(fields.clone());
                }
                _ => {
                    merged.insert(id.clone(), entry.clone());
                }
            }
        }
    }
    Ok(merged)
}

fn describe(
    profile_path: &Path,
    id: &str,
    entry: &Value,
    copyable: bool,
    locales: &[String],
) -> Extension {
    let manifest = manifest(entry).cloned().unwrap_or_default();
    let ext_dir = extension_dir(profile_path, entry);
    let text = |key: &str| {
        manifest
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string()
    };

    Extension {
        id: id.to_string(),
        name: display_name(&manifest, ext_dir.as_deref(), locales)
            .unwrap_or_else(|| id.to_string()),
        version: text("version"),
        enabled: is_enabled(entry),
        icon: ext_dir
            .as_deref()
            .and_then(|dir| icon_data_url(&manifest, dir)),
        copyable,
    }
}

/// `path` is relative to `<profile>/Extensions` for store installs and absolute for
/// unpacked ones.
fn extension_dir(profile_path: &Path, entry: &Value) -> Option<PathBuf> {
    let path = entry
        .get("path")
        .and_then(Value::as_str)
        .filter(|p| !p.is_empty())?;
    let path = Path::new(path);
    Some(if path.is_absolute() {
        path.to_path_buf()
    } else {
        profile_path.join("Extensions").join(path)
    })
}

fn display_name(
    manifest: &Map<String, Value>,
    ext_dir: Option<&Path>,
    locales: &[String],
) -> Option<String> {
    let default_locale = manifest.get("default_locale").and_then(Value::as_str);
    ["name", "short_name"].iter().find_map(|field| {
        let raw = manifest.get(*field).and_then(Value::as_str)?.trim();
        match locale::message_key(raw) {
            Some(key) => locale::resolve_message(ext_dir?, key, default_locale, locales),
            None if !raw.is_empty() => Some(raw.to_string()),
            None => None,
        }
    })
}

/// Current Chrome lists `disable_reasons` as an array; older versions used a bitmask
/// number, and older still a `state` field where 0 meant off.
fn is_enabled(entry: &Value) -> bool {
    let reasons_clear = match entry.get("disable_reasons") {
        None | Some(Value::Null) => true,
        Some(Value::Array(reasons)) => reasons.is_empty(),
        Some(Value::Number(n)) => n.as_i64() == Some(0),
        Some(_) => true,
    };
    let state_on = entry.get("state").and_then(Value::as_i64) != Some(0);
    reasons_clear && state_on
}

/// Picks the largest icon up to 128px, falling back to the smallest bigger one.
/// Uses the toolbar icon when the manifest has no `icons`, as Chrome does.
fn icon_data_url(manifest: &Map<String, Value>, ext_dir: &Path) -> Option<String> {
    let icons = manifest
        .get("icons")
        .filter(|v| v.as_object().is_some_and(|o| !o.is_empty()))
        .or_else(|| {
            ["action", "browser_action", "page_action"]
                .iter()
                .find_map(|key| manifest.get(*key)?.get("default_icon"))
        })?;
    let mut sized: Vec<(u32, &str)> = match icons {
        Value::Object(map) => map
            .iter()
            .filter_map(|(size, path)| Some((size.parse().ok()?, path.as_str()?)))
            .collect(),
        // A single icon path with no size given.
        Value::String(path) => vec![(128, path.as_str())],
        _ => return None,
    };
    sized.sort_by_key(|(size, _)| *size);
    let (_, rel) = sized
        .iter()
        .rev()
        .find(|(size, _)| *size <= 128)
        .or_else(|| sized.first())?;

    let path = ext_dir.join(rel.trim_start_matches('/'));
    // Don't follow a manifest path out of the extension's own folder.
    if rel.split(['/', '\\']).any(|part| part == "..") {
        return None;
    }
    if fs::metadata(&path).ok()?.len() > MAX_ICON_BYTES {
        return None;
    }
    let mime = match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        _ => return None,
    };
    let bytes = fs::read(&path).ok()?;
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chrome::fixture_dir;

    const A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const C: &str = "cccccccccccccccccccccccccccccccc";
    const D: &str = "dddddddddddddddddddddddddddddddd";
    const G: &str = "gggggggggggggggggggggggggggggggg";

    fn default_list() -> Vec<Extension> {
        list_extensions(&fixture_dir(), "Default", &["en-US".to_string()]).unwrap()
    }

    fn find(list: &[Extension], id: &str) -> Extension {
        list.iter()
            .find(|e| e.id == id)
            .cloned()
            .unwrap_or_else(|| panic!("{id} missing"))
    }

    #[test]
    fn keeps_user_installed_and_drops_the_rest() {
        let ids: Vec<String> = default_list().into_iter().map(|e| e.id).collect();
        // Sorted by name: Beta Blocker, Gamma, Short C, Unpacked Tool, Zeta Tool.
        assert_eq!(ids, vec![B, G, C, D, A]);
    }

    #[test]
    fn store_extensions_are_copyable_and_unpacked_are_not() {
        let list = default_list();
        assert!(find(&list, A).copyable);
        assert!(
            find(&list, G).copyable,
            "entry split across Preferences files"
        );
        assert!(!find(&list, D).copyable);
    }

    #[test]
    fn resolves_translated_names_and_falls_back_to_short_name() {
        let list = default_list();
        assert_eq!(find(&list, B).name, "Beta Blocker");
        assert_eq!(find(&list, C).name, "Short C");
    }

    #[test]
    fn reads_enabled_state() {
        let list = default_list();
        assert!(find(&list, A).enabled);
        assert!(!find(&list, B).enabled);
    }

    #[test]
    fn picks_128px_icon_and_tolerates_missing_icons() {
        let list = default_list();
        let icon = find(&list, A).icon.expect("icon");
        let expected = base64::engine::general_purpose::STANDARD.encode(b"icon-128");
        assert_eq!(icon, format!("data:image/png;base64,{expected}"));
        assert_eq!(find(&list, B).icon, None);
    }

    #[test]
    fn falls_back_to_toolbar_icon() {
        let manifest: Map<String, Value> =
            serde_json::from_str(r#"{ "action": { "default_icon": "i16.png" } }"#).unwrap();
        let dir = fixture_dir()
            .join("Default/Extensions")
            .join(A)
            .join("1.0_0");
        let expected = base64::engine::general_purpose::STANDARD.encode(b"icon-16");
        assert_eq!(
            icon_data_url(&manifest, &dir),
            Some(format!("data:image/png;base64,{expected}"))
        );
    }

    #[test]
    fn installed_ids_include_everything_with_a_manifest() {
        let ids = installed_ids(&fixture_dir(), "Default").unwrap();
        // f is built into Chrome: not listed for copying, but it is installed.
        for id in [A, B, C, D, G, "ffffffffffffffffffffffffffffffff"] {
            assert!(ids.contains(id), "{id}");
        }
        // e is a leftover entry without a manifest.
        assert!(!ids.contains("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"));

        let work = installed_ids(&fixture_dir(), "Profile 1").unwrap();
        assert_eq!(work, HashSet::from([A.to_string()]));
    }

    #[test]
    fn profile_without_prefs_has_no_extensions() {
        let dir = fixture_dir();
        assert_eq!(list_extensions(&dir, "Empty", &[]).unwrap(), vec![]);
    }

    #[test]
    fn broken_prefs_file_is_an_error() {
        let err = list_extensions(&fixture_dir(), "Broken", &[]).unwrap_err();
        assert_eq!(
            err,
            AppError::PrefsUnreadable {
                profile: "Broken".into()
            }
        );
    }

    /// Reads the real Chrome folder and prints what the app would show.
    /// Run with: cargo test real_chrome -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_chrome() {
        let data_dir = crate::chrome::default_data_dir().unwrap();
        let locales: Vec<String> = sys_locale::get_locales().collect();
        for profile in crate::chrome::profiles::list_profiles(&data_dir).unwrap() {
            let list = list_extensions(&data_dir, &profile.dir, &locales).unwrap();
            println!("\n{} ({}) {:?}", profile.name, profile.dir, profile.email);
            for ext in list {
                println!(
                    "  {} {:<45} {:<10} copyable={} enabled={} icon={}",
                    ext.id,
                    ext.name,
                    ext.version,
                    ext.copyable,
                    ext.enabled,
                    ext.icon.is_some()
                );
            }
        }
    }
}
