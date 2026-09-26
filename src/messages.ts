// Every piece of text built from data lives here, so the wording can be checked in one place.

import { isAppError, type Profile } from "./api";

export type Platform = "mac" | "windows" | "linux";

/** Which system the app is running on, from the web view's user agent. */
export function currentPlatform(userAgent = navigator.userAgent): Platform {
  if (/Windows/.test(userAgent)) return "windows";
  if (/Mac/.test(userAgent)) return "mac";
  return "linux";
}

/** How to fully quit Chrome. On Windows, closing the windows can leave it running in the background. */
export function howToQuitChrome(platform = currentPlatform()): string {
  return platform === "mac"
    ? "Click on Chrome and press ⌘Q."
    : "In Chrome, open the menu (the three dots at the top right) and choose Exit.";
}

const computerName = (platform = currentPlatform()) => (platform === "mac" ? "this Mac" : "this computer");

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "Rushi (rushi@gmail.com)". Adds Chrome's folder name when two profiles would read the same. */
export function profileLabel(profile: Profile, all: Profile[]): string {
  const base = profile.email ? `${profile.name} (${profile.email})` : profile.name;
  const clashes = all.filter((p) => (p.email ? `${p.name} (${p.email})` : p.name) === base).length > 1;
  return clashes ? `${base}, folder "${profile.dir}"` : base;
}

export function loadErrorMessage(error: unknown, profiles: Profile[] = []): string {
  if (!isAppError(error)) {
    return "Couldn't read Chrome's data. Press Check again. If it happens again, quit Chrome first.";
  }
  switch (error.kind) {
    case "chromeNotFound":
      return `Google Chrome isn't set up on ${computerName()}. Install Chrome and open it once, then press Check again.`;
    case "localStateUnreadable":
      return "Couldn't read Chrome's list of profiles. Quit Chrome, then press Check again.";
    case "prefsUnreadable": {
      const name = profiles.find((p) => p.dir === error.profile)?.name ?? error.profile;
      return `Couldn't read the extensions in ${name}. Quit Chrome, then press Check again.`;
    }
    case "profileNotFound":
      return "That profile isn't in Chrome any more. Press Check again to reload your profiles.";
    case "badExtensionId":
    case "launchFailed":
      return "Couldn't open Chrome. Open Chrome yourself, then press Check again.";
    case "historyFailed":
      return "Couldn't read your history. Press Check again.";
    case "chromeRunning":
      return `Chrome is still open. ${howToQuitChrome()} Then try again.`;
    case "settingsCopyFailed":
      return "Couldn't finish copying the settings. Anything that didn't copy was put back as it was. Try again.";
    case "backupNotFound":
      return "The old settings to put back aren't there any more, so this can't be undone.";
  }
}

/** Label for the button that carries on with an earlier list. */
export function addRestLabel(remaining: number, total: number, toName: string): string {
  if (remaining === 1) return total === 1 ? `Add it to ${toName}` : `Add the last one to ${toName}`;
  if (remaining === total) return `Add all ${remaining} to ${toName}`;
  return `Add the other ${remaining} to ${toName}`;
}

/** "Started 24 Sep at 10:40 pm", in the user's own date format. */
export function startedOn(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `Started ${day} at ${time}`;
}
