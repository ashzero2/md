import { Clock3, Star } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import type { NoteMeta } from "../lib/types";

interface Props {
  favorites: NoteMeta[];
  recents: NoteMeta[];
  activePath: string | null;
  onOpen: (path: string, event: MouseEvent<HTMLButtonElement>) => void;
  onToggleFavorite: (path: string) => void;
  onClearRecents: () => void;
}

function folderFromPath(path: string) {
  const i = path.lastIndexOf("/");
  return i > 0 ? path.slice(0, i) : "";
}

function NoteList({
  icon,
  notes,
  activePath,
  onOpen,
  action,
}: {
  icon: ReactNode;
  notes: NoteMeta[];
  activePath: string | null;
  onOpen: Props["onOpen"];
  action?: (path: string) => ReactNode;
}) {
  return (
    <ul className="working-set-list">
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
              <span className="working-set-copy">
                <span className="working-set-title">{note.title}</span>
                {folder && <span className="working-set-path">{folder}</span>}
              </span>
            </button>
            {action?.(note.path)}
          </li>
        );
      })}
    </ul>
  );
}

export default function WorkingSet({
  favorites,
  recents,
  activePath,
  onOpen,
  onToggleFavorite,
  onClearRecents,
}: Props) {
  const hasFavorites = favorites.length > 0;
  const hasRecents = recents.length > 0;

  return (
    <section className="working-set-section" aria-label="Working set">
      <div className="working-set-head">
        <h2>Working Set</h2>
      </div>

      {!hasFavorites && !hasRecents && (
        <p className="working-set-empty">Favorite or open notes to build a working set.</p>
      )}

      {hasFavorites && (
        <div className="working-set-group">
          <div className="working-set-group-head">
            <h3>Favorites</h3>
          </div>
          <NoteList
            icon={<Star size={13} strokeWidth={2} aria-hidden="true" />}
            notes={favorites}
            activePath={activePath}
            onOpen={onOpen}
            action={(path) => (
              <button
                type="button"
                className="working-set-inline-action"
                onClick={() => onToggleFavorite(path)}
                aria-label="Remove favorite"
                title="Remove favorite"
              >
                <Star size={12} strokeWidth={2} fill="currentColor" aria-hidden="true" />
              </button>
            )}
          />
        </div>
      )}

      {hasRecents && (
        <div className="working-set-group">
          <div className="working-set-group-head">
            <h3>Recent</h3>
            <button type="button" className="btn-quiet working-set-clear" onClick={onClearRecents}>
              Clear
            </button>
          </div>
          <NoteList
            icon={<Clock3 size={13} strokeWidth={2} aria-hidden="true" />}
            notes={recents}
            activePath={activePath}
            onOpen={onOpen}
          />
        </div>
      )}
    </section>
  );
}
