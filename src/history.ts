// The user's history of copies: which extensions they picked, from which profile
// to which. Saved when they press Add and updated as extensions get added, so they
// can close the app and carry on later without ticking everything again.
//
// Progress shown to the user is always re-checked against the target profile;
// `added` is only the fallback for when that profile can't be read.

import { api } from "./api";

export type SessionProfile = { dir: string; name: string };
export type SessionItem = { id: string; name: string };

export type Session = {
  id: string;
  /** ISO timestamp. */
  startedAt: string;
  from: SessionProfile;
  to: SessionProfile;
  items: SessionItem[];
  added: string[];
  /** Ones the user said they don't want any more. Older saves don't have this. */
  skipped: string[];
};

type HistoryFile = { version: 1; sessions: Session[] };

export const MAX_SESSIONS = 30;

export function newSession(from: SessionProfile, to: SessionProfile, items: SessionItem[], now = new Date()): Session {
  return {
    id: crypto.randomUUID(),
    startedAt: now.toISOString(),
    from: { dir: from.dir, name: from.name },
    to: { dir: to.dir, name: to.name },
    items: items.map(({ id, name }) => ({ id, name })),
    added: [],
    skipped: [],
  };
}

/** Reads the saved file, dropping anything malformed rather than failing. */
export function parseHistory(json: string | null): Session[] {
  if (!json) return [];
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const sessions = (data as Partial<HistoryFile> | null)?.sessions;
  if (!Array.isArray(sessions)) return [];
  return sortNewestFirst(sessions.filter(isSession).map((s) => ({ ...s, skipped: s.skipped ?? [] })));
}

export function serializeHistory(sessions: Session[]): string {
  const file: HistoryFile = { version: 1, sessions };
  return JSON.stringify(file);
}

/** Adds or replaces a session, newest first, keeping at most MAX_SESSIONS. */
export function upsertSession(sessions: Session[], session: Session): Session[] {
  const others = sessions.filter((s) => s.id !== session.id);
  return sortNewestFirst([session, ...others]).slice(0, MAX_SESSIONS);
}

export function withoutSession(sessions: Session[], id: string): Session[] {
  return sessions.filter((s) => s.id !== id);
}

/**
 * What's added, what's left, and what the user doesn't want. `installed` is the
 * target profile's current extensions, or null when it couldn't be read.
 * Something installed counts as added even if it was marked as not wanted.
 */
export function sessionProgress(session: Session, installed: Set<string> | null) {
  const isAdded = (id: string) => (installed ? installed.has(id) : session.added.includes(id));
  const added = session.items.filter((item) => isAdded(item.id)).map((item) => item.id);
  const skipped = session.skipped.filter((id) => !added.includes(id));
  return {
    added,
    skipped,
    remaining: session.items.filter((item) => !added.includes(item.id) && !skipped.includes(item.id)),
  };
}

/** Marks an extension as not wanted, or wanted again. */
export function withSkip(session: Session, id: string, skip: boolean): Session {
  const others = session.skipped.filter((s) => s !== id);
  return { ...session, skipped: skip ? [...others, id] : others };
}

function sortNewestFirst(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

function isSession(value: unknown): value is Session {
  const s = value as Session;
  const isProfile = (p: unknown) =>
    typeof p === "object" && p !== null && typeof (p as SessionProfile).dir === "string" &&
    typeof (p as SessionProfile).name === "string";
  return (
    typeof s === "object" &&
    s !== null &&
    typeof s.id === "string" &&
    typeof s.startedAt === "string" &&
    isProfile(s.from) &&
    isProfile(s.to) &&
    Array.isArray(s.items) &&
    s.items.every((i) => typeof i?.id === "string" && typeof i?.name === "string") &&
    Array.isArray(s.added) &&
    s.added.every((id) => typeof id === "string") &&
    (s.skipped === undefined || (Array.isArray(s.skipped) && s.skipped.every((id) => typeof id === "string")))
  );
}

// Storage. Every change re-reads the file and goes through one queue, so two
// saves close together can't overwrite each other.

let queue: Promise<unknown> = Promise.resolve();

export async function loadHistory(): Promise<Session[]> {
  return parseHistory(await api.readHistory());
}

function update(change: (sessions: Session[]) => Session[]): Promise<void> {
  const run = queue.then(async () => {
    const sessions = await loadHistory();
    await api.writeHistory(serializeHistory(change(sessions)));
  });
  queue = run.catch(() => {});
  return run;
}

export function saveSession(session: Session): Promise<void> {
  return update((sessions) => upsertSession(sessions, session));
}

export function removeSession(id: string): Promise<void> {
  return update((sessions) => withoutSession(sessions, id));
}
