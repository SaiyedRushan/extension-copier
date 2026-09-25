import { useState } from "react";
import { api, type Profile } from "./api";
import { newSession, saveSession, type Session } from "./history";
import type { HistoryEntry } from "./historyEntries";
import type { FlowItem, FlowState } from "./installFlow";
import { DoneScreen } from "./screens/DoneScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { InstallScreen } from "./screens/InstallScreen";
import { PickScreen } from "./screens/PickScreen";

type Screen =
  | { name: "pick" }
  | { name: "history" }
  | {
      name: "install";
      target: Profile;
      session: Session;
      items: FlowItem[];
      alreadyAdded: string[];
      alreadySkipped: string[];
    }
  | { name: "done"; target: Profile; result: FlowState };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: "pick" });
  const [saveFailed, setSaveFailed] = useState(false);

  function save(session: Session) {
    saveSession(session).then(
      () => setSaveFailed(false),
      () => setSaveFailed(true),
    );
  }

  function start(from: Profile, to: Profile, items: FlowItem[]) {
    const session = newSession(from, to, items);
    save(session);
    setScreen({ name: "install", target: to, session, items, alreadyAdded: [], alreadySkipped: [] });
  }

  async function resume(entry: HistoryEntry) {
    if (!entry.target) return;
    const { session } = entry;
    // History doesn't keep icons, so borrow them from the source profile if it's still there.
    const source = await api.listExtensions(session.from.dir).catch(() => []);
    const icons = new Map(source.map((ext) => [ext.id, ext.icon]));
    const items = session.items.map((item) => ({ ...item, icon: icons.get(item.id) ?? null }));
    setScreen({
      name: "install",
      target: entry.target,
      session,
      items,
      alreadyAdded: entry.added,
      alreadySkipped: entry.skipped,
    });
  }

  switch (screen.name) {
    case "pick":
      return (
        <PickScreen onStart={start} onResume={resume} onShowHistory={() => setScreen({ name: "history" })} />
      );
    case "history":
      return <HistoryScreen onBack={() => setScreen({ name: "pick" })} onResume={resume} />;
    case "install":
      return (
        <InstallScreen
          target={screen.target}
          items={screen.items}
          alreadyAdded={screen.alreadyAdded}
          alreadySkipped={screen.alreadySkipped}
          saveFailed={saveFailed}
          onProgress={(added, skipped) => save({ ...screen.session, added, skipped })}
          onDone={(result) => setScreen({ name: "done", target: screen.target, result })}
        />
      );
    case "done":
      return (
        <DoneScreen
          target={screen.target}
          result={screen.result}
          onRestart={() => setScreen({ name: "pick" })}
          onShowHistory={() => setScreen({ name: "history" })}
        />
      );
  }
}
