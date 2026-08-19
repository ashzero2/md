import { Clock3 } from "lucide-react";
import type { MouseEvent } from "react";
import type { NoteMeta } from "../lib/types";

interface Props {
  notes: NoteMeta[];
  activePath: string | null;
  onOpen: (path: string, event: MouseEvent<HTMLButtonElement>) => void;
  onClear: () => void;
}

function folderFromPath(path: string) {
  const i = path.lastIndexOf("/");
  return i > 0 ? path.slice(0, i) : "";
}

export default function RecentNotes({ notes, activePath, onOpen, onClear }: Props) {
  if (notes.length === 0) return null;

  return (
    <section className="recents-section" aria-label="Recent notes">
      <div className="recents-head">
        <h2>Recent</h2>
        <button type="button" className="btn-quiet recents-clear" onClick={onClear}>
          Clear
        </button>
      </div>
      <ul className="recents-list">
        {notes.map((note) => {
          const folder = folderFromPath(note.path);
          return (
            <li key={note.path}>
              <button
                type="button"
                className={activePath === note.path ? "active" : ""}
                title={note.path}
                onClick={(e) => onOpen(note.path, e)}
                onAuxClick={(e) => {
                  if (e.button !== 1) return;
                  e.preventDefault();
                  onOpen(note.path, e);
                }}
              >
                <Clock3 size={13} strokeWidth={2} aria-hidden="true" />
                <span className="recents-copy">
                  <span className="recents-title">{note.title}</span>
                  {folder && <span className="recents-path">{folder}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
