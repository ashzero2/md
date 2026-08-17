// Bottom status bar: open note + save status.

import { useEditorStore } from "../store/editor";

const SAVE_LABELS: Record<string, string> = {
  saved: "Saved",
  saving: "Saving…",
  dirty: "Unsaved changes",
  error: "Save failed",
};

export default function StatusBar() {
  const path = useEditorStore((s) => s.path);
  const saveState = useEditorStore((s) => s.saveState);
  return (
    <footer className="statusbar">
      <span className="statusbar-path">{path ?? "No note open"}</span>
      {path && (
        <span className={`statusbar-save state-${saveState}`}>
          {SAVE_LABELS[saveState] ?? saveState}
        </span>
      )}
    </footer>
  );
}