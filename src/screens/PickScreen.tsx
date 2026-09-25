import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Extension, type Profile } from "../api";
import { ExtensionIcon } from "../ExtensionIcon";
import { loadHistoryEntries, unfinished, type HistoryEntry } from "../historyEntries";
import type { FlowItem } from "../installFlow";
import { addRestLabel, loadErrorMessage, plural, profileLabel } from "../messages";

type Props = {
  onStart: (from: Profile, to: Profile, items: FlowItem[]) => void;
  onResume: (entry: HistoryEntry) => void;
  onShowHistory: () => void;
};

/** Per profile: its extensions, or the message to show when they couldn't be read. */
type ProfileExtensions = Record<string, Extension[] | { error: string }>;

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; profiles: Profile[]; extensions: ProfileExtensions };

export function PickScreen({ onStart, onResume, onShowHistory }: Props) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [pending, setPending] = useState<HistoryEntry | undefined>();
  const [fromDir, setFromDir] = useState("");
  const [toDir, setToDir] = useState("");
  const [targetIds, setTargetIds] = useState<Set<string> | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const reload = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      const [installed, profiles] = await Promise.all([api.chromeInstalled(), api.listProfiles()]);
      if (!installed) {
        setLoad({ status: "error", message: loadErrorMessage({ kind: "chromeNotFound" }) });
        return;
      }
      if (profiles.length < 2) {
        setLoad({
          status: "error",
          message:
            "You only have one Chrome profile, so there's nowhere to copy to. " +
            "In Chrome, click your picture at the top right, then Add, to make a second one. Then press Check again.",
        });
        return;
      }
      const results = await Promise.allSettled(profiles.map((p) => api.listExtensions(p.dir)));
      const extensions: ProfileExtensions = {};
      profiles.forEach((p, i) => {
        const result = results[i];
        extensions[p.dir] =
          result.status === "fulfilled" ? result.value : { error: loadErrorMessage(result.reason, profiles) };
      });
      setLoad({ status: "ready", profiles, extensions });
      // Keep the user's picks across a reload when the profiles still exist.
      setFromDir((prev) => (profiles.some((p) => p.dir === prev) ? prev : profiles[0].dir));
      setToDir((prev) => (profiles.some((p) => p.dir === prev) ? prev : profiles[1].dir));
    } catch (error) {
      setLoad({ status: "error", message: loadErrorMessage(error) });
    }
  }, []);

  useEffect(() => {
    void reload();
    // The note about an unfinished list is a bonus; if history can't be read, just leave it out.
    loadHistoryEntries()
      .then((entries) => setPending(unfinished(entries)))
      .catch(() => {});
  }, [reload]);

  const profiles = load.status === "ready" ? load.profiles : [];
  const from = profiles.find((p) => p.dir === fromDir);
  const to = profiles.find((p) => p.dir === toDir);
  const sourceEntry = load.status === "ready" ? load.extensions[fromDir] : undefined;
  const sourceError = sourceEntry && !Array.isArray(sourceEntry) ? sourceEntry.error : null;
  const sourceList = useMemo(() => (Array.isArray(sourceEntry) ? sourceEntry : []), [sourceEntry]);
  const copyable = sourceList.filter((e) => e.copyable);
  const notCopyable = sourceList.filter((e) => !e.copyable);

  // Whenever the pair of profiles changes, find what the target already has and
  // tick everything else.
  useEffect(() => {
    if (!toDir || load.status !== "ready") return;
    let cancelled = false;
    setTargetIds(null);
    setTargetError(null);
    api
      .installedIds(toDir)
      .then((ids) => {
        if (cancelled) return;
        const have = new Set(ids);
        setTargetIds(have);
        setSelected(new Set(sourceList.filter((e) => e.copyable && !have.has(e.id)).map((e) => e.id)));
      })
      .catch((error) => {
        if (!cancelled) setTargetError(loadErrorMessage(error, profiles));
      });
    return () => {
      cancelled = true;
    };
    // `profiles` only feeds the error text, so it isn't a dependency.
  }, [toDir, sourceList, load.status]);

  function changeFrom(dir: string) {
    setFromDir(dir);
    if (dir === toDir) setToDir(profiles.find((p) => p.dir !== dir)?.dir ?? "");
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (load.status === "loading") {
    return (
      <main className="screen">
        <p className="muted">Reading your Chrome profiles…</p>
      </main>
    );
  }

  if (load.status === "error") {
    return (
      <main className="screen">
        <h1>Copy extensions to another Chrome profile</h1>
        <p className="error">{load.message}</p>
        <button className="primary" onClick={() => void reload()}>
          Check again
        </button>
      </main>
    );
  }

  const available = targetIds ? copyable.filter((e) => !targetIds.has(e.id)) : [];
  const picked = available.filter((e) => selected.has(e.id));
  const toName = to?.name ?? "";
  const fromName = from?.name ?? "";

  function countFor(profile: Profile): string {
    const entry = load.status === "ready" ? load.extensions[profile.dir] : undefined;
    if (!Array.isArray(entry)) return "couldn't read its extensions";
    return plural(entry.filter((e) => e.copyable).length, "extension", "extensions");
  }

  function start() {
    if (!from || !to) return;
    onStart(
      from,
      to,
      picked.map((e) => ({ id: e.id, name: e.name, icon: e.icon })),
    );
  }

  return (
    <main className="screen with-footer">
      <div className="title-row">
        <h1>Copy extensions to another Chrome profile</h1>
        <button className="link" onClick={onShowHistory}>
          See your history
        </button>
      </div>

      {pending?.target && (
        <div className="notice">
          <p>
            You still have {plural(pending.remaining.length, "extension", "extensions")} to add to{" "}
            {pending.target.name} from a list you picked earlier.
          </p>
          <button className="primary" onClick={() => onResume(pending)}>
            {addRestLabel(
              pending.remaining.length,
              pending.session.items.length - pending.skipped.length,
              pending.target.name,
            )}
          </button>
        </div>
      )}

      <div className="pickers">
        <label>
          <span>Copy from</span>
          <select value={fromDir} onChange={(e) => changeFrom(e.target.value)}>
            {profiles.map((p) => (
              <option key={p.dir} value={p.dir}>
                {profileLabel(p, profiles)}, {countFor(p)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Copy to</span>
          <select value={toDir} onChange={(e) => setToDir(e.target.value)}>
            {profiles
              .filter((p) => p.dir !== fromDir)
              .map((p) => (
                <option key={p.dir} value={p.dir}>
                  {profileLabel(p, profiles)}
                </option>
              ))}
          </select>
        </label>
      </div>

      {sourceError ? (
        <section>
          <p className="error">{sourceError}</p>
          <button onClick={() => void reload()}>Check again</button>
        </section>
      ) : targetError ? (
        <section>
          <p className="error">{targetError}</p>
          <button onClick={() => void reload()}>Check again</button>
        </section>
      ) : targetIds === null ? (
        <p className="muted">Checking what {toName} already has…</p>
      ) : (
        <>
          {copyable.length === 0 ? (
            <p className="muted">{fromName} has no extensions from the Chrome Web Store to copy.</p>
          ) : available.length === 0 ? (
            <p className="muted">
              {toName} already has every extension from {fromName}.
            </p>
          ) : (
            <section>
              <div className="list-head">
                <h2>Tick the extensions you want in {toName}</h2>
                <div className="list-actions">
                  <button className="link" onClick={() => setSelected(new Set(available.map((e) => e.id)))}>
                    Select all
                  </button>
                  <button className="link" onClick={() => setSelected(new Set())}>
                    Select none
                  </button>
                </div>
              </div>
              <ul className="ext-list">
                {copyable.map((ext) => {
                  const already = targetIds.has(ext.id);
                  return (
                    <li key={ext.id} className={already ? "disabled" : undefined}>
                      <label>
                        <input
                          type="checkbox"
                          checked={!already && selected.has(ext.id)}
                          disabled={already}
                          onChange={() => toggle(ext.id)}
                        />
                        <ExtensionIcon name={ext.name} icon={ext.icon} />
                        <span className="ext-name">{ext.name}</span>
                        {already && <span className="badge">Already in {toName}</span>}
                        {!ext.enabled && <span className="badge">Turned off in {fromName}</span>}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {notCopyable.length > 0 && (
            <details className="cant-copy">
              <summary>{plural(notCopyable.length, "extension can't", "extensions can't")} be copied</summary>
              <p className="muted">
                These didn't come from the Chrome Web Store, so there's no store page to add them from.
              </p>
              <ul className="ext-list">
                {notCopyable.map((ext) => (
                  <li key={ext.id} className="disabled">
                    <div className="row">
                      <ExtensionIcon name={ext.name} icon={ext.icon} />
                      <span className="ext-name">{ext.name}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {available.length > 0 && !sourceError && !targetError && (
      <footer className="footer">
        {picked.length > 0 && (
          <p className="muted">
            Chrome will open each extension's store page in {toName}'s window. You click Add to Chrome on each one,
            and this app opens the next. You can also open them all at once.
          </p>
        )}
        <button className="primary" disabled={picked.length === 0} onClick={start}>
          {picked.length === 0
            ? "Tick at least one extension"
            : `Add ${plural(picked.length, "extension", "extensions")} to ${toName}`}
        </button>
      </footer>
      )}
    </main>
  );
}
