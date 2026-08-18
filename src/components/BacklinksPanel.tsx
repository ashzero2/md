// Backlinks panel (right column): context snippets for linked + unlinked
// mentions, a "Related" section (shared tags), a client-side filter, and a
// title/path sort. Sections are collapsible.

import { useCallback, useEffect, useMemo, useState } from "react";
import { getBacklinks, getRelatedNotes } from "../lib/ipc";
import type { Backlink, RelatedNote } from "../lib/types";

interface Props {
  path: string | null;
  onOpenNote: (path: string) => void;
}

type SortKey = "title" | "path";

function Section({ title, count, open, onToggle, children }: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="backlinks-section">
      <button className="backlinks-section-head" onClick={onToggle} aria-expanded={open}>
        <span className={`caret${open ? " open" : ""}`}>▸</span>
        <span>{title}</span>
        <span className="backlinks-section-count">{count}</span>
      </button>
      {open && <div className="backlinks-section-body">{children}</div>}
    </div>
  );
}

export default function BacklinksPanel({ path, onOpenNote }: Props) {
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [related, setRelated] = useState<RelatedNote[]>([]);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortKey>("title");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!path) {
      setBacklinks([]);
      setRelated([]);
      return;
    }
    getBacklinks(path).then(setBacklinks).catch(() => {});
    getRelatedNotes(path).then(setRelated).catch(() => {});
  }, [path]);

  const toggle = useCallback(
    (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] })),
    [],
  );

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let list = backlinks;
    if (q) {
      list = list.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          b.path.toLowerCase().includes(q) ||
          b.snippet.toLowerCase().includes(q),
      );
    }
    const s = sort;
    return [...list].sort((a, b) =>
      s === "path" ? a.path.localeCompare(b.path) : a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
    );
  }, [backlinks, filter, sort]);

  const linked = shown.filter((b) => b.linked);
  const unlinked = shown.filter((b) => !b.linked);

  return (
    <aside className="backlinks-panel">
      <h2>Connections</h2>

      {!path && <p className="backlinks-empty">Open a note to see its connections.</p>}
      {path && backlinks.length === 0 && related.length === 0 && (
        <p className="backlinks-empty">Nothing links to or relates to this note.</p>
      )}

      {path && backlinks.length > 0 && (
        <div className="backlinks-controls">
          <input
            className="backlinks-filter"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <select
            className="backlinks-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort"
          >
            <option value="title">Title</option>
            <option value="path">Path</option>
          </select>
        </div>
      )}

      {linked.length > 0 && (
        <Section
          title="Linked"
          count={linked.length}
          open={!collapsed.linked}
          onToggle={() => toggle("linked")}
        >
          <ul className="backlinks-list">
            {linked.map((b) => (
              <li key={b.path}>
                <button onClick={() => onOpenNote(b.path)} title={b.path}>
                  <span className="backlinks-title">{b.title}</span>
                  {b.snippet && <span className="backlinks-snippet">{b.snippet}</span>}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {unlinked.length > 0 && (
        <Section
          title="Mentions"
          count={unlinked.length}
          open={!collapsed.mentions}
          onToggle={() => toggle("mentions")}
        >
          <ul className="backlinks-list">
            {unlinked.map((b) => (
              <li key={b.path}>
                <button onClick={() => onOpenNote(b.path)} title={b.path}>
                  <span className="backlinks-title">{b.title}</span>
                  {b.snippet && <span className="backlinks-snippet">{b.snippet}</span>}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {related.length > 0 && (
        <Section
          title="Related"
          count={related.length}
          open={!collapsed.related}
          onToggle={() => toggle("related")}
        >
          <ul className="backlinks-list">
            {related.map((r) => (
              <li key={r.path}>
                <button onClick={() => onOpenNote(r.path)} title={r.path}>
                  <span className="backlinks-title">{r.title}</span>
                  <span className="backlinks-tags">{r.shared_tags} shared tag{r.shared_tags === 1 ? "" : "s"}</span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </aside>
  );
}