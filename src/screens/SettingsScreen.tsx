import { useEffect, useState, type ReactNode } from "react";
import { api, type CopyResult, type Profile, type SettingsPreview } from "../api";
import { ExtensionIcon } from "../ExtensionIcon";
import { saveSession, type Session } from "../history";
import type { FlowItem } from "../installFlow";
import { loadErrorMessage, plural } from "../messages";

type Props = {
  session: Session;
  target: Profile;
  /** Extensions already installed in the target, with icons when available. */
  items: FlowItem[];
  /** Label for the button that leaves this screen, e.g. "Back to your history". */
  backLabel: string;
  onBack: () => void;
};

type Step =
  | { name: "loading" }
  | { name: "pick"; previews: SettingsPreview[] }
  | { name: "copying" }
  | { name: "copied"; result: CopyResult }
  | { name: "undone" };

const CHROME_POLL_MS = 1500;

export function SettingsScreen({ session, target, items, backLabel, onBack }: Props) {
  const [step, setStep] = useState<Step>({ name: "loading" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [chromeOpen, setChromeOpen] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fromName = session.from.name;
  const toName = target.name;

  useEffect(() => {
    api
      .settingsPreview(
        session.from.dir,
        items.map((item) => item.id),
      )
      .then((previews) => {
        setSelected(new Set(previews.filter((p) => p.hasData).map((p) => p.id)));
        setStep({ name: "pick", previews });
      })
      .catch((e) => {
        setError(loadErrorMessage(e));
        setStep({ name: "pick", previews: [] });
      });
  }, [session.from.dir, items]);

  // Copying needs Chrome closed, so keep checking while there's something to press.
  const needsChromeClosed = step.name === "pick" || step.name === "copied";
  useEffect(() => {
    if (!needsChromeClosed) return;
    const check = () =>
      api
        .chromeRunning()
        .then(setChromeOpen)
        .catch(() => setChromeOpen(null));
    void check();
    const timer = setInterval(check, CHROME_POLL_MS);
    return () => clearInterval(timer);
  }, [needsChromeClosed]);

  async function copy(ids: string[]) {
    setError(null);
    setStep({ name: "copying" });
    try {
      const result = await api.copySettings(session.from.dir, target.dir, ids);
      setStep({ name: "copied", result });
      // Remember the backup so the copy can be undone later from history.
      if (result.copied.length > 0) {
        await saveSession({ ...session, settingsBackupId: result.backupId }).catch(() => {});
      }
    } catch (e) {
      setError(loadErrorMessage(e));
      const previews = await api.settingsPreview(session.from.dir, items.map((i) => i.id)).catch(() => []);
      setStep({ name: "pick", previews });
    }
  }

  async function undo(backupId: string) {
    setError(null);
    try {
      await api.undoSettingsCopy(backupId);
      await saveSession({ ...session, settingsBackupId: undefined }).catch(() => {});
      setStep({ name: "undone" });
    } catch (e) {
      setError(loadErrorMessage(e));
    }
  }

  const nameOf = (id: string) => items.find((item) => item.id === id)?.name ?? id;

  const chromeNotice = chromeOpen && (
    <div className="notice">
      <p>
        <strong>Quit Chrome to continue.</strong> Chrome keeps these files locked while it's open. Click on Chrome and
        press ⌘Q. This screen notices when it's closed.
      </p>
    </div>
  );

  return (
    <main className="screen with-footer">
      <h1>
        Copy settings from {fromName} to {toName}
      </h1>
      {error && <p className="error">{error}</p>}

      {step.name === "loading" && <p className="muted">Checking what each extension has saved…</p>}

      {step.name === "copying" && <p className="muted">Copying settings…</p>}

      {step.name === "pick" && (
        <PickSettings
          previews={step.previews}
          items={items}
          selected={selected}
          setSelected={setSelected}
          toName={toName}
          chromeNotice={chromeNotice}
          // If the check itself fails, don't block: the copy checks again before writing anything.
          chromeOpen={chromeOpen === true}
          onCopy={() => void copy([...selected])}
          backLabel={backLabel}
          onBack={onBack}
        />
      )}

      {step.name === "copied" && (
        <section>
          {step.result.copied.length > 0 ? (
            <p>
              Copied the settings of {plural(step.result.copied.length, "extension", "extensions")} to {toName}. You can
              open Chrome again now.
            </p>
          ) : (
            <p>Nothing was copied. The extensions you picked aren't in {toName} any more.</p>
          )}
          {step.result.failed.length > 0 && (
            <p className="error">
              Couldn't copy the settings of {step.result.failed.map(nameOf).join(", ")}. What {toName} had for{" "}
              {step.result.failed.length === 1 ? "it" : "them"} before was put back.
            </p>
          )}
          {step.result.copied.length > 0 && (
            <p className="muted">
              If something looks wrong in {toName}, quit Chrome and press Undo. That puts back the settings {toName} had
              before.
            </p>
          )}
          {step.result.copied.length > 0 && chromeNotice}
          <div className="buttons">
            <button className="primary" onClick={onBack}>
              {backLabel}
            </button>
            {step.result.copied.length > 0 && (
              <button disabled={chromeOpen === true} onClick={() => void undo(step.result.backupId)}>
                Undo: put back {toName}'s old settings
              </button>
            )}
          </div>
        </section>
      )}

      {step.name === "undone" && (
        <section>
          <p>Put back the settings {toName} had before. You can open Chrome again now.</p>
          <button className="primary" onClick={onBack}>
            {backLabel}
          </button>
        </section>
      )}
    </main>
  );
}

function PickSettings({
  previews,
  items,
  selected,
  setSelected,
  toName,
  chromeNotice,
  chromeOpen,
  onCopy,
  backLabel,
  onBack,
}: {
  previews: SettingsPreview[];
  items: FlowItem[];
  selected: Set<string>;
  setSelected: (next: Set<string>) => void;
  toName: string;
  chromeNotice: ReactNode;
  chromeOpen: boolean;
  onCopy: () => void;
  backLabel: string;
  onBack: () => void;
}) {
  const withData = previews.filter((p) => p.hasData);
  const anyPartial = withData.some((p) => p.partial);
  const count = withData.filter((p) => selected.has(p.id)).length;

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  if (withData.length === 0) {
    return (
      <section>
        <p className="muted">None of these extensions have saved settings to copy.</p>
        <button onClick={onBack}>{backLabel}</button>
      </section>
    );
  }

  return (
    <>
      <p>
        This copies what each extension has saved, like your Dark Reader site list or your Tampermonkey scripts. Site
        access you gave an extension and whether it runs in Incognito aren't copied.
      </p>
      {anyPartial && (
        <p className="muted">
          Extensions marked "Only partly" also keep some data in storage Chrome shares between all sites, which can't be
          copied. You may need to sign in to them again or redo a setting or two.
        </p>
      )}

      {chromeNotice}

      <div className="list-head">
        <h2>Tick the extensions whose settings you want in {toName}</h2>
        <div className="list-actions">
          <button className="link" onClick={() => setSelected(new Set(withData.map((p) => p.id)))}>
            Select all
          </button>
          <button className="link" onClick={() => setSelected(new Set())}>
            Select none
          </button>
        </div>
      </div>
      <ul className="ext-list">
        {previews.map((preview) => {
          const item = items.find((i) => i.id === preview.id);
          const name = item?.name ?? preview.id;
          return (
            <li key={preview.id} className={preview.hasData ? undefined : "disabled"}>
              <label>
                <input
                  type="checkbox"
                  checked={preview.hasData && selected.has(preview.id)}
                  disabled={!preview.hasData}
                  onChange={() => toggle(preview.id)}
                />
                <ExtensionIcon name={name} icon={item?.icon ?? null} />
                <span className="ext-name">{name}</span>
                {!preview.hasData && <span className="badge">Nothing saved to copy</span>}
                {preview.hasData && preview.partial && <span className="badge">Only partly</span>}
              </label>
            </li>
          );
        })}
      </ul>

      <footer className="footer">
        {count > 0 && (
          <p className="muted">
            Anything these extensions have saved in {toName} so far gets replaced. The app keeps a copy of it, so you can
            undo this.
          </p>
        )}
        <div className="buttons">
          <button onClick={onBack}>{backLabel}</button>
          <button className="primary" disabled={count === 0 || chromeOpen} onClick={onCopy}>
            {count === 0
              ? "Tick at least one extension"
              : chromeOpen
                ? "Quit Chrome first"
                : `Copy settings for ${plural(count, "extension", "extensions")} to ${toName}`}
          </button>
        </div>
      </footer>
    </>
  );
}
