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

/** Mirrors `AppError` in src-tauri/src/chrome/mod.rs. */
export type AppError =
  | { kind: "chromeNotFound" }
  | { kind: "localStateUnreadable" }
  | { kind: "profileNotFound" }
  | { kind: "prefsUnreadable"; profile: string }
  | { kind: "badExtensionId" }
  | { kind: "launchFailed" }
  | { kind: "historyFailed" };

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
};
