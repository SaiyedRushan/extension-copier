import { describe, expect, it } from "vitest";
import {
  currentItem,
  flowReducer,
  notAdded,
  notWanted,
  startFlow,
  stillWaiting,
  unopened,
  upcomingItem,
  wantedCount,
} from "./installFlow";

const items = ["a", "b", "c"].map((id) => ({ id, name: id.toUpperCase(), icon: null }));

describe("install flow", () => {
  it("starts on the first extension", () => {
    const state = startFlow(items);
    expect(currentItem(state)?.id).toBe("a");
    expect(upcomingItem(state)?.id).toBe("b");
    expect(state.finished).toBe(false);
  });

  it("carries on from history, starting at the first one not added", () => {
    const state = startFlow(items, ["a", "c", "zzz"]);
    expect(state.added).toEqual(["a", "c"]);
    expect(currentItem(state)?.id).toBe("b");
    expect(upcomingItem(state)).toBeUndefined();
    expect(startFlow(items, ["a", "b", "c"]).finished).toBe(true);
  });

  it("finishes straight away with nothing to add", () => {
    expect(startFlow([]).finished).toBe(true);
  });

  it("moves on when the current extension shows up as installed", () => {
    const state = flowReducer(startFlow(items), { type: "installed", ids: ["a", "zzz"] });
    expect(state.added).toEqual(["a"]);
    expect(currentItem(state)?.id).toBe("b");
  });

  it("ignores polls that change nothing", () => {
    const start = startFlow(items);
    expect(flowReducer(start, { type: "installed", ids: ["zzz"] })).toBe(start);
  });

  it("stays put when a different extension shows up, and skips it later", () => {
    let state = flowReducer(startFlow(items), { type: "installed", ids: ["b"] });
    expect(currentItem(state)?.id).toBe("a");
    expect(upcomingItem(state)?.id).toBe("c");

    state = flowReducer(state, { type: "installed", ids: ["a", "b"] });
    expect(currentItem(state)?.id).toBe("c");
  });

  it("keeps watching extensions the user moved past", () => {
    let state = flowReducer(startFlow(items), { type: "next" });
    expect(currentItem(state)?.id).toBe("b");
    expect(stillWaiting(state).map((i) => i.id)).toEqual(["a"]);

    state = flowReducer(state, { type: "installed", ids: ["a"] });
    expect(state.added).toEqual(["a"]);
    expect(currentItem(state)?.id).toBe("b");
    expect(stillWaiting(state)).toEqual([]);
  });

  it("waits after the last page until everything is seen or the user finishes", () => {
    let state = startFlow(items);
    state = flowReducer(state, { type: "next" });
    state = flowReducer(state, { type: "next" });
    state = flowReducer(state, { type: "next" });
    expect(currentItem(state)).toBeUndefined();
    expect(state.finished).toBe(false);
    expect(stillWaiting(state).map((i) => i.id)).toEqual(["a", "b", "c"]);

    state = flowReducer(state, { type: "finish" });
    expect(state.finished).toBe(true);
    expect(notAdded(state).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("finishes by itself once everything is added", () => {
    const state = flowReducer(startFlow(items), { type: "installed", ids: ["a", "b", "c"] });
    expect(state.finished).toBe(true);
    expect(notAdded(state)).toEqual([]);
  });

  it("ignores events after finishing", () => {
    const done = flowReducer(startFlow(items), { type: "finish" });
    expect(flowReducer(done, { type: "installed", ids: ["a"] })).toBe(done);
  });

  it("opening all pages leaves nothing current and watches every item", () => {
    let state = flowReducer(startFlow(items), { type: "installed", ids: ["b"] });
    expect(unopened(state).map((i) => i.id)).toEqual(["c"]);

    state = flowReducer(state, { type: "openAll" });
    expect(currentItem(state)).toBeUndefined();
    expect(unopened(state)).toEqual([]);
    expect(stillWaiting(state).map((i) => i.id)).toEqual(["a", "c"]);
    expect(state.finished).toBe(false);

    state = flowReducer(state, { type: "installed", ids: ["a", "b", "c"] });
    expect(state.finished).toBe(true);
  });

  describe("don't want", () => {
    it("skipping the current one moves to the next and leaves it out of what's left", () => {
      const state = flowReducer(startFlow(items), { type: "skip", id: "a" });
      expect(currentItem(state)?.id).toBe("b");
      expect(notWanted(state).map((i) => i.id)).toEqual(["a"]);
      expect(notAdded(state).map((i) => i.id)).toEqual(["b", "c"]);
      expect(stillWaiting(state)).toEqual([]);
      expect(wantedCount(state)).toBe(2);
    });

    it("skipping a later one takes it out of the queue", () => {
      const state = flowReducer(startFlow(items), { type: "skip", id: "b" });
      expect(currentItem(state)?.id).toBe("a");
      expect(upcomingItem(state)?.id).toBe("c");
      expect(unopened(state).map((i) => i.id)).toEqual(["c"]);
    });

    it("ignores skipping something added, unknown or already skipped", () => {
      const added = flowReducer(startFlow(items), { type: "installed", ids: ["a"] });
      expect(flowReducer(added, { type: "skip", id: "a" })).toBe(added);
      expect(flowReducer(added, { type: "skip", id: "zzz" })).toBe(added);
      const skipped = flowReducer(added, { type: "skip", id: "c" });
      expect(flowReducer(skipped, { type: "skip", id: "c" })).toBe(skipped);
    });

    it("finishes once everything is added or skipped", () => {
      let state = flowReducer(startFlow(items), { type: "installed", ids: ["a", "b"] });
      state = flowReducer(state, { type: "skip", id: "c" });
      expect(state.finished).toBe(true);
    });

    it("putting one back makes it wanted again", () => {
      let state = flowReducer(startFlow(items), { type: "skip", id: "a" });
      state = flowReducer(state, { type: "unskip", id: "a" });
      expect(state.skipped).toEqual([]);
      expect(stillWaiting(state).map((i) => i.id)).toEqual(["a"]);
      expect(currentItem(state)?.id).toBe("b");
    });

    it("counts a skipped one as added if it gets installed anyway", () => {
      let state = flowReducer(startFlow(items), { type: "skip", id: "c" });
      state = flowReducer(state, { type: "installed", ids: ["c"] });
      expect(state.added).toEqual(["c"]);
      expect(state.skipped).toEqual([]);
    });

    it("carries skips over from history", () => {
      const state = startFlow(items, ["b"], ["a", "b"]);
      expect(state.added).toEqual(["b"]);
      expect(state.skipped).toEqual(["a"]);
      expect(currentItem(state)?.id).toBe("c");
    });
  });
});
