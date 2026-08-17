// Sidebar full-text search: input + results dropdown with highlighted
// snippets. Backed by SQLite FTS5 (BM25 ranking) through the search store.

import { useEffect, useRef } from "react";
import { useSearchStore } from "../store/search";

interface Props {
  onOpenNote: (path: string) => void;
}

/** Render a snippet, highlighting the FTS match markers (\u0001…\u0002). */
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

export default function SearchPanel({ onOpenNote }: Props) {
  const query = useSearchStore((s) => s.query);
  const results = useSearchStore((s) => s.results);
  const loading = useSearchStore((s) => s.loading);
  const active = useSearchStore((s) => s.active);
  const setQuery = useSearchStore((s) => s.setQuery);
  const clear = useSearchStore((s) => s.clear);
  const close = useSearchStore((s) => s.close);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        inputRef.current?.focus();
        useSearchStore.getState().open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="search-panel">
      <input
        ref={inputRef}
        className="search-input"
        placeholder="Search notes (⌘F)…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={useSearchStore.getState().open}
        onBlur={() => setTimeout(close, 150)}
      />
      {active && query.trim() && (
        <div className="search-results">
          {loading && <div className="search-status">Searching…</div>}
          {!loading && results.length === 0 && (
            <div className="search-status">No results</div>
          )}
          {results.map((r) => (
            <button
              key={r.path}
              className="search-result"
              onMouseDown={(e) => {
                e.preventDefault();
                clear();
                onOpenNote(r.path);
              }}
            >
              <span className="search-result-title">{r.title}</span>
              <span className="search-result-snippet">
                <Snippet text={r.snippet} />
              </span>
              <span className="search-result-path">{r.path}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}