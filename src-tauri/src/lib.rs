mod chrome;
mod history;

use chrome::extensions::{self, Extension};
use chrome::profiles::{self, Profile};
use chrome::{launch, AppError};
use std::path::PathBuf;
use tauri::Manager;

fn data_dir() -> Result<PathBuf, AppError> {
    chrome::default_data_dir().ok_or(AppError::ChromeNotFound)
}

/// Only profile folders Chrome itself lists get anywhere near the filesystem or the
/// command line.
fn known_profile(data_dir: &std::path::Path, profile_dir: &str) -> Result<(), AppError> {
    let known = profiles::list_profiles(data_dir)?;
    if known.iter().any(|p| p.dir == profile_dir) {
        Ok(())
    } else {
        Err(AppError::ProfileNotFound)
    }
}

#[tauri::command]
async fn chrome_installed() -> bool {
    launch::find_chrome_app().is_some()
}

#[tauri::command]
async fn list_profiles() -> Result<Vec<Profile>, AppError> {
    profiles::list_profiles(&data_dir()?)
}

#[tauri::command]
async fn list_extensions(profile_dir: String) -> Result<Vec<Extension>, AppError> {
    let data_dir = data_dir()?;
    known_profile(&data_dir, &profile_dir)?;
    let locales: Vec<String> = sys_locale::get_locales().collect();
    extensions::list_extensions(&data_dir, &profile_dir, &locales)
}

#[tauri::command]
async fn installed_ids(profile_dir: String) -> Result<Vec<String>, AppError> {
    let data_dir = data_dir()?;
    known_profile(&data_dir, &profile_dir)?;
    let mut ids: Vec<String> = extensions::installed_ids(&data_dir, &profile_dir)?
        .into_iter()
        .collect();
    ids.sort();
    Ok(ids)
}

/// Opens the store page of each extension as a tab in the given profile.
#[tauri::command]
async fn open_store_pages(profile_dir: String, extension_ids: Vec<String>) -> Result<(), AppError> {
    if extension_ids.is_empty() {
        return Ok(());
    }
    if !extension_ids.iter().all(|id| chrome::is_extension_id(id)) {
        return Err(AppError::BadExtensionId);
    }
    let data_dir = data_dir()?;
    known_profile(&data_dir, &profile_dir)?;
    let app = launch::find_chrome_app().ok_or(AppError::ChromeNotFound)?;
    let urls: Vec<String> = extension_ids
        .iter()
        .map(|id| launch::store_url(id))
        .collect();
    launch::open_in_profile(&app, &profile_dir, &urls).map_err(|_| AppError::LaunchFailed)
}

fn history_dir(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|_| AppError::HistoryFailed)
}

#[tauri::command]
async fn read_history(app: tauri::AppHandle) -> Result<Option<String>, AppError> {
    history::read(&history_dir(&app)?).map_err(|_| AppError::HistoryFailed)
}

#[tauri::command]
async fn write_history(app: tauri::AppHandle, json: String) -> Result<(), AppError> {
    history::write(&history_dir(&app)?, &json).map_err(|_| AppError::HistoryFailed)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            chrome_installed,
            list_profiles,
            list_extensions,
            installed_ids,
            open_store_pages,
            read_history,
            write_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running Extension Copier");
}
