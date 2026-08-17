// Full-screen full-text search (Cmd+F): type to search every note's content
// with highlighted snippets. Built on cmdk for keyboard navigation.

import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { searchNotes } from "../lib/ipc";
import type { SearchResult } from "../lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenNote: (path: string) => void;
}

/** Render a snippet, highlighting FTS match markers (\u0001…\u0002). */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\u0001|\u0002)/);
  const nodes: React.ReactNode[] = [];
  let mark = false;
  for (const part of parts) {
    if (part === "\u0001") {
      mark = true;
      continue;
    }
    if (part === "\u0002") {
      mark = false;
      continue;
    }
    if (part) nodes.push(mark ? <mark key={nodes.length}>{part}</mark> : part);
  }
  return <>{nodes}</>;
}

export default function FullSearch({ open, onClose, onOpenNote }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setLoading(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      searchNotes(q)
        .then((r) => {
          setResults(r);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }, 150);
    return () => clearTimeout(timer);
  }, [query, open]);

  if (!open) return null;

  return (
    <div className="search-overlay" onMouseDown={onClose}>
      <div className="search-host" onMouseDown={(e) => e.stopPropagation()}>
        <Command>
          <div className="search-host-input-wrap">
            <input
              className="search-host-input"
              placeholder="Search every note…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            <span className="search-host-hint">Enter to open · Esc to close</span>
          </div>
          <Command.List className="search-host-list">
            {loading && <div className="search-host-status">Searching…</div>}
            {!loading && query.trim() && results.length === 0 && (
              <Command.Empty className="search-host-status">
                No results for “{query.trim()}”
              </Command.Empty>
            )}
            {results.map((r) => (
              <Command.Item
                key={r.path}
                value={`${r.title} ${r.path} ${r.snippet}`}
                onSelect={() => {
                  onClose();
                  onOpenNote(r.path);
                }}
                className="search-host-item"
              >
                <div className="search-host-item-title">
                  {r.title}
                  <span className="search-host-item-path">{r.path}</span>
                </div>
                <div className="search-host-item-snippet">
                  <Snippet text={r.snippet} />
                </div>
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}