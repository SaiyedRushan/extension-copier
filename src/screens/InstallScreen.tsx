import { useEffect, useReducer, useRef, useState } from "react";
import { api, type Profile } from "../api";
import { ExtensionIcon } from "../ExtensionIcon";
import {
  currentItem,
  flowReducer,
  startFlow,
  unopened,
  upcomingItem,
  wantedCount,
  type FlowEvent,
  type FlowItem,
  type FlowState,
} from "../installFlow";
import { plural } from "../messages";

type Props = {
  target: Profile;
  items: FlowItem[];
  /** Ids already added in an earlier sitting, when carrying on from history. */
  alreadyAdded: string[];
  /** Ids the user said they don't want, from an earlier sitting. */
  alreadySkipped: string[];
  /** Called whenever what's added or not wanted changes, to save it to history. */
  onProgress: (added: string[], skipped: string[]) => void;
  /** True when history couldn't be saved, so closing the app would lose the picks. */
  saveFailed: boolean;
  onDone: (result: FlowState) => void;
};

const POLL_MS = 2000;

export function InstallScreen({ target, items, alreadyAdded, alreadySkipped, onProgress, saveFailed, onDone }: Props) {
  const [state, dispatch] = useReducer(flowReducer, null, () => startFlow(items, alreadyAdded, alreadySkipped));
  /** What to tell the user to press after opening Chrome themselves, or null when nothing failed. */
  const [openFailed, setOpenFailed] = useState<string | null>(null);
  const openedIndex = useRef(-1);
  const current = currentItem(state);
  const upcoming = upcomingItem(state);
  const rest = unopened(state);

  function openPage(item: FlowItem) {
    setOpenFailed(null);
    api.openStorePages(target.dir, [item.id]).catch(() => setOpenFailed(`Open ${item.name}'s page again`));
  }

  // Only moves on once Chrome has the tabs, so a failure leaves the button there to retry.
  function openAll() {
    setOpenFailed(null);
    api
      .openStorePages(
        target.dir,
        rest.map((item) => item.id),
      )
      .then(() => dispatch({ type: "openAll" }))
      .catch(() => setOpenFailed(`Open the other ${rest.length} pages at once`));
  }

  // Open the store page each time a new extension becomes current.
  useEffect(() => {
    if (!current || openedIndex.current === state.current) return;
    openedIndex.current = state.current;
    openPage(current);
    // openPage only closes over `target`, which never changes on this screen.
  }, [state.current, current]);

  // Watch the target profile for new installs until the flow ends.
  useEffect(() => {
    if (state.finished) return;
    const timer = setInterval(() => {
      api
        .installedIds(target.dir)
        .then((ids) => dispatch({ type: "installed", ids }))
        // A read can fail while Chrome is mid-write; the next poll tries again.
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [state.finished, target.dir]);

  useEffect(() => {
    onProgress(state.added, state.skipped);
    // The reducer only makes new arrays when these change; onProgress is a fresh function each render.
  }, [state.added, state.skipped]);

  useEffect(() => {
    if (state.finished) onDone(state);
  }, [state, onDone]);

  return (
    <main className="screen">
      <h1>Adding extensions to {target.name}</h1>
      <p className="muted">
        {state.added.length} of {plural(wantedCount(state), "extension", "extensions")} added
        {state.skipped.length > 0 && `, and ${state.skipped.length} you don't want`}
      </p>

      {current ? (
        <section className="card">
          <div className="row">
            <ExtensionIcon name={current.name} icon={current.icon} />
            <strong>{current.name}</strong>
          </div>
          <p>
            Click <strong>Add to Chrome</strong> on the page that just opened in {target.name}'s Chrome window. This app
            notices within about 10 seconds and opens the next one by itself.
          </p>
          <div className="buttons">
            <button className="primary" onClick={() => dispatch({ type: "next" })}>
              {upcoming ? `Open the next one: ${upcoming.name}` : "That was the last one"}
            </button>
            {rest.length >= 2 && <button onClick={openAll}>Open the other {rest.length} pages at once</button>}
            <button onClick={() => openPage(current)}>Open {current.name}'s page again</button>
            <button onClick={() => dispatch({ type: "skip", id: current.id })}>Don't add {current.name}</button>
          </div>
        </section>
      ) : (
        <section className="card">
          <p>
            Every page is open, one tab per extension, in {target.name}'s Chrome window. Click{" "}
            <strong>Add to Chrome</strong> on each tab.
          </p>
          <p className="muted">Each one is ticked below within about 10 seconds of the click.</p>
        </section>
      )}

      {saveFailed && (
        <p className="error">
          Couldn't save this list. If you close the app before you finish, you'll need to tick these again.
        </p>
      )}

      {openFailed && (
        <p className="error">
          Couldn't open Chrome. Open Chrome yourself, then press "{openFailed}".
        </p>
      )}

      <ul className="ext-list progress">
        {state.items.map((item, i) => (
          <li key={item.id}>
            <div className="row">
              <ExtensionIcon name={item.name} icon={item.icon} />
              <span className="ext-name">{item.name}</span>
              <span className={state.added.includes(item.id) ? "status done" : "status"}>
                {statusText(state, item, i)}
              </span>
              <RowButtons state={state} item={item} index={i} onOpen={openPage} dispatch={dispatch} />
            </div>
          </li>
        ))}
      </ul>

      <button className="link" onClick={() => dispatch({ type: "finish" })}>
        Stop and see what was added
      </button>
    </main>
  );
}

/** Per-row controls. The current item's controls are in the card above, so it gets none here. */
function RowButtons({
  state,
  item,
  index,
  onOpen,
  dispatch,
}: {
  state: FlowState;
  item: FlowItem;
  index: number;
  onOpen: (item: FlowItem) => void;
  dispatch: (event: FlowEvent) => void;
}) {
  if (state.added.includes(item.id) || index === state.current) return null;
  if (state.skipped.includes(item.id)) {
    return (
      <button className="small" onClick={() => dispatch({ type: "unskip", id: item.id })}>
        Put it back on the list
      </button>
    );
  }
  return (
    <>
      {index < state.current && (
        <button className="small" onClick={() => onOpen(item)}>
          Open its page
        </button>
      )}
      <button className="small" onClick={() => dispatch({ type: "skip", id: item.id })}>
        Don't add
      </button>
    </>
  );
}

function statusText(state: FlowState, item: FlowItem, index: number): string {
  if (state.added.includes(item.id)) return "✓ Added";
  if (state.skipped.includes(item.id)) return "You chose not to add it";
  if (index === state.current) return "Page open now";
  if (index < state.current) return "Waiting for Add to Chrome";
  return "Not opened yet";
}
