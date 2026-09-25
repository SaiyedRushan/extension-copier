import { describe, expect, it } from "vitest";
import {
  MAX_SESSIONS,
  newSession,
  parseHistory,
  serializeHistory,
  sessionProgress,
  upsertSession,
  withSkip,
  withoutSession,
  type Session,
} from "./history";

const from = { dir: "Default", name: "Personal" };
const to = { dir: "Profile 2", name: "Work" };
const items = [
  { id: "a", name: "A" },
  { id: "b", name: "B" },
  { id: "c", name: "C" },
];

function session(startedAt: string, id = startedAt): Session {
  return { ...newSession(from, to, items, new Date(startedAt)), id };
}

describe("history", () => {
  it("saves only the parts it needs", () => {
    const s = newSession(from, to, [{ id: "a", name: "A", icon: "data:..." } as never], new Date("2026-09-24T10:00:00Z"));
    expect(s.items).toEqual([{ id: "a", name: "A" }]);
    expect(s.startedAt).toBe("2026-09-24T10:00:00.000Z");
    expect(s.added).toEqual([]);
  });

  it("round-trips through the file format", () => {
    const list = [session("2026-09-24T10:00:00Z")];
    expect(parseHistory(serializeHistory(list))).toEqual(list);
  });

  it("treats a missing, broken or odd file as empty", () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory("{ nope")).toEqual([]);
    expect(parseHistory('{"version":1}')).toEqual([]);
    expect(parseHistory("null")).toEqual([]);
  });

  it("drops malformed entries but keeps good ones", () => {
    const good = session("2026-09-24T10:00:00Z");
    const json = JSON.stringify({ version: 1, sessions: [good, { id: 3 }, { ...good, id: "x", items: [{ id: 1 }] }] });
    expect(parseHistory(json)).toEqual([good]);
  });

  it("keeps the newest first and replaces by id", () => {
    let list = upsertSession([], session("2026-09-20T10:00:00Z", "old"));
    list = upsertSession(list, session("2026-09-24T10:00:00Z", "new"));
    expect(list.map((s) => s.id)).toEqual(["new", "old"]);

    list = upsertSession(list, { ...session("2026-09-20T10:00:00Z", "old"), added: ["a"] });
    expect(list.map((s) => s.id)).toEqual(["new", "old"]);
    expect(list[1].added).toEqual(["a"]);

    expect(withoutSession(list, "new").map((s) => s.id)).toEqual(["old"]);
  });

  it("keeps at most MAX_SESSIONS", () => {
    let list: Session[] = [];
    for (let i = 0; i < MAX_SESSIONS + 5; i++) {
      list = upsertSession(list, session(new Date(Date.UTC(2026, 0, 1 + i)).toISOString()));
    }
    expect(list).toHaveLength(MAX_SESSIONS);
    expect(list[0].startedAt).toBe(new Date(Date.UTC(2026, 0, MAX_SESSIONS + 5)).toISOString());
  });

  it("works out progress from what the target has now", () => {
    const s = { ...session("2026-09-24T10:00:00Z"), added: ["a"] };
    const now = sessionProgress(s, new Set(["b", "zzz"]));
    expect(now.added).toEqual(["b"]);
    expect(now.remaining.map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("loads older saves that have no skip list", () => {
    const { skipped: _, ...old } = session("2026-09-24T10:00:00Z");
    const [loaded] = parseHistory(JSON.stringify({ version: 1, sessions: [old] }));
    expect(loaded.skipped).toEqual([]);
  });

  it("leaves skipped ones out of what's left, unless they got installed anyway", () => {
    const s = withSkip(withSkip(session("2026-09-24T10:00:00Z"), "a", true), "c", true);
    const now = sessionProgress(s, new Set(["c"]));
    expect(now.added).toEqual(["c"]);
    expect(now.skipped).toEqual(["a"]);
    expect(now.remaining.map((i) => i.id)).toEqual(["b"]);

    expect(withSkip(s, "a", false).skipped).toEqual(["c"]);
  });

  it("falls back to the saved progress when the target can't be read", () => {
    const s = { ...session("2026-09-24T10:00:00Z"), added: ["a"] };
    expect(sessionProgress(s, null).remaining.map((i) => i.id)).toEqual(["b", "c"]);
  });
});
