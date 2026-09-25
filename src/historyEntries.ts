// Joins the saved history with what Chrome has right now, for the history screen
// and the "you didn't finish" note on the first screen.

import { api, type Profile } from "./api";
import { loadHistory, sessionProgress, withSkip, type Session, type SessionItem } from "./history";

export type HistoryEntry = {
  session: Session;
  /** The target profile as Chrome has it now, or null if it's gone. */
  target: Profile | null;
  /** False when the target exists but its extensions couldn't be read, so progress is from the last save. */
  checked: boolean;
  added: string[];
  skipped: string[];
  remaining: SessionItem[];
};

export async function loadHistoryEntries(): Promise<HistoryEntry[]> {
  const [sessions, profiles] = await Promise.all([loadHistory(), api.listProfiles().catch(() => [] as Profile[])]);

  const targetDirs = [...new Set(sessions.map((s) => s.to.dir))].filter((dir) => profiles.some((p) => p.dir === dir));
  const installed = new Map<string, Set<string>>();
  await Promise.all(
    targetDirs.map(async (dir) => {
      try {
        installed.set(dir, new Set(await api.installedIds(dir)));
      } catch {
        // Left out: this entry falls back to its saved progress.
      }
    }),
  );

  return sessions.map((session) => {
    const target = profiles.find((p) => p.dir === session.to.dir) ?? null;
    const ids = installed.get(session.to.dir) ?? null;
    return { session, target, checked: ids !== null, ...sessionProgress(session, ids) };
  });
}

/** The newest copy that still has extensions left to add to a profile that still exists. */
export function unfinished(entries: HistoryEntry[]): HistoryEntry | undefined {
  return entries.find((e) => e.target && e.remaining.length > 0);
}

/** The entry after marking an extension as not wanted (or wanted again). Installed state doesn't change. */
export function entryWithSkip(entry: HistoryEntry, id: string, skip: boolean): HistoryEntry {
  const session = withSkip(entry.session, id, skip);
  return { ...entry, session, ...sessionProgress(session, new Set(entry.added)) };
}
