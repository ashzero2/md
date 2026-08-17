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
import FullSearch from "./components/FullSearch";
import CommandPalette from "./components/CommandPalette";
import TagSidebar from "./components/TagSidebar";
import BacklinksPanel from "./components/BacklinksPanel";
import ConflictDialog from "./components/ConflictDialog";
import { filesByTag, saveNote } from "./lib/ipc";
import type { NoteMeta } from "./lib/types";
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
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [tagNotes, setTagNotes] = useState<NoteMeta[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // Theme: "" = follow system, else "light"/"dark" (Cmd+Shift+L cycles).
  const [theme, setTheme] = useState<"" | "light" | "dark">("");
  useEffect(() => {
    if (theme === "") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  const openNote = useEditorStore((s) => s.openNote);
  const closeNote = useEditorStore((s) => s.closeNote);
  const editorContent = useEditorStore((s) => s.content);
  const saveState = useEditorStore((s) => s.saveState);
  const conflict = useEditorStore((s) => s.conflict);

  const activeRef = useRef<NoteContent | null>(null);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const refresh = useCallback(async () => {
    try {
      const [list, treeNodes] = await Promise.all([listFiles(), listTree()]);
      setTree(treeNodes);
      setStatus(`${list.length} files indexed`);
      window.dispatchEvent(new Event("vault-changed-ui")); // tags refresh
      const current = activeRef.current;
      if (!current) return;
      const dirty = saveStateRef.current === "dirty" || saveStateRef.current === "error";
      try {
        const fresh = await getNote(current.path);
        const local = useEditorStore.getState().content;
        if (dirty && fresh.content !== local) {
          // Disk changed under us while editing → surface the conflict.
          useEditorStore.getState().setConflict({
            path: current.path,
            diskContent: fresh.content,
            editorContent: local,
          });
        } else if (!dirty) {
          setActive(fresh);
          openNote(fresh.path, fresh.content);
        }
      } catch {
        setActive(null);
        closeNote();
      }
    } catch (e) {
      setError(String(e));
    }
  }, [openNote, closeNote]);

  const saveStateRef = useRef<SaveState>("saved");
  useEffect(() => {
    saveStateRef.current = saveState;
  }, [saveState]);

  const handleTagSelect = useCallback(async (tag: string | null) => {
    setActiveTag(tag);
    if (!tag) {
      setTagNotes([]);
      return;
    }
    try {
      setTagNotes(await filesByTag(tag));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const handleConflictKeepMine = useCallback(async () => {
    const c = useEditorStore.getState().conflict;
    if (!c) return;
    useEditorStore.getState().setConflict(null);
    try {
      await saveNote(c.path, c.editorContent);
      const fresh = await getNote(c.path);
      setActive(fresh);
      openNote(fresh.path, fresh.content);
      setStatus(`Kept your changes — saved ${c.path}`);
    } catch (e) {
      setError(String(e));
    }
  }, [openNote]);

  const handleConflictKeepTheirs = useCallback(async () => {
    const c = useEditorStore.getState().conflict;
    if (!c) return;
    useEditorStore.getState().setConflict(null);
    try {
      const fresh = await getNote(c.path);
      setActive(fresh);
      openNote(fresh.path, fresh.content);
      setStatus(`Discarded your edits — reloaded ${c.path}`);
    } catch (e) {
      setError(String(e));
    }
  }, [openNote]);

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
  // Cmd+P / Cmd+K quick switcher, Cmd+F full-text search,
  // Cmd+Shift+L theme cycle.
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
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      } else if (e.shiftKey && (e.key === "L" || e.key === "l")) {
        e.preventDefault();
        setTheme((t) => (t === "" ? "dark" : t === "dark" ? "light" : ""));
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
      <div className="body">
        <aside className="sidebar">
          <div className="sidebar-head">
            <div className="wordmark">vault</div>
            <button className="btn-quiet" onClick={() => void handleOpenVault()} disabled={indexing}>
              {indexing ? "Indexing…" : vault ? "Switch Vault…" : "Open Vault…"}
            </button>
            {vault && <div className="vault-path" title={vault.root}>{vault.root}</div>}
          </div>

          <h2>Notes</h2>
          {activeTag ? (
            <div className="tag-filter">
              <div className="tag-filter-head">
                <span className="tag-filter-name">#{activeTag}</span>
                <button className="btn-quiet" onClick={() => void handleTagSelect(null)}>
                  Clear
                </button>
              </div>
              {tagNotes.length === 0 && <p className="muted">No notes with this tag.</p>}
              <ul className="tag-filter-list">
                {tagNotes.map((n) => (
                  <li key={n.path}>
                    <button
                      className={active?.path === n.path ? "active" : ""}
                      onClick={() => void handleOpenNote(n.path)}
                    >
                      {n.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              {tree.length === 0 && <p className="muted">No notes yet.</p>}
              <div className="tree-scroll">
                <Tree nodes={tree} activePath={active?.path ?? null} onOpen={(p) => void handleOpenNote(p)} />
              </div>
            </>
          )}

          <TagSidebar activeTag={activeTag} onSelectTag={(t) => void handleTagSelect(t)} />

          <div className="sidebar-foot">
            <div className="sidebar-status">{status || (vault ? "Ready" : "No vault open")}</div>
            <div className="sidebar-hints">⌘E view · ⌘P jump · ⌘F search · ⌘⇧L theme</div>
          </div>
        </aside>

        <div className="content-row">
          <main className="content">
            {error && <div className="error">{error}</div>}
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
          <BacklinksPanel path={active?.path ?? null} onOpenNote={(p) => void handleOpenNote(p)} />
        </div>
      </div>

      <StatusBar />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenNote={(p) => void handleOpenNote(p)}
        onStatus={setStatus}
      />
      <FullSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onOpenNote={(p) => void handleOpenNote(p)}
      />
      {conflict && (
        <ConflictDialog
          conflict={conflict}
          onKeepMine={() => void handleConflictKeepMine()}
          onKeepTheirs={() => void handleConflictKeepTheirs()}
        />
      )}
    </div>
  );
}