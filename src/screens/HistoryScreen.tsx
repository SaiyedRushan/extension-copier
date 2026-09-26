import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { removeSession, saveSession } from "../history";
import { entryWithSkip, loadHistoryEntries, type HistoryEntry } from "../historyEntries";
import { addRestLabel, loadErrorMessage, plural, startedOn } from "../messages";

type Props = {
  onBack: () => void;
  onResume: (entry: HistoryEntry) => void;
  onCopySettings: (entry: HistoryEntry) => void;
};

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; entries: HistoryEntry[] };

export function HistoryScreen({ onBack, onResume, onCopySettings }: Props) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [saveFailed, setSaveFailed] = useState(false);
  const [undoMessage, setUndoMessage] = useState<{ id: string; text: string; error: boolean } | null>(null);

  const reload = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      setLoad({ status: "ready", entries: await loadHistoryEntries() });
    } catch (error) {
      setLoad({ status: "error", message: loadErrorMessage(error) });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function remove(id: string) {
    setSaveFailed(false);
    try {
      await removeSession(id);
      setLoad((prev) =>
        prev.status === "ready" ? { ...prev, entries: prev.entries.filter((e) => e.session.id !== id) } : prev,
      );
    } catch {
      setSaveFailed(true);
    }
  }

  async function undoSettings(entry: HistoryEntry) {
    const backupId = entry.session.settingsBackupId;
    if (!backupId) return;
    setUndoMessage(null);
    try {
      await api.undoSettingsCopy(backupId);
      const session = { ...entry.session, settingsBackupId: undefined };
      await saveSession(session).catch(() => {});
      setLoad((prev) =>
        prev.status === "ready"
          ? { ...prev, entries: prev.entries.map((e) => (e.session.id === session.id ? { ...e, session } : e)) }
          : prev,
      );
      const toName = entry.target?.name ?? entry.session.to.name;
      setUndoMessage({ id: session.id, text: `Put back the settings ${toName} had before.`, error: false });
    } catch (error) {
      setUndoMessage({ id: entry.session.id, text: loadErrorMessage(error), error: true });
    }
  }

  async function setSkip(entry: HistoryEntry, id: string, skip: boolean) {
    setSaveFailed(false);
    const updated = entryWithSkip(entry, id, skip);
    try {
      await saveSession(updated.session);
      setLoad((prev) =>
        prev.status === "ready"
          ? { ...prev, entries: prev.entries.map((e) => (e.session.id === entry.session.id ? updated : e)) }
          : prev,
      );
    } catch {
      setSaveFailed(true);
    }
  }

  return (
    <main className="screen">
      <div className="top-bar">
        <button onClick={onBack}>Back</button>
        <button onClick={() => void reload()}>Check again</button>
      </div>
      <h1>Your history</h1>

      {load.status === "loading" && <p className="muted">Checking your Chrome profiles…</p>}
      {load.status === "error" && <p className="error">{load.message}</p>}
      {saveFailed && <p className="error">Couldn't save that change to your history. Try again.</p>}

      {load.status === "ready" && load.entries.length === 0 && (
        <p className="muted">
          Nothing here yet. Each time you press Add on the first screen, the extensions you ticked are saved here, so you
          can finish adding them later.
        </p>
      )}

      {load.status === "ready" &&
        load.entries.map((entry) => (
          <HistoryCard
            key={entry.session.id}
            entry={entry}
            onResume={onResume}
            onRemove={remove}
            onSkip={setSkip}
            onCopySettings={onCopySettings}
            onUndoSettings={undoSettings}
            undoMessage={undoMessage?.id === entry.session.id ? undoMessage : null}
          />
        ))}
    </main>
  );
}

function HistoryCard({
  entry,
  onResume,
  onRemove,
  onSkip,
  onCopySettings,
  onUndoSettings,
  undoMessage,
}: {
  entry: HistoryEntry;
  onResume: (entry: HistoryEntry) => void;
  onRemove: (id: string) => void;
  onSkip: (entry: HistoryEntry, id: string, skip: boolean) => void;
  onCopySettings: (entry: HistoryEntry) => void;
  onUndoSettings: (entry: HistoryEntry) => void;
  undoMessage: { text: string; error: boolean } | null;
}) {
  const { session, target, checked, added, skipped, remaining } = entry;
  const total = session.items.length;
  const wanted = total - skipped.length;
  const toName = target?.name ?? session.to.name;
  const done = remaining.length === 0;
  const notWanted = skipped.length > 0 ? `, and ${skipped.length} you don't want` : "";

  return (
    <section className="card">
      <h2>
        {plural(total, "extension", "extensions")} from {session.from.name} to {toName}
      </h2>
      <p className="muted">{startedOn(session.startedAt)}</p>

      <p className={done && wanted > 0 ? "status done" : undefined}>
        {wanted === 0
          ? "You chose not to add any of them"
          : done
            ? `✓ All ${wanted} added${notWanted}`
            : `${added.length} of ${wanted} added, ${remaining.length} still to add${notWanted}`}
      </p>

      {!target && (
        <p className="muted">The {session.to.name} profile isn't in Chrome any more, so the rest can't be added to it.</p>
      )}
      {target && !checked && (
        <p className="muted">
          Couldn't check {toName} just now, so this shows what was added the last time this app saw it. Quit Chrome and
          press Check again to see the latest.
        </p>
      )}

      <details>
        <summary>See which ones are added, or choose ones you don't want</summary>
        <ul className="ext-list">
          {session.items.map((item) => (
            <li key={item.id}>
              <div className="row">
                <span className="ext-name">{item.name}</span>
                <span className={added.includes(item.id) ? "status done" : "status"}>
                  {added.includes(item.id)
                    ? "✓ Added"
                    : skipped.includes(item.id)
                      ? "You chose not to add it"
                      : "Not added yet"}
                </span>
                {target && !added.includes(item.id) && (
                  <button className="small" onClick={() => onSkip(entry, item.id, !skipped.includes(item.id))}>
                    {skipped.includes(item.id) ? "Put it back on the list" : "Don't add"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </details>

      <div className="buttons">
        {target && !done && (
          <button className="primary" onClick={() => onResume(entry)}>
            {addRestLabel(remaining.length, wanted, toName)}
          </button>
        )}
        {target && added.length > 0 && (
          <button onClick={() => onCopySettings(entry)}>Copy their settings</button>
        )}
        {target && session.settingsBackupId && (
          <button onClick={() => onUndoSettings(entry)}>Undo the settings copy</button>
        )}
        <button onClick={() => onRemove(session.id)}>Remove from history</button>
      </div>
      {undoMessage && <p className={undoMessage.error ? "error" : "muted"}>{undoMessage.text}</p>}
    </section>
  );
}
