// Main layout: tree sidebar | editor/view | status bar.
// Modes: `edit` (CodeMirror) and `view` (rendered markdown), toggled with Cmd+E.

import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import {
  getBacklinks,
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
  const [vaultMenuOpen, setVaultMenuOpen] = useState(false);
  const [backlinksCount, setBacklinksCount] = useState(0);
  const [backlinksOpen, setBacklinksOpen] = useState(() => {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem("vault.backlinksOpen") === "true";
  });
  // Theme: "" = follow system, else "light"/"dark" (Cmd+Shift+L cycles).
  const [theme, setTheme] = useState<"" | "light" | "dark">("");
  useEffect(() => {
    if (theme === "") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("vault.backlinksOpen", String(backlinksOpen));
  }, [backlinksOpen]);

  const openNote = useEditorStore((s) => s.openNote);
  const closeNote = useEditorStore((s) => s.closeNote);
  const editorContent = useEditorStore((s) => s.content);
  const saveState = useEditorStore((s) => s.saveState);
  const conflict = useEditorStore((s) => s.conflict);

  const vaultMenuRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<NoteContent | null>(null);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    if (!vaultMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!vaultMenuRef.current?.contains(event.target as Node)) {
        setVaultMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [vaultMenuOpen]);

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

  useEffect(() => {
    let disposed = false;
    if (!active) {
      setBacklinksCount(0);
      return;
    }
    getBacklinks(active.path)
      .then((links) => {
        if (!disposed) setBacklinksCount(links.length);
      })
      .catch(() => {
        if (!disposed) setBacklinksCount(0);
      });
    return () => {
      disposed = true;
    };
  }, [active?.path]);

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

  const vaultName = vault?.root.split(/[\\/]/).filter(Boolean).pop() ?? "vault";
  const themeLabel = theme === "" ? "System" : theme === "dark" ? "Dark" : "Light";

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
            <button className="sidebar-search" onClick={() => setPaletteOpen(true)} disabled={!vault}>
              <span className="search-mark" aria-hidden="true" />
              <span>Jump to note</span>
              <kbd>⌘P</kbd>
            </button>
          </div>

          <h2>Files</h2>
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
            <div ref={vaultMenuRef} className={`vault-profile${vaultMenuOpen ? " open" : ""}`}>
              <button
                className="vault-profile-trigger"
                onClick={() => setVaultMenuOpen((open) => !open)}
                aria-expanded={vaultMenuOpen}
              >
                <span className="vault-avatar" aria-hidden="true">
                  {vault ? vaultName.slice(0, 1).toUpperCase() : "V"}
                </span>
                <span className="vault-profile-copy">
                  <span className="vault-profile-name">{vault ? vaultName : "No vault open"}</span>
                  <span className="vault-profile-meta">{status || (vault ? "Ready" : "Open a folder")}</span>
                </span>
                <span className="vault-profile-arrow" aria-hidden="true" />
              </button>
              {vaultMenuOpen && (
                <div className="vault-menu">
                  <button
                    onClick={() => {
                      setVaultMenuOpen(false);
                      void handleOpenVault();
                    }}
                    disabled={indexing}
                  >
                    {indexing ? "Indexing..." : vault ? "Switch Vault..." : "Open Vault..."}
                  </button>
                  <button
                    onClick={() => {
                      setTheme((t) => (t === "" ? "dark" : t === "dark" ? "light" : ""));
                    }}
                  >
                    Theme: {themeLabel}
                  </button>
                </div>
              )}
            </div>
          </div>
        </aside>

        <div className="content-row">
          <main className="content">
            {error && <div className="error">{error}</div>}
            {active ? (
              <>
                <div className="note-toolbar">
                  <div className="note-identity">
                    <div className="note-title">{active.title}</div>
                    <div className="note-location">{active.path}</div>
                  </div>
                  <div className="note-actions">
                    <button
                      type="button"
                      className={`toolbar-button${backlinksOpen ? " active" : ""}`}
                      onClick={() => setBacklinksOpen((open) => !open)}
                      aria-pressed={backlinksOpen}
                    >
                      Backlinks
                      {backlinksCount > 0 && <span>{backlinksCount}</span>}
                    </button>
                    <div className="mode-switch" role="tablist" aria-label="Note mode">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={mode === "edit"}
                        className={mode === "edit" ? "active" : ""}
                        onClick={() => setMode("edit")}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={mode === "view"}
                        className={mode === "view" ? "active" : ""}
                        onClick={() => setMode("view")}
                      >
                        Read
                      </button>
                    </div>
                  </div>
                </div>
                <div className={`note-stage mode-${mode}`}>
                  {mode === "edit" ? (
                    <EditorPane />
                  ) : (
                    <ViewPane content={editorContent} onNavigate={(t) => void handleNavigate(t)} />
                  )}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <div className="empty-kicker">{vault ? vaultName : "Local markdown"}</div>
                <h1>{vault ? "Choose a note" : "Open a vault"}</h1>
                <p>
                  {vault
                    ? "Select a file from the sidebar or jump straight to a title."
                    : "Point vault at a folder of markdown files."}
                </p>
                <div className="empty-actions">
                  <button className="btn-primary" onClick={() => void handleOpenVault()} disabled={indexing}>
                    {indexing ? "Indexing…" : vault ? "Switch Vault" : "Open Vault"}
                  </button>
                  {vault && (
                    <button className="btn-secondary" onClick={() => setPaletteOpen(true)}>
                      Jump to Note
                    </button>
                  )}
                </div>
              </div>
            )}
          </main>
          {active && backlinksOpen && (
            <BacklinksPanel path={active.path} onOpenNote={(p) => void handleOpenNote(p)} />
          )}
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
