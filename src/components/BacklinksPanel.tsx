// Backlinks panel: notes linking to the open note (linked) and notes that
// merely mention its title (unlinked).

import { useEffect, useState } from "react";
import { getBacklinks } from "../lib/ipc";
import type { Backlink } from "../lib/types";

interface Props {
  path: string | null;
  onOpenNote: (path: string) => void;
}

export default function BacklinksPanel({ path, onOpenNote }: Props) {
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!path) {
      setBacklinks([]);
      return;
    }
    setLoading(true);
    getBacklinks(path)
      .then(setBacklinks)
      .finally(() => setLoading(false));
  }, [path]);

  const linked = backlinks.filter((b) => b.linked);
  const unlinked = backlinks.filter((b) => !b.linked);

  return (
    <aside className="backlinks-panel">
      <h2>Backlinks</h2>
      {!path && <p className="backlinks-empty">Open a note to see its backlinks.</p>}
      {path && loading && <p className="backlinks-empty">Loading…</p>}
      {path && !loading && backlinks.length === 0 && (
        <p className="backlinks-empty">No notes link to this note.</p>
      )}

      {linked.length > 0 && (
        <>
          <h3>Linked</h3>
          <ul className="backlinks-list">
            {linked.map((b) => (
              <li key={b.path}>
                <button onClick={() => onOpenNote(b.path)} title={b.path}>
                  {b.title}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {unlinked.length > 0 && (
        <>
          <h3>Mentions</h3>
          <ul className="backlinks-list">
            {unlinked.map((b) => (
              <li key={b.path}>
                <button onClick={() => onOpenNote(b.path)} title={b.path}>
                  {b.title}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}