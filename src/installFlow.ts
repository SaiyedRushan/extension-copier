// The guided install, as a pure reducer. The screen opens a store page whenever
// `current` changes and feeds in the target profile's installed ids every poll.
//
// Moving on never waits for detection: Chrome can take ~10 seconds to write a new
// install to disk, so the user can press "next" straight after clicking Add to
// Chrome, and every item keeps being watched until the flow ends.
//
// Skipped items are ones the user said they don't want any more. They're never
// opened, don't count as unfinished, and can be put back.

export type FlowItem = { id: string; name: string; icon: string | null };

export type FlowState = {
  items: FlowItem[];
  /** Index of the extension whose page is open now. items.length once every page has been opened. */
  current: number;
  added: string[];
  skipped: string[];
  finished: boolean;
};

export type FlowEvent =
  | { type: "installed"; ids: string[] }
  | { type: "next" }
  /** Every remaining page has been opened at once; nothing is current any more. */
  | { type: "openAll" }
  | { type: "skip"; id: string }
  | { type: "unskip"; id: string }
  | { type: "finish" };

/** `alreadyAdded` and `alreadySkipped` are for carrying on from history. */
export function startFlow(items: FlowItem[], alreadyAdded: string[] = [], alreadySkipped: string[] = []): FlowState {
  const ids = items.map((item) => item.id);
  const added = ids.filter((id) => alreadyAdded.includes(id));
  const skipped = ids.filter((id) => alreadySkipped.includes(id) && !added.includes(id));
  const first = items.findIndex((item) => isOpenable(item.id, added, skipped));
  return settle({
    items,
    current: first === -1 ? items.length : first,
    added,
    skipped,
    finished: items.length === 0,
  });
}

export function flowReducer(state: FlowState, event: FlowEvent): FlowState {
  if (state.finished) return state;

  switch (event.type) {
    case "installed": {
      const seen = new Set(event.ids);
      const newlyAdded = state.items
        .map((item) => item.id)
        .filter((id) => seen.has(id) && !state.added.includes(id));
      if (newlyAdded.length === 0) return state;

      const added = [...state.added, ...newlyAdded];
      // Installing it anyway overrides "don't want".
      const skipped = state.skipped.filter((id) => !newlyAdded.includes(id));
      return settle(moveOnIfCurrentIsDone({ ...state, added, skipped }));
    }
    case "next":
      return settle({ ...state, current: nextOpen(state.items, state.current, state.added, state.skipped) });
    case "openAll":
      return { ...state, current: state.items.length };
    case "skip": {
      const known = state.items.some((item) => item.id === event.id);
      if (!known || state.added.includes(event.id) || state.skipped.includes(event.id)) return state;
      return settle(moveOnIfCurrentIsDone({ ...state, skipped: [...state.skipped, event.id] }));
    }
    case "unskip":
      if (!state.skipped.includes(event.id)) return state;
      return { ...state, skipped: state.skipped.filter((id) => id !== event.id) };
    case "finish":
      return { ...state, finished: true };
  }
}

function isOpenable(id: string, added: string[], skipped: string[]): boolean {
  return !added.includes(id) && !skipped.includes(id);
}

function moveOnIfCurrentIsDone(state: FlowState): FlowState {
  const item = state.items[state.current];
  if (!item || isOpenable(item.id, state.added, state.skipped)) return state;
  return { ...state, current: nextOpen(state.items, state.current, state.added, state.skipped) };
}

/** The next index after `from` that's neither added nor skipped, or items.length. */
function nextOpen(items: FlowItem[], from: number, added: string[], skipped: string[]): number {
  for (let i = from + 1; i < items.length; i++) {
    if (isOpenable(items[i].id, added, skipped)) return i;
  }
  return items.length;
}

/** Ends the flow by itself once everything is either added or skipped. */
function settle(state: FlowState): FlowState {
  const allDone = state.items.every((item) => !isOpenable(item.id, state.added, state.skipped));
  return allDone ? { ...state, current: state.items.length, finished: true } : state;
}

export function currentItem(state: FlowState): FlowItem | undefined {
  return state.items[state.current];
}

/** The item after the current one that still needs adding, for the "next" button label. */
export function upcomingItem(state: FlowState): FlowItem | undefined {
  return state.items[nextOpen(state.items, state.current, state.added, state.skipped)];
}

/** Items whose pages were opened (or passed) but that haven't shown up as installed yet. */
export function stillWaiting(state: FlowState): FlowItem[] {
  return state.items.filter((item, i) => i < state.current && isOpenable(item.id, state.added, state.skipped));
}

/** Items after the current one that haven't been opened and aren't added or skipped. */
export function unopened(state: FlowState): FlowItem[] {
  return state.items.filter((item, i) => i > state.current && isOpenable(item.id, state.added, state.skipped));
}

/** Items the user still wanted but that didn't get added. */
export function notAdded(state: FlowState): FlowItem[] {
  return state.items.filter((item) => isOpenable(item.id, state.added, state.skipped));
}

export function notWanted(state: FlowState): FlowItem[] {
  return state.items.filter((item) => state.skipped.includes(item.id));
}

/** How many the user still wants, added or not. */
export function wantedCount(state: FlowState): number {
  return state.items.length - state.skipped.length;
}
