import { useState } from "react";
import { api, type Profile } from "../api";
import { ExtensionIcon } from "../ExtensionIcon";
import { notAdded, notWanted, wantedCount, type FlowState } from "../installFlow";
import { plural } from "../messages";

type Props = { target: Profile; result: FlowState; onRestart: () => void; onShowHistory: () => void };

export function DoneScreen({ target, result, onRestart, onShowHistory }: Props) {
  const missing = notAdded(result);
  const skipped = notWanted(result);
  const wanted = wantedCount(result);
  const [openFailed, setOpenFailed] = useState(false);

  function openPage(id: string) {
    setOpenFailed(false);
    api.openStorePages(target.dir, [id]).catch(() => setOpenFailed(true));
  }

  return (
    <main className="screen">
      <h1>
        {wanted === 0
          ? `Nothing was added to ${target.name}`
          : missing.length === 0
            ? `All ${plural(wanted, "extension is", "extensions are")} now in ${target.name}`
            : `Added ${result.added.length} of ${plural(wanted, "extension", "extensions")} to ${target.name}`}
      </h1>

      {skipped.length > 0 && (
        <p className="muted">
          You chose not to add {skipped.map((item) => item.name).join(", ")}. If you change your mind, find this list in
          your history and press "Put it back on the list".
        </p>
      )}

      {missing.length > 0 && (
        <section>
          <p className="muted">
            {missing.length === 1 ? "This one wasn't added." : "These weren't added."} You can still add them from
            their store pages. If you added one in the last few seconds, it may not show here yet.
          </p>
          {openFailed && <p className="error">Couldn't open Chrome. Open Chrome yourself, then try again.</p>}
          <ul className="ext-list">
            {missing.map((item) => (
              <li key={item.id}>
                <div className="row">
                  <ExtensionIcon name={item.name} icon={item.icon} />
                  <span className="ext-name">{item.name}</span>
                  <button onClick={() => openPage(item.id)}>Open its store page in {target.name}</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {missing.length > 0 && (
        <p className="muted">
          Your history keeps this list, so you can add the rest later without ticking them again.
        </p>
      )}
      <div className="buttons">
        <button className="primary" onClick={onRestart}>
          Copy more extensions
        </button>
        <button onClick={onShowHistory}>See your history</button>
      </div>
    </main>
  );
}
