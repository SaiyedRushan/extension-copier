use super::AppError;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    /// Folder name inside Chrome's data dir, e.g. "Default" or "Profile 2".
    pub dir: String,
    /// The name Chrome shows for the profile.
    pub name: String,
    /// The Google account signed in to the profile, if any.
    pub email: Option<String>,
}

/// Lists the profiles Chrome knows about, from `Local State`.
/// Default comes first, then the rest by name, which matches Chrome's own menu.
pub fn list_profiles(data_dir: &Path) -> Result<Vec<Profile>, AppError> {
    let raw =
        fs::read_to_string(data_dir.join("Local State")).map_err(|_| AppError::ChromeNotFound)?;
    let json: Value = serde_json::from_str(&raw).map_err(|_| AppError::LocalStateUnreadable)?;
    let Some(cache) = json
        .pointer("/profile/info_cache")
        .and_then(Value::as_object)
    else {
        return Ok(Vec::new());
    };

    let mut profiles: Vec<Profile> = cache
        .iter()
        .filter(|(dir, _)| *dir != "Guest Profile" && *dir != "System Profile")
        .filter(|(dir, _)| data_dir.join(dir).is_dir())
        .map(|(dir, info)| Profile {
            dir: dir.clone(),
            name: non_empty_str(info, "name").unwrap_or(dir).to_string(),
            email: non_empty_str(info, "user_name").map(str::to_string),
        })
        .collect();

    profiles.sort_by(|a, b| {
        (a.dir != "Default")
            .cmp(&(b.dir != "Default"))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.dir.cmp(&b.dir))
    });
    Ok(profiles)
}

fn non_empty_str<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chrome::fixture_dir;

    #[test]
    fn lists_profiles_default_first_and_skips_missing_folders() {
        let profiles = list_profiles(&fixture_dir()).unwrap();
        assert_eq!(
            profiles,
            vec![
                Profile {
                    dir: "Default".into(),
                    name: "Personal".into(),
                    email: Some("me@example.com".into())
                },
                Profile {
                    dir: "Profile 1".into(),
                    name: "Work".into(),
                    email: None
                },
            ]
        );
    }

    #[test]
    fn missing_local_state_means_chrome_not_found() {
        let err = list_profiles(&fixture_dir().join("does-not-exist")).unwrap_err();
        assert_eq!(err, AppError::ChromeNotFound);
    }
}
