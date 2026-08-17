// Main layout: tree sidebar | editor/view | status bar.
// Modes: `edit` (CodeMirror) and `view` (rendered markdown), toggled with Cmd+E.

import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import {
  getNote,
  listFiles,
  listTree,
  openVault,
  pickVaultFolder,
  resolveLink,
} from "./lib/ipc";
import type { FileNode, NoteContent, VaultInfo } from "./lib/types";
import Tree from "./components/Tree";
import EditorPane from "./components/EditorPane";
import ViewPane from "./components/ViewPane";
import StatusBar from "./components/StatusBar";
import SearchPanel from "./components/SearchPanel";
import CommandPalette from "./components/CommandPalette";
import { useEditorStore, type SaveState } from "./store/editor";

type Mode = "edit" | "view";

export default function App() {
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [tree, setTree] = useState<FileNode[]>([]);
  const [active, setActive] = useState<NoteContent | null>(null);
  const [mode, setMode] = useState<Mode>("edit");
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const openNote = useEditorStore((s) => s.openNote);
  const closeNote = useEditorStore((s) => s.closeNote);
  const editorContent = useEditorStore((s) => s.content);
  const saveState = useEditorStore((s) => s.saveState);

  const activeRef = useRef<NoteContent | null>(null);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const refresh = useCallback(async () => {
    try {
      const [list, treeNodes] = await Promise.all([listFiles(), listTree()]);
      setTree(treeNodes);
      setStatus(`${list.length} files indexed`);
      // Reload the open note if it still exists — unless we have unsaved
      // edits (conflict handling is Phase 7; for now keep local edits).
      const current = activeRef.current;
      if (current && saveStateRef.current === "saved") {
        try {
          const fresh = await getNote(current.path);
          setActive(fresh);
          openNote(fresh.path, fresh.content);
        } catch {
          setActive(null);
          closeNote();
        }
      }
    } catch (e) {
      setError(String(e));
    }
  }, [openNote, closeNote]);

  const saveStateRef = useRef<SaveState>("saved");
  useEffect(() => {
    saveStateRef.current = saveState;
  }, [saveState]);

  const handleOpenVault = useCallback(async () => {
    try {
      setError(null);
      const path = await pickVaultFolder();
      if (!path) return;
      setIndexing(true);
      setStatus("Indexing…");
      const info = await openVault(path);
      setVault(info);
      setActive(null);
      closeNote();
      setTree(await listTree());
      setStatus(`${info.files} files indexed`);
    } catch (e) {
      setError(String(e));
    } finally {
      setIndexing(false);
    }
  }, [closeNote]);

  const handleOpenNote = useCallback(
    async (path: string) => {
      try {
        setError(null);
        const note = await getNote(path);
        setActive(note);
        openNote(note.path, note.content);
        setMode("edit");
      } catch (e) {
        setError(String(e));
      }
    },
    [openNote],
  );

  const handleNavigate = useCallback(
    async (target: string) => {
      try {
        const path = await resolveLink(target);
        if (path) {
          await handleOpenNote(path);
          setStatus(`Opened ${target}`);
        } else {
          setStatus(`Note not found: ${target}`);
        }
      } catch (e) {
        setError(String(e));
      }
    },
    [handleOpenNote],
  );

  // Global shortcuts: Cmd+E toggle edit/view, Cmd+O open vault,
  // Cmd+P / Cmd+K quick switcher.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        setMode((m) => (m === "edit" ? "view" : "edit"));
      } else if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        void handleOpenVault();
      } else if (e.key === "p" || e.key === "P" || e.key === "k" || e.key === "K") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleOpenVault]);

  // Subscribe to Rust-sourced events (index progress + vault changes).
  useEffect(() => {
    let disposed = false;
    let unlisten: Array<() => void> = [];
    void (async () => {
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
        <button onClick={() => void handleOpenVault()} disabled={indexing}>
          {indexing ? "Indexing…" : vault ? "Switch Vault…" : "Open Vault…"}
        </button>
        <span className="status">{status}</span>
        <span className="mode-hint">{active ? (mode === "edit" ? "Editing (⌘E to view)" : "Viewing (⌘E to edit)") : ""}</span>
      </header>

      {error && <div className="error">{error}</div>}

      <div className="body">
        <aside className="sidebar">
          <SearchPanel onOpenNote={(p) => void handleOpenNote(p)} />
          <h2>Notes</h2>
          {tree.length === 0 && <p className="muted">No notes yet.</p>}
          <div className="tree-scroll">
            <Tree nodes={tree} activePath={active?.path ?? null} onOpen={(p) => void handleOpenNote(p)} />
          </div>
        </aside>

        <main className="content">
          {active ? (
            mode === "edit" ? (
              <EditorPane />
            ) : (
              <ViewPane content={editorContent} onNavigate={(t) => void handleNavigate(t)} />
            )
          ) : (
            <p className="muted">Open a note to read or edit it.</p>
          )}
        </main>
      </div>

      <StatusBar />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenNote={(p) => void handleOpenNote(p)}
        onStatus={setStatus}
      />
    </div>
  );
}