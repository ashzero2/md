// Main layout: tree sidebar | editor/view | status bar.
// Modes: `edit` (CodeMirror) and `view` (rendered markdown), toggled with Cmd+E.

import { lazy, Suspense, type MouseEvent, useCallback, useEffect, useRef, useState } from "react";
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
import { Link2, Plus, X } from "lucide-react";
import NoteMenu from "./components/NoteMenu";
import type { NoteMenuAction } from "./components/NoteMenu";
import Tree from "./components/Tree";
import EditorPane from "./components/EditorPane";
const ViewPane = lazy(() => import("./components/ViewPane"));
import StatusBar from "./components/StatusBar";
import FullSearch from "./components/FullSearch";
import CommandPalette from "./components/CommandPalette";
import TagSidebar from "./components/TagSidebar";
import BacklinksPanel from "./components/BacklinksPanel";
import ConflictDialog from "./components/ConflictDialog";
import SettingsSheet from "./components/SettingsSheet";
import FileMenu from "./components/FileMenu";
import ActionDialog from "./components/ActionDialog";
import DiagnosticsPanel from "./components/DiagnosticsPanel";
import type { DiagTab } from "./components/DiagnosticsPanel";
import type { NoteAction } from "./components/FileMenu";
import {
  copyText,
  createNote,
  deleteNoteFile,
  filesByTag,
  moveNote,
  rebuildIndex,
  renameNote,
  revealNote,
  saveNote,
} from "./lib/ipc";
import { useSettingsStore } from "./store/settings";
import { openHtmlPreview, writeTextFile } from "./lib/ipc";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useToastStore } from "./store/toast";
import Toasts from "./components/Toasts";
import type { NoteMeta } from "./lib/types";
import { useEditorStore, type EditorMode, type NoteTab, type SaveState } from "./store/editor";

function opensInBackground(event: MouseEvent<HTMLButtonElement>) {
  return event.metaKey || event.ctrlKey || event.button === 1;
}

function noteFromTab(tab: NoteTab): NoteContent {
  return { path: tab.path, title: tab.title, content: tab.content };
}

/** Parent folder of a vault-relative path, or null for a top-level file. */
function dirname(p: string): string | null {
  const i = p.lastIndexOf("/");
  if (i <= 0) return null;
  return p.slice(0, i);
}

export default function App() {
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [tree, setTree] = useState<FileNode[]>([]);
  const [active, setActive] = useState<NoteContent | null>(null);
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
  // Theme + settings (persisted via the settings store).
  const [settingsOpen, setSettingsOpen] = useState(false);
  const theme = useSettingsStore((s) => s.settings.theme);
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const [action, setAction] = useState<
    | { kind: "rename"; path: string; title: string }
    | { kind: "move"; path: string }
    | { kind: "delete"; path: string; title: string }
    | { kind: "create" }
    | null
  >(null);
  const [diag, setDiag] = useState<{ open: boolean; tab: DiagTab }>({ open: false, tab: "broken" });
  const notify = useToastStore((s) => s.push);

  useEffect(() => {
    localStorage.setItem("vault.backlinksOpen", String(backlinksOpen));
  }, [backlinksOpen]);

  const openNote = useEditorStore((s) => s.openNote);
  const closeTabsByPath = useEditorStore((s) => s.closeTabsByPath);
  const activateTab = useEditorStore((s) => s.activateTab);
  const reopenClosedTab = useEditorStore((s) => s.reopenClosedTab);
  const resetEditor = useEditorStore((s) => s.reset);
  const setTabMode = useEditorStore((s) => s.setTabMode);
  const updateNotePath = useEditorStore((s) => s.updateNotePath);
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const editorContent = useEditorStore((s) => s.content);
  const saveState = useEditorStore((s) => s.saveState);
  const conflict = useEditorStore((s) => s.conflict);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const mode: EditorMode = activeTab?.mode ?? "edit";

  const vaultMenuRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<NoteContent | null>(null);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    setActive(activeTab ? noteFromTab(activeTab) : null);
  }, [activeTab?.content, activeTab?.path, activeTab?.title]);

  useEffect(() => {
    if (!vaultMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!vaultMenuRef.current?.contains(event.target as Node)) {
        setVaultMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setVaultMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [vaultMenuOpen]);

  const refresh = useCallback(async () => {
    try {
      const [list, treeNodes] = await Promise.all([listFiles(), listTree()]);
      setTree(treeNodes);
      setStatus(`${list.length} files indexed`);
      window.dispatchEvent(new Event("vault-changed-ui")); // tags refresh
      const current = activeRef.current;
      if (!current) return;
      const state = saveStateRef.current;
      // A save we triggered is mid-flight — ignore watcher events from it.
      if (state === "saving") return;
      const dirty = state === "dirty" || state === "error";
      try {
        const fresh = await getNote(current.path);
        const store = useEditorStore.getState();
        if (dirty) {
          // Genuine external change only: disk differs from the last content
          // WE wrote (our own autosave writes also fire the watcher, and
          // comparing against the live buffer would be a false positive).
          if (fresh.content !== store.savedContent) {
            store.setConflict({
              path: current.path,
              diskContent: fresh.content,
              editorContent: store.content,
            });
          }
        } else {
          setActive(fresh);
          openNote(fresh.path, fresh.content, { title: fresh.title, reload: true });
        }
      } catch {
        setActive(null);
        closeTabsByPath(current.path);
      }
    } catch (e) {
      setError(String(e));
    }
  }, [openNote, closeTabsByPath]);

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Coalesce watcher bursts (e.g. batch file ops) into one refresh.
  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      void refresh();
    }, 200);
  }, [refresh]);

  const createFolder = useSettingsStore(
    (s) =>
      s.settings.default_new_note_location === "same_folder" && active ? dirname(active.path) : null,
  );

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
      openNote(fresh.path, fresh.content, { title: fresh.title, reload: true });
      notify(`Kept your changes — saved ${c.path}`);
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
      openNote(fresh.path, fresh.content, { title: fresh.title, reload: true });
      notify(`Discarded your edits — reloaded ${c.path}`);
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
      resetEditor();
      setTree(await listTree());
      setStatus(`${info.files} files indexed`);
    } catch (e) {
      setError(String(e));
    } finally {
      setIndexing(false);
    }
  }, [resetEditor]);

  const handleOpenNote = useCallback(
    async (path: string, options: { background?: boolean } = {}) => {
      try {
        setError(null);
        const note = await getNote(path);
        const activate = !options.background || !activeRef.current;
        openNote(note.path, note.content, { title: note.title, activate, mode: "edit" });
        if (activate) {
          setActive(note);
        } else {
          notify(`Opened ${note.title} in the background`);
        }
      } catch (e) {
        setError(String(e));
      }
    },
    [openNote, notify],
  );

  const handleActivateTab = useCallback(
    (id: string) => {
      const tab = useEditorStore.getState().tabs.find((t) => t.id === id);
      if (!tab) return;
      activateTab(id);
      setActive(noteFromTab(tab));
    },
    [activateTab],
  );

  const handleCloseTab = useCallback(
    async (id: string) => {
      const store = useEditorStore.getState();
      const tab = store.tabs.find((t) => t.id === id);
      if (!tab) return;

      await store.flush(id);
      const afterFlush = useEditorStore.getState();
      const freshTab = afterFlush.tabs.find((t) => t.id === id);
      if (freshTab?.saveState === "error") {
        notify(`Could not save ${freshTab.title}. Tab kept open.`, "error");
        return;
      }

      afterFlush.closeTab(id);
      const nextState = useEditorStore.getState();
      const next = nextState.tabs.find((t) => t.id === nextState.activeTabId);
      setActive(next ? noteFromTab(next) : null);
    },
    [notify],
  );

  const setActiveMode = useCallback(
    (nextMode: EditorMode) => {
      if (!activeTabId) return;
      setTabMode(activeTabId, nextMode);
    },
    [activeTabId, setTabMode],
  );

  const handleNavigate = useCallback(
    async (target: string) => {
      try {
        const path = await resolveLink(target);
        if (path) {
          await handleOpenNote(path);
          notify(`Opened ${target}`);
        } else {
          notify(`Note not found: ${target}`, "error");
        }
      } catch (e) {
        setError(String(e));
      }
    },
    [handleOpenNote],
  );

  // ---- File actions (context menu) ----

  const handleFileAction = useCallback(
    (a: NoteAction) => {
      if (!menu) return;
      const path = menu.path;
      setMenu(null);
      const titleOf = () => getNote(path).then((n) => n.title).catch(() => null);
      switch (a) {
        case "open":
          void handleOpenNote(path);
          return;
        case "rename":
          void titleOf().then((t) => setAction({ kind: "rename", path, title: t ?? path }));
          return;
        case "move":
          setAction({ kind: "move", path });
          return;
        case "delete":
          void titleOf().then((t) => {
            if (useSettingsStore.getState().settings.confirm_before_delete) {
              setAction({ kind: "delete", path, title: t ?? path });
            } else {
              void handleConfirmDelete(path);
            }
          });
          return;
        case "reveal":
          void revealNote(path).catch((e) => setError(String(e)));
          return;
        case "copy-wikilink":
          void titleOf().then((t) => {
            const title = t ?? path;
            void copyText(`[[${title}]]`)
              .then(() => notify(`Copied [[${title}]]`))
              .catch((e) => setError(String(e)));
          });
          return;
        case "copy-markdown":
          void titleOf().then((t) => {
            const title = t ?? path;
            void copyText(`[${title}](${path})`)
              .then(() => notify(`Copied markdown link for ${title}`))
              .catch((e) => setError(String(e)));
          });
          return;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [menu, handleOpenNote],
  );

  const handleConfirmRename = useCallback(
    async (rawTitle: string) => {
      if (!action || action.kind !== "rename") return;
      const { path } = action;
      setAction(null);
      const title = rawTitle.trim();
      if (!title) return;
      try {
        const res = await renameNote(path, title);
        notify(`Renamed — ${res.links_updated} file(s) link-updated`);
        await refresh();
        const fresh = await getNote(res.path);
        updateNotePath(path, fresh.path, fresh.title, fresh.content);
        if (activeRef.current?.path === path) setActive(fresh);
      } catch (e) {
        setError(String(e));
      }
    },
    [action, refresh, updateNotePath],
  );

  const handleConfirmMove = useCallback(
    async (folder: string) => {
      if (!action || action.kind !== "move") return;
      const { path } = action;
      setAction(null);
      try {
        const res = await moveNote(path, folder.trim());
        notify(`Moved — ${res.links_updated} file(s) link-updated`);
        await refresh();
        const fresh = await getNote(res.path);
        updateNotePath(path, fresh.path, fresh.title, fresh.content);
        if (activeRef.current?.path === path) setActive(fresh);
      } catch (e) {
        setError(String(e));
      }
    },
    [action, refresh, updateNotePath],
  );

  const handleCreateMissing = useCallback(
    async (target: string) => {
      try {
        const note = await createNote(target, createFolder);
        notify(`Created “${note.title}”`);
        await refresh();
        // refresh diagnostics + reactivate the broken tab
        setDiag((d) => ({ open: d.open, tab: "broken" }));
      } catch (e) {
        setError(String(e));
      }
    },
    [createFolder, refresh],
  );

  const handleRebuild = useCallback(async () => {
    try {
      setIndexing(true);
      setStatus("Rebuilding index…");
      const n = await rebuildIndex();
      notify(`${n} files reindexed`);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setIndexing(false);
    }
  }, [refresh]);

  const handleExportHtml = useCallback(async () => {
    if (!active) return;
    try {
      const { buildExportHtml } = await import("./lib/exportHtml");
      const html = await buildExportHtml(editorContent, active.title);
      const path = await saveDialog({
        defaultPath: `${active.title}.html`,
        filters: [{ name: "HTML", extensions: ["html"] }],
      });
      if (!path) return;
      await writeTextFile(path, html);
      notify(`Exported ${active.title}.html`);
    } catch (e) {
      setError(String(e));
    }
  }, [active, editorContent]);

  const handlePrintNote = useCallback(async () => {
    if (!active) return;
    try {
      const { buildExportHtml } = await import("./lib/exportHtml");
      const html = await buildExportHtml(editorContent, active.title);
      await openHtmlPreview(html, active.title);
      notify("Opened print preview — use Cmd+P to Save as PDF");
    } catch (e) {
      setError(String(e));
    }
  }, [active, editorContent]);

  const handleConfirmCreate = useCallback(
    async (rawTitle: string) => {
      setAction(null);
      const title = rawTitle.trim();
      if (!title) return;
      try {
        const note = await createNote(title, createFolder);
        await refresh();
        await handleOpenNote(note.path);
        notify(`Created “${note.title}”`);
      } catch (e) {
        setError(String(e));
      }
    },
    [createFolder, refresh, handleOpenNote, notify],
  );

  const handleToolbarCreate = useCallback(() => setAction({ kind: "create" }), []);

  // Note overflow menu: current-note utility + destructive actions.
  const handleNoteAction = useCallback(
    (a: NoteMenuAction) => {
      if (!active) return;
      switch (a) {
        case "rename":
          setAction({ kind: "rename", path: active.path, title: active.title });
          break;
        case "move":
          setAction({ kind: "move", path: active.path });
          break;
        case "copy-wikilink":
          void copyText(`[[${active.title}]]`)
            .then(() => notify(`Copied [[${active.title}]]`))
            .catch((e) => setError(String(e)));
          break;
        case "copy-markdown":
          void copyText(`[${active.title}](${active.path})`)
            .then(() => notify(`Copied markdown link`))
            .catch((e) => setError(String(e)));
          break;
        case "export":
          void handleExportHtml();
          break;
        case "print":
          void handlePrintNote();
          break;
        case "reveal":
          void revealNote(active.path).catch((e) => setError(String(e)));
          break;
        case "delete":
          if (useSettingsStore.getState().settings.confirm_before_delete) {
            setAction({ kind: "delete", path: active.path, title: active.title });
          } else {
            void handleConfirmDelete(active.path);
          }
          break;
      }
    },
    [active, notify, handleExportHtml, handlePrintNote],
  );

  const handleConfirmDelete = useCallback(
    async (path: string) => {
      setAction(null);
      setMenu(null);
      try {
        await deleteNoteFile(path);
        await refresh();
        closeTabsByPath(path);
        if (activeRef.current?.path === path) {
          setActive(null);
        }
        notify(`Deleted ${path}`);
      } catch (e) {
        setError(String(e));
      }
    },
    [refresh, closeTabsByPath],
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

  // Global shortcuts: tab switching/closing plus note mode, vault, search, and theme controls.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const tabNumber = Number(e.key);
      if (tabNumber >= 1 && tabNumber <= 9) {
        const tab = tabs[tabNumber - 1];
        if (tab) {
          e.preventDefault();
          handleActivateTab(tab.id);
        }
        return;
      }
      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        setActiveMode(mode === "edit" ? "view" : "edit");
      } else if (e.key === "w" || e.key === "W") {
        e.preventDefault();
        if (activeTabId) void handleCloseTab(activeTabId);
      } else if (e.shiftKey && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        reopenClosedTab();
      } else if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        void handleOpenVault();
      } else if (e.key === "p" || e.key === "P" || e.key === "k" || e.key === "K") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      } else if (e.key === ",") {
        e.preventDefault();
        setSettingsOpen((o) => !o);
      } else if (e.shiftKey && (e.key === "L" || e.key === "l")) {
        e.preventDefault();
        const cur = useSettingsStore.getState().settings.theme;
        const next = cur === "system" ? "dark" : cur === "dark" ? "light" : "system";
        useSettingsStore.getState().update({ theme: next });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    activeTabId,
    handleActivateTab,
    handleCloseTab,
    handleOpenVault,
    mode,
    reopenClosedTab,
    setActiveMode,
    tabs,
  ]);

  const vaultName = vault?.root.split(/[\\/]/).filter(Boolean).pop() ?? "vault";
  const THEME_LABELS: Record<string, string> = {
    system: "System",
    light: "Paper (Light)",
    dark: "Graphite (Dark)",
    onedark: "One Dark",
    nord: "Nord",
    catppuccin: "Catppuccin",
    latte: "Catppuccin Latte",
    rosepine: "Rosé Pine",
    rosedawn: "Rosé Pine Dawn",
  };
  const themeLabel = THEME_LABELS[theme] ?? theme;

  // Load persisted settings once; optionally reopen the last vault on launch.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await useSettingsStore.getState().load();
      const s = useSettingsStore.getState().settings;
      if (cancelled || !s.reopen_last_vault || !s.last_vault || vault) return;
      try {
        setIndexing(true);
        setStatus("Opening…");
        const info = await openVault(s.last_vault);
        setVault(info);
        setActive(null);
        resetEditor();
        setTree(await listTree());
        setStatus(`${info.files} files indexed`);
      } catch (e) {
        setError(String(e));
      } finally {
        setIndexing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vault, resetEditor]);

  // Subscribe to Rust-sourced events (index progress + vault changes).
  useEffect(() => {
    let disposed = false;
    let unlisten: Array<() => void> = [];
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten.push(
        await listen("vault-changed", () => {
          if (disposed) return;
          scheduleRefresh();
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
            {vault && (
              <>
                <button
                  type="button"
                  className="sidebar-action-new"
                  onClick={handleToolbarCreate}
                  aria-label="New note"
                  title="New note"
                >
                  <Plus size={15} strokeWidth={2} aria-hidden="true" />
                </button>
                <button
                  className="sidebar-search"
                  onClick={() => setPaletteOpen(true)}
                >
                  <span className="search-mark" aria-hidden="true" />
                  <span>Jump to note</span>
                  <kbd>⌘P</kbd>
                </button>
              </>
            )}
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
                      onClick={(e) => void handleOpenNote(n.path, { background: opensInBackground(e) })}
                      onAuxClick={(e) => {
                        if (e.button !== 1) return;
                        e.preventDefault();
                        void handleOpenNote(n.path, { background: true });
                      }}
                    >
                      {n.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              {tree.length === 0 && (
                <p className="muted">{vault ? "No notes yet." : "Open a folder to list notes here"}</p>
              )}
              <div className="tree-scroll">
                <Tree
                  nodes={tree}
                  activePath={active?.path ?? null}
                  onOpen={(p, e) => void handleOpenNote(p, { background: opensInBackground(e) })}
                  onContext={(path, x, y) => setMenu({ path, x, y })}
                />
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
                      const cur = useSettingsStore.getState().settings.theme;
                      const next = cur === "system" ? "dark" : cur === "dark" ? "light" : "system";
                      useSettingsStore.getState().update({ theme: next });
                    }}
                  >
                    Theme: {themeLabel}
                  </button>
                  <button
                    onClick={() => {
                      setVaultMenuOpen(false);
                      setSettingsOpen(true);
                    }}
                  >
                    Settings…
                  </button>
                  {vault && (
                    <>
                      <div className="file-menu-sep" />
                      <button
                        onClick={() => {
                          setVaultMenuOpen(false);
                          setDiag({ open: true, tab: "broken" });
                        }}
                      >
                        Broken links…
                      </button>
                      <button
                        onClick={() => {
                          setVaultMenuOpen(false);
                          setDiag({ open: true, tab: "orphan" });
                        }}
                      >
                        Orphan notes…
                      </button>
                      <button
                        onClick={() => {
                          setVaultMenuOpen(false);
                          void handleRebuild();
                        }}
                        disabled={indexing}
                      >
                        Rebuild index…
                      </button>
                    </>
                  )}
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
                <div className="tab-strip">
                  <div className="tab-strip-scroll" role="tablist" aria-label="Open notes">
                    {tabs.map((tab, index) => (
                      <div
                        key={tab.id}
                        className={`note-tab${tab.id === activeTabId ? " active" : ""}${tab.saveState === "dirty" || tab.saveState === "error" ? " dirty" : ""}`}
                        title={`${tab.path}${index < 9 ? ` — ⌘${index + 1}` : ""}`}
                      >
                        <button
                          type="button"
                          role="tab"
                          aria-selected={tab.id === activeTabId}
                          className="note-tab-main"
                          onClick={() => handleActivateTab(tab.id)}
                        >
                          <span className="note-tab-title">{tab.title}</span>
                          {(tab.saveState === "dirty" || tab.saveState === "error") && (
                            <span className="note-tab-dot" aria-label={tab.saveState === "error" ? "Save failed" : "Unsaved changes"} />
                          )}
                        </button>
                        <button
                          type="button"
                          className="note-tab-close"
                          aria-label={`Close ${tab.title}`}
                          title="Close tab"
                          onClick={() => void handleCloseTab(tab.id)}
                        >
                          <X size={12} strokeWidth={2.2} aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="note-actions">
                    <button
                      type="button"
                      className={`toolbar-button icon-only${backlinksOpen ? " active" : ""}`}
                      onClick={() => setBacklinksOpen((open) => !open)}
                      aria-pressed={backlinksOpen}
                      aria-label={`Toggle backlinks panel${backlinksCount > 0 ? `, ${backlinksCount} backlinks` : ""}`}
                      title="Backlinks"
                    >
                      <Link2 size={16} strokeWidth={2} aria-hidden="true" />
                      {backlinksCount > 0 && <span className="toolbar-count">{backlinksCount}</span>}
                    </button>
                    <NoteMenu disabled={!active} onAction={handleNoteAction} />
                    <div className="mode-switch" role="tablist" aria-label="Note mode">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={mode === "edit"}
                        className={mode === "edit" ? "active" : ""}
                        onClick={() => setActiveMode("edit")}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={mode === "view"}
                        className={mode === "view" ? "active" : ""}
                        onClick={() => setActiveMode("view")}
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
                    <Suspense fallback={<div className="viewpane-loading" />}>
                      <ViewPane
                        content={editorContent}
                        onNavigate={(t) => void handleNavigate(t)}
                        onToggleTask={(next) => useEditorStore.getState().setContent(next)}
                      />
                    </Suspense>
                  )}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <div className="empty-kicker">{vault ? vaultName : "Local markdown"}</div>
                <h1>{vault ? "Choose a note" : "Open a markdown folder"}</h1>
                <p>
                  {vault
                    ? "Select a file from the sidebar or jump straight to a title."
                    : "Pick a folder of markdown files to open as your vault."}
                </p>
                <div className="empty-actions">
                  <button className="btn-primary" onClick={() => void handleOpenVault()} disabled={indexing}>
                    {indexing ? "Indexing…" : vault ? "Switch Vault" : "Choose a Folder"}
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
            <BacklinksPanel
              path={active.path}
              onOpenNote={(p) => void handleOpenNote(p)}
              onClose={() => setBacklinksOpen(false)}
            />
          )}
        </div>
      </div>

      <StatusBar />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenNote={(p) => void handleOpenNote(p)}
        onStatus={notify}
        createFolder={createFolder}
        onOpenSettings={() => {
          setPaletteOpen(false);
          setSettingsOpen(true);
        }}
        vaultOpen={!!vault}
        onOpenDiagnostics={(tab) => setDiag({ open: true, tab })}
        activeNotePath={active?.path ?? null}
        onRenameActive={() => {
          if (active) setAction({ kind: "rename", path: active.path, title: active.title });
        }}
        onDeleteActive={() => {
          if (!active) return;
          if (useSettingsStore.getState().settings.confirm_before_delete) {
            setAction({ kind: "delete", path: active.path, title: active.title });
          } else {
            void handleConfirmDelete(active.path);
          }
        }}
        onShowBacklinks={() => setBacklinksOpen((o) => !o)}
        onOpenSearch={() => setSearchOpen(true)}
        onRebuildIndex={() => void handleRebuild()}
        onExportHtml={() => void handleExportHtml()}
        onPrintNote={() => void handlePrintNote()}
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
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <DiagnosticsPanel
        open={diag.open}
        tab={diag.tab}
        onClose={() => setDiag((d) => ({ open: false, tab: d.tab }))}
        onOpenNote={(p) => void handleOpenNote(p)}
        onCreateMissing={(t) => void handleCreateMissing(t)}
        onStatus={notify}
      />
      {menu && (
        <FileMenu x={menu.x} y={menu.y} onAction={handleFileAction} onClose={() => setMenu(null)} />
      )}
      {action?.kind === "rename" && (
        <ActionDialog
          title="Rename note"
          defaultValue={action.title}
          confirmLabel="Rename"
          onConfirm={(v) => void handleConfirmRename(v)}
          onCancel={() => setAction(null)}
        />
      )}
      {action?.kind === "move" && (
        <ActionDialog
          title="Move to folder"
          placeholder="e.g. Projects/Archive"
          confirmLabel="Move"
          onConfirm={(v) => void handleConfirmMove(v)}
          onCancel={() => setAction(null)}
        />
      )}
      {action?.kind === "delete" && (
        <ActionDialog
          title="Delete note"
          message={`Delete “${action.title}”? This removes the file from disk.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => void handleConfirmDelete(action.path)}
          onCancel={() => setAction(null)}
        />
      )}
      {action?.kind === "create" && (
        <ActionDialog
          title="New note"
          placeholder="Note title"
          confirmLabel="Create"
          onConfirm={(v) => void handleConfirmCreate(v)}
          onCancel={() => setAction(null)}
        />
      )}
      <Toasts />
    </div>
  );
}
