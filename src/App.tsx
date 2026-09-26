import { useState } from "react";
import { api, type Profile } from "./api";
import { newSession, saveSession, type Session } from "./history";
import type { HistoryEntry } from "./historyEntries";
import type { FlowItem, FlowState } from "./installFlow";
import { DoneScreen } from "./screens/DoneScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { InstallScreen } from "./screens/InstallScreen";
import { PickScreen } from "./screens/PickScreen";
import { SettingsScreen } from "./screens/SettingsScreen";

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
  | { name: "done"; target: Profile; session: Session; result: FlowState }
  | {
      name: "settings";
      target: Profile;
      session: Session;
      items: FlowItem[];
      backLabel: string;
      back: Screen;
    };

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

  /** History doesn't keep icons, so borrow them from the source profile if it's still there. */
  async function withIcons(session: Session, ids: string[]): Promise<FlowItem[]> {
    const source = await api.listExtensions(session.from.dir).catch(() => []);
    const icons = new Map(source.map((ext) => [ext.id, ext.icon]));
    return session.items
      .filter((item) => ids.includes(item.id))
      .map((item) => ({ ...item, icon: icons.get(item.id) ?? null }));
  }

  async function openSettings(session: Session, target: Profile, addedIds: string[], back: Screen, backLabel: string) {
    const items = await withIcons(session, addedIds);
    setScreen({ name: "settings", target, session, items, back, backLabel });
  }

  async function resume(entry: HistoryEntry) {
    if (!entry.target) return;
    const { session } = entry;
    const items = await withIcons(
      session,
      session.items.map((item) => item.id),
    );
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
      return (
        <HistoryScreen
          onBack={() => setScreen({ name: "pick" })}
          onResume={resume}
          onCopySettings={(entry) =>
            entry.target &&
            void openSettings(entry.session, entry.target, entry.added, { name: "history" }, "Back to your history")
          }
        />
      );
    case "install":
      return (
        <InstallScreen
          target={screen.target}
          items={screen.items}
          alreadyAdded={screen.alreadyAdded}
          alreadySkipped={screen.alreadySkipped}
          saveFailed={saveFailed}
          onProgress={(added, skipped) => save({ ...screen.session, added, skipped })}
          onDone={(result) => setScreen({ name: "done", target: screen.target, session: screen.session, result })}
        />
      );
    case "done":
      return (
        <DoneScreen
          target={screen.target}
          result={screen.result}
          onRestart={() => setScreen({ name: "pick" })}
          onShowHistory={() => setScreen({ name: "history" })}
          onCopySettings={() =>
            void openSettings(screen.session, screen.target, screen.result.added, screen, "Back to the summary")
          }
        />
      );
    case "settings":
      return (
        <SettingsScreen
          session={screen.session}
          target={screen.target}
          items={screen.items}
          backLabel={screen.backLabel}
          onBack={() => setScreen(screen.back)}
        />
      );
  }
}
