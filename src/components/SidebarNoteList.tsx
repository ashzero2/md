import { type KeyboardEvent, type MouseEvent, type ReactNode, useRef } from "react";
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
  const listRef = useRef<HTMLUListElement>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const list = listRef.current;
    if (!list) return;
    const items = Array.from(list.querySelectorAll<HTMLButtonElement>("li > button"));
    if (items.length === 0) return;

    const focused = document.activeElement as HTMLButtonElement | null;
    const idx = focused ? items.indexOf(focused) : -1;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      (items[idx + 1] ?? items[0])?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      (items[idx - 1] ?? items[items.length - 1])?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  const handleFocus = () => {
    const list = listRef.current;
    if (!list || list.contains(document.activeElement)) return;
    const items = Array.from(list.querySelectorAll<HTMLButtonElement>("li > button"));
    const active = items.find((b) => b.classList.contains("active")) ?? items[0];
    active?.focus();
  };

  return (
    <section className="sidebar-note-section" aria-label={title}>
      <div className="sidebar-note-head">
        <h2>{title}</h2>
        <span className="sidebar-note-count">{notes.length > 0 ? notes.length : null}</span>
        {clearLabel && notes.length > 0 && onClear && (
          <button type="button" className="btn-quiet sidebar-note-clear" onClick={onClear}>
            {clearLabel}
          </button>
        )}
      </div>

      {notes.length === 0 && <p className="sidebar-note-empty">{emptyText}</p>}

      <ul
        className="sidebar-note-list"
        role="listbox"
        aria-label={title}
        ref={listRef}
        tabIndex={notes.length > 0 ? 0 : undefined}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
      >
        {notes.map((note) => {
          const folder = folderFromPath(note.path);
          return (
            <li key={note.path} role="none">
              <button
                type="button"
                role="option"
                aria-selected={activePath === note.path}
                className={activePath === note.path ? "active" : ""}
                tabIndex={-1}
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
