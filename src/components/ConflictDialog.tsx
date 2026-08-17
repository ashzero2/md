// Conflict dialog: a file changed on disk while you had unsaved edits.
// Choose to keep your in-app changes (overwrite disk) or keep the disk copy
// (discard local edits).

import type { Conflict } from "../store/editor";

interface Props {
  conflict: Conflict;
  onKeepMine: () => void;
  onKeepTheirs: () => void;
}

export default function ConflictDialog({ conflict, onKeepMine, onKeepTheirs }: Props) {
  return (
    <div className="overlay-scrim" role="dialog" aria-modal="true" aria-label="Unsaved changes">
      <div className="conflict-dialog">
        <h2>File changed on disk</h2>
        <p>
          <code>{conflict.path}</code> was modified on disk while you had unsaved
          changes.
        </p>
        <div className="conflict-actions">
          <button className="btn-quiet conflict-keep-mine" onClick={onKeepMine}>
            Keep my changes
          </button>
          <button className="btn-quiet" onClick={onKeepTheirs}>
            Keep disk version
          </button>
        </div>
      </div>
    </div>
  );
}