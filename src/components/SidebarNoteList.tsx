import type { MouseEvent, ReactNode } from "react";
import type { NoteMeta } from "../lib/types";

interface Props {
  title: string;
  notes: NoteMeta[];
  emptyText: string;
  icon: ReactNode;
  activePath: string | null;
  onOpen: (path: string, event: MouseEvent<HTMLButtonElement>) => void;
  clearLabel?: string;
  onClear?: () => void;
  action?: (path: string) => ReactNode;
}

function folderFromPath(path: string) {
  const i = path.lastIndexOf("/");
  return i > 0 ? path.slice(0, i) : "";
}

export default function SidebarNoteList({
  title,
  notes,
  emptyText,
  icon,
  activePath,
  onOpen,
  clearLabel,
  onClear,
  action,
}: Props) {
  return (
    <section className="sidebar-note-section" aria-label={title}>
      <div className="sidebar-note-head">
        <h2>{title}</h2>
        {clearLabel && notes.length > 0 && onClear && (
          <button type="button" className="btn-quiet sidebar-note-clear" onClick={onClear}>
            {clearLabel}
          </button>
        )}
      </div>

      {notes.length === 0 && <p className="sidebar-note-empty">{emptyText}</p>}

      <ul className="sidebar-note-list">
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
                {icon}
                <span className="sidebar-note-copy">
                  <span className="sidebar-note-title">{note.title}</span>
                  {folder && <span className="sidebar-note-path">{folder}</span>}
                </span>
              </button>
              {action?.(note.path)}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
