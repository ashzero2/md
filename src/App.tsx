// Minimal Phase 1/2 UI: open a vault, list notes, view raw content,
// live-refresh on file-watcher events.
// Styling and layout are deliberately plain — Phase 6 brings the design.

import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import { getNote, listFiles, openVault, pickVaultFolder } from "./lib/ipc";
import type { NoteContent, NoteMeta, VaultInfo } from "./lib/types";

export default function App() {
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [active, setActive] = useState<NoteContent | null>(null);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [indexing, setIndexing] = useState(false);

  const activeRef = useRef<NoteContent | null>(null);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const refresh = useCallback(async () => {
    try {
      const list = await listFiles();
      setNotes(list);
      setStatus(`${list.length} files indexed`);
      // Reload the open note if it still exists, else close it.
      const current = activeRef.current;
      if (current) {
        try {
          setActive(await getNote(current.path));
        } catch {
          setActive(null); // deleted or moved externally
        }
      }
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const handleOpenVault = useCallback(async () => {
    try {
      setError(null);
      const path = await pickVaultFolder();
      if (!path) return;
      setIndexing(true);
      setStatus("Indexing…");
      const info = await openVault(path);
      setVault(info);
      setNotes(await listFiles());
      setStatus(`${info.files} files indexed`);
    } catch (e) {
      setError(String(e));
    } finally {
      setIndexing(false);
    }
  }, []);

  const handleOpenNote = useCallback(async (path: string) => {
    try {
      setError(null);
      setActive(await getNote(path));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // Subscribe to Rust-sourced events (index progress + vault changes from
  // the file watcher) for live UI updates.
  useEffect(() => {
    let disposed = false;
    let unlisten: Array<() => void> = [];
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten.push(
        await listen("vault-changed", () => {
          if (disposed) return;
          void refresh();
        }),
      );
      unlisten.push(
        await listen("index-progress", (e) => {
          if (disposed) return;
          const p = e.payload as { done: number; total: number };
          setStatus(`Indexing ${p.done}/${p.total}…`);
        }),
      );
      unlisten.push(
        await listen("index-ready", (e) => {
          if (disposed) return;
          const p = e.payload as { files: number };
          setStatus(`${p.files} files indexed`);
          void refresh();
        }),
      );
    })();
    return () => {
      disposed = true;
      unlisten.forEach((u) => u());
    };
  }, [refresh]);

  return (
    <div className="app">
      <header className="topbar">
        <h1>vault</h1>
        <button onClick={handleOpenVault} disabled={indexing}>
          {indexing ? "Indexing…" : vault ? "Switch Vault…" : "Open Vault…"}
        </button>
        <span className="status">{status}</span>
      </header>

      {error && <div className="error">{error}</div>}

      <div className="body">
        <aside className="sidebar">
          <h2>Notes</h2>
          {notes.length === 0 && <p className="muted">No notes yet.</p>}
          <ul>
            {notes.map((n) => (
              <li key={n.path}>
                <button
                  className={active?.path === n.path ? "active" : ""}
                  onClick={() => handleOpenNote(n.path)}
                >
                  {n.title}
                  <small>{n.tags.length > 0 ? ` #${n.tags.join(" #")}` : ""}</small>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="content">
          {active ? (
            <>
              <h2>{active.title}</h2>
              <pre className="raw">{active.content}</pre>
            </>
          ) : (
            <p className="muted">Open a note to read it.</p>
          )}
        </main>
      </div>
    </div>
  );
}