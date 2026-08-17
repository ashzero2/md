// Minimal Phase 1/2 UI: open a vault, list notes, view raw content,
// live-refresh on file-watcher events.
// Styling and layout are deliberately plain — Phase 6 brings the design.

import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import { getNote, listFiles, listTree, openVault, pickVaultFolder } from "./lib/ipc";
import type { FileNode, NoteContent, VaultInfo } from "./lib/types";
import Tree from "./components/Tree";

export default function App() {
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [tree, setTree] = useState<FileNode[]>([]);
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
      const [list, treeNodes] = await Promise.all([listFiles(), listTree()]);
      setTree(treeNodes);
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
      setTree(await listTree());
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
          {tree.length === 0 && <p className="muted">No notes yet.</p>}
          <Tree nodes={tree} activePath={active?.path ?? null} onOpen={handleOpenNote} />
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