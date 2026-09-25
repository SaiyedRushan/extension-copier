//! Resolves `__MSG_key__` placeholders in extension manifests, which is how
//! translated extensions store their name.

use serde_json::Value;
use std::fs;
use std::path::Path;

/// Returns the key inside `__MSG_key__`, or None if the text isn't a placeholder.
pub fn message_key(text: &str) -> Option<&str> {
    text.strip_prefix("__MSG_")?
        .strip_suffix("__")
        .filter(|k| !k.is_empty())
}

/// Looks `key` up in the extension's `_locales` folder. Tries each preferred locale
/// (in full, then just the language), then the extension's default locale.
/// Keys are matched case-insensitively, as Chrome does.
pub fn resolve_message(
    ext_dir: &Path,
    key: &str,
    default_locale: Option<&str>,
    preferred: &[String],
) -> Option<String> {
    candidate_locales(default_locale, preferred)
        .iter()
        .find_map(|locale| {
            lookup(
                &ext_dir.join("_locales").join(locale).join("messages.json"),
                key,
            )
        })
}

fn candidate_locales(default_locale: Option<&str>, preferred: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push = |loc: String| {
        if !loc.is_empty() && !out.contains(&loc) {
            out.push(loc);
        }
    };
    for pref in preferred {
        // System locales look like "en-GB"; extension folders use "en_GB".
        let full = pref.replace('-', "_");
        let lang = full.split('_').next().unwrap_or("").to_string();
        push(full);
        push(lang);
    }
    if let Some(default) = default_locale {
        push(default.to_string());
    }
    out
}

fn lookup(messages_file: &Path, key: &str) -> Option<String> {
    let raw = fs::read_to_string(messages_file).ok()?;
    let json: Value = serde_json::from_str(raw.trim_start_matches('\u{feff}')).ok()?;
    json.as_object()?
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(key))
        .and_then(|(_, v)| v.get("message"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chrome::fixture_dir;

    fn beta_dir() -> std::path::PathBuf {
        fixture_dir().join("Default/Extensions/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/2.0_0")
    }

    #[test]
    fn parses_placeholder_keys() {
        assert_eq!(message_key("__MSG_appName__"), Some("appName"));
        assert_eq!(message_key("Dark Reader"), None);
        assert_eq!(message_key("__MSG___"), None);
    }

    #[test]
    fn prefers_system_locale_then_language_then_default() {
        let fr = resolve_message(&beta_dir(), "appName", Some("en"), &["fr-CA".into()]);
        assert_eq!(fr.as_deref(), Some("Bloqueur Bêta"));

        let fallback = resolve_message(&beta_dir(), "appName", Some("en"), &["de-DE".into()]);
        assert_eq!(fallback.as_deref(), Some("Beta Blocker"));
    }

    #[test]
    fn unknown_key_is_none() {
        assert_eq!(resolve_message(&beta_dir(), "nope", Some("en"), &[]), None);
    }
}
