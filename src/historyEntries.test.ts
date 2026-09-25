import { describe, expect, it } from "vitest";
import { newSession } from "./history";
import { entryWithSkip, unfinished, type HistoryEntry } from "./historyEntries";

const items = ["a", "b", "c"].map((id) => ({ id, name: id.toUpperCase() }));
const target = { dir: "Profile 2", name: "Work", email: null };

function entry(): HistoryEntry {
  const session = { ...newSession({ dir: "Default", name: "Personal" }, target, items), added: ["a"] };
  return { session, target, checked: true, added: ["a"], skipped: [], remaining: items.slice(1) };
}

describe("history entries", () => {
  it("skipping takes an extension out of what's left, and putting it back returns it", () => {
    const skipped = entryWithSkip(entry(), "b", true);
    expect(skipped.session.skipped).toEqual(["b"]);
    expect(skipped.skipped).toEqual(["b"]);
    expect(skipped.remaining.map((i) => i.id)).toEqual(["c"]);
    expect(skipped.added).toEqual(["a"]);

    const back = entryWithSkip(skipped, "b", false);
    expect(back.remaining.map((i) => i.id)).toEqual(["b", "c"]);
  });

  it("a list whose rest you don't want doesn't count as unfinished", () => {
    const all = entryWithSkip(entryWithSkip(entry(), "b", true), "c", true);
    expect(unfinished([all])).toBeUndefined();
    expect(unfinished([entry()])?.session.id).toBeDefined();
  });
});
