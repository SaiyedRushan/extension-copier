import { invoke } from "@tauri-apps/api/core";

export type Profile = {
  /** Chrome's folder name for the profile, e.g. "Default" or "Profile 2". */
  dir: string;
  name: string;
  email: string | null;
};

export type Extension = {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  /** Data URL, or null when the extension has no readable icon. */
  icon: string | null;
  /** From the Chrome Web Store, so it can be added to another profile. */
  copyable: boolean;
};

export type SettingsPreview = {
  id: string;
  /** The source profile has saved settings for it that can be copied. */
  hasData: boolean;
  /** Some of its data is in storage Chrome shares between sites, which stays behind. */
  partial: boolean;
};

export type CopyResult = {
  /** Pass to undoSettingsCopy to put the target's old settings back. */
  backupId: string;
  copied: string[];
  /** These failed, and their old settings in the target were put back. */
  failed: string[];
};

/** Mirrors `AppError` in src-tauri/src/chrome/mod.rs. */
export type AppError =
  | { kind: "chromeNotFound" }
  | { kind: "localStateUnreadable" }
  | { kind: "profileNotFound" }
  | { kind: "prefsUnreadable"; profile: string }
  | { kind: "badExtensionId" }
  | { kind: "launchFailed" }
  | { kind: "historyFailed" }
  | { kind: "chromeRunning" }
  | { kind: "settingsCopyFailed" }
  | { kind: "backupNotFound" };

export function isAppError(value: unknown): value is AppError {
  return typeof value === "object" && value !== null && "kind" in value;
}

export const api = {
  chromeInstalled: () => invoke<boolean>("chrome_installed"),
  listProfiles: () => invoke<Profile[]>("list_profiles"),
  listExtensions: (profileDir: string) => invoke<Extension[]>("list_extensions", { profileDir }),
  installedIds: (profileDir: string) => invoke<string[]>("installed_ids", { profileDir }),
  /** Opens each extension's store page as a tab in the given profile, in one Chrome launch. */
  openStorePages: (profileDir: string, extensionIds: string[]) =>
    invoke<void>("open_store_pages", { profileDir, extensionIds }),
  /** The saved history file's text, or null if nothing has been saved yet. */
  readHistory: () => invoke<string | null>("read_history"),
  writeHistory: (json: string) => invoke<void>("write_history", { json }),
  chromeRunning: () => invoke<boolean>("chrome_running"),
  settingsPreview: (fromDir: string, extensionIds: string[]) =>
    invoke<SettingsPreview[]>("settings_preview", { fromDir, extensionIds }),
  copySettings: (fromDir: string, toDir: string, extensionIds: string[]) =>
    invoke<CopyResult>("copy_settings", { fromDir, toDir, extensionIds }),
  undoSettingsCopy: (backupId: string) => invoke<void>("undo_settings_copy", { backupId }),
};
