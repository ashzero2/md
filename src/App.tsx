// Main layout: tree sidebar | editor/view | status bar.
// Modes: `edit` (CodeMirror) and `view` (rendered markdown), toggled with Cmd+E.

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import "./App.css";
import {
  getNote,
  resolveLink,
  saveNote,
} from "./lib/ipc";
import type { NoteContent, VaultInfo } from "./lib/types";
import {
  BookOpen,
  ArrowLeftRight,
  Clock3,
  Columns2,
  Folder as FolderIcon,
  Link2,
  List,
  PanelLeftClose,
  PanelLeftOpen,
  PencilLine,
  Pin,
  Plus,
  Search,
  Star,
  X,
} from "lucide-react";
import NoteMenu from "./components/NoteMenu";
import type { NoteMenuAction } from "./components/NoteMenu";
import Tree from "./components/Tree";
import EditorPane from "./components/EditorPane";
const ViewPane = lazy(() => import("./components/ViewPane"));
import StatusBar from "./components/StatusBar";
import FullSearch from "./components/FullSearch";
import CommandPalette from "./components/CommandPalette";
import TagSidebar from "./components/TagSidebar";
import SidebarNoteList from "./components/SidebarNoteList";
import BacklinksPanel from "./components/BacklinksPanel";
import ConflictDialog from "./components/ConflictDialog";
import SettingsSheet from "./components/SettingsSheet";
import FileMenu from "./components/FileMenu";
import ActionDialog from "./components/ActionDialog";
import DiagnosticsPanel from "./components/DiagnosticsPanel";
import type { DiagTab } from "./components/DiagnosticsPanel";
import type { NoteAction } from "./components/FileMenu";
import { useSettingsStore } from "./store/settings";
import { useToastStore } from "./store/toast";
import Toasts from "./components/Toasts";
import { useEditorStore, type EditorMode, type NoteTab } from "./store/editor";
import { eventOpensInBackground, type OpenNoteOptions } from "./lib/open-intent";

// Hooks
import { useBacklinksCount } from "./hooks/useBacklinksCount";
import { useContextMenus } from "./hooks/useContextMenus";
import { useSplitPane } from "./hooks/useSplitPane";
import { useSidebarLists } from "./hooks/useSidebarLists";
import { useTabManagement } from "./hooks/useTabManagement";
import { useWorkspacePersistence } from "./hooks/useWorkspacePersistence";
import { useNoteActions } from "./hooks/useNoteActions";
import { useVaultRefresh } from "./hooks/useVaultRefresh";
import { useVaultLifecycle } from "./hooks/useVaultLifecycle";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";

type SidebarView = "files" | "favorites" | "recent" | "backlinks";
type WorkspacePane = "main" | "secondary";

function fileTitleFromPath(path: string) {
  return (path.split(/[\\/]/).pop() ?? path).replace(/\.md$/i, "");
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
  // ---- Editor store ----
  const openNote = useEditorStore((s) => s.openNote);
  const activateTab = useEditorStore((s) => s.activateTab);
  const reopenClosedTab = useEditorStore((s) => s.reopenClosedTab);
  const setTabMode = useEditorStore((s) => s.setTabMode);
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const closedTabs = useEditorStore((s) => s.closedTabs);
  const editorContent = useEditorStore((s) => s.content);
  const conflict = useEditorStore((s) => s.conflict);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const mode: EditorMode = activeTab?.mode ?? "edit";

  // ---- Vault + file list state (owned here so both useVaultRefresh and useVaultLifecycle share them) ----
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [files, setFiles] = useState<import("./lib/types").NoteMeta[]>([]);
  const [tree, setTree] = useState<import("./lib/types").FileNode[]>([]);
  const [indexing, setIndexing] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<NoteContent | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [diag, setDiag] = useState<{ open: boolean; tab: DiagTab }>({ open: false, tab: "broken" });
  const [sidebarView, setSidebarView] = useState<SidebarView>("files");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const activeRef = useRef<NoteContent | null>(null);
  useEffect(() => { activeRef.current = active; }, [active]);

  // Keep active in sync with the active tab's content
  useEffect(() => {
    setActive(activeTab ? noteFromTab(activeTab) : null);
  }, [activeTab?.content, activeTab?.path, activeTab?.title]);

  const notify = useToastStore((s) => s.push);
  const theme = useSettingsStore((s) => s.settings.theme);

  // ---- Split pane ----
  const splitPane = useSplitPane();
  const {
    splitPaneOpen,
    focusedPane,
    secondaryPanePath,
    secondaryPaneMode,
    splitRatio,
    closeSecondaryPane,
  } = splitPane;

  const secondaryTab = tabs.find((tab) => tab.path === secondaryPanePath) ?? activeTab;
  const activePane: WorkspacePane = splitPaneOpen && focusedPane === "secondary" ? "secondary" : "main";
  const activePaneMode: EditorMode = activePane === "secondary" ? secondaryPaneMode : mode;

  const resetWorkspaceChrome = useCallback(() => {
    setSidebarView("files");
    setSidebarCollapsed(false);
    splitPane.setSplitPaneOpen(false);
    splitPane.setFocusedPane("main");
    splitPane.setSecondaryPanePath(null);
    splitPane.setSecondaryPaneMode("view");
  }, [splitPane]);

  const showSidebarView = useCallback((view: SidebarView) => {
    setSidebarView(view);
    setSidebarCollapsed(false);
  }, []);

  // ---- Context menus ----
  const contextMenus = useContextMenus();
  const { menu, tabMenu, tabListMenu, vaultMenuOpen, vaultMenuRef } = contextMenus;

  // ---- Sidebar lists ----
  const sidebarLists = useSidebarLists();
  const { recentNotes, favoriteNotes, activeTag, tagNotes, filesRef } = sidebarLists;

  // ---- Workspace persistence ----
  const workspacePersistence = useWorkspacePersistence({
    vault,
    tabs,
    activeTabId,
    sidebarView,
    sidebarCollapsed,
    splitPaneOpen,
    focusedPane,
    secondaryPanePath,
    secondaryPaneMode,
    recentPaths: recentNotes.map((n) => n.path),
    favoritePaths: favoriteNotes.map((n) => n.path),
  });
  const { suppressWorkspacePersistRef, restoreWorkspace } = workspacePersistence;

  // ---- Vault refresh (watcher-driven) ----
  // setFiles/setTree/setStatus/setError are owned by App.tsx so they can be
  // passed directly — no ref indirection needed.
  const { refresh, scheduleRefresh } = useVaultRefresh({
    activeRef,
    setFiles,
    setTree,
    setStatus,
    setError,
    onSyncSidebarLists: sidebarLists.syncWithFileList,
    onActiveReloaded: (note) => setActive(note),
    onActiveDeleted: (path) => {
      setActive(null);
      splitPane.setSecondaryPanePath((cur) => (cur === path ? null : cur));
    },
  });

  // ---- Vault lifecycle ----
  const { handleOpenVault } = useVaultLifecycle({
    vault,
    setVault,
    setFiles,
    setTree,
    setIndexing,
    setStatus,
    setError,
    refresh,
    scheduleRefresh,
    suppressWorkspacePersistRef,
    restoreWorkspace,
    onRestoredActive: (path, content, title) => {
      setActive({ path, content, title });
    },
    onSetSidebarView: setSidebarView,
    onSetSidebarCollapsed: setSidebarCollapsed,
    onSetSplitPane: (open, path, paneMode, pane) => {
      splitPane.setSplitPaneOpen(open);
      splitPane.setSecondaryPanePath(path);
      splitPane.setSecondaryPaneMode(paneMode);
      splitPane.setFocusedPane(pane);
    },
    onSetFavoriteNotes: sidebarLists.setFavoriteNotes,
    onSetRecentNotes: sidebarLists.setRecentNotes,
    resetWorkspaceChrome,
  });

  // Sync filesRef with the current files list
  useEffect(() => { filesRef.current = files; }, [files, filesRef]);

  // ---- Note actions ----
  const noteActions = useNoteActions();
  const { action, setAction } = noteActions;

  // ---- Tab management ----
  const tabMgmt = useTabManagement();
  const { draggingTabId, tabDropTarget, suppressNextTabClickRef } = tabMgmt;

  // ---- Open note ----
  const handleOpenNote = useCallback(
    async (path: string, options: OpenNoteOptions = {}) => {
      try {
        setError(null);
        const note = await getNote(path);
        const canUseSecondaryPane = !!activeRef.current || !!activeTab;
        const targetSecondary = options.pane === "secondary" && canUseSecondaryPane;
        const openInSecondary =
          targetSecondary ||
          (splitPaneOpen && focusedPane === "secondary" && !options.background && canUseSecondaryPane);
        const activate = openInSecondary ? false : !options.background || !activeRef.current;
        openNote(note.path, note.content, { title: fileTitleFromPath(note.path), activate, mode: "edit" });
        sidebarLists.rememberRecent(note.path);
        if (openInSecondary) {
          splitPane.setSplitPaneOpen(true);
          splitPane.setSecondaryPanePath(note.path);
          splitPane.setFocusedPane("secondary");
          if (targetSecondary) notify(`Opened ${fileTitleFromPath(note.path)} in split pane`);
        } else if (activate) {
          setActive(note);
        } else {
          notify(`Opened ${note.title} in the background`);
        }
      } catch (e) {
        setError(String(e));
      }
    },
    [activeTab, focusedPane, openNote, notify, sidebarLists, splitPane, splitPaneOpen],
  );

  // ---- Activate tab ----
  const handleActivateTab = useCallback(
    (id: string) => {
      const tab = useEditorStore.getState().tabs.find((t) => t.id === id);
      if (!tab) return;
      if (splitPaneOpen && focusedPane === "secondary") {
        splitPane.setSecondaryPanePath(tab.path);
        splitPane.setFocusedPane("secondary");
        return;
      }
      activateTab(id);
      setActive(noteFromTab(tab));
    },
    [activateTab, focusedPane, splitPane, splitPaneOpen],
  );

  // ---- Close active tab via keyboard ----
  const handleCloseActiveTab = useCallback(() => {
    if (!activeTabId) return;
    void tabMgmt.handleCloseTab(
      activeTabId,
      secondaryPanePath,
      closeSecondaryPane,
      notify,
      (e) => setError(e),
    );
  }, [activeTabId, closeSecondaryPane, notify, secondaryPanePath, tabMgmt]);

  // ---- Conflict resolution ----
  const handleConflictKeepMine = useCallback(async () => {
    const c = useEditorStore.getState().conflict;
    if (!c) return;
    useEditorStore.getState().setConflict(null);
    try {
      await saveNote(c.path, c.editorContent);
      const fresh = await getNote(c.path);
      setActive(fresh);
      openNote(fresh.path, fresh.content, { title: fileTitleFromPath(fresh.path), reload: true });
      notify(`Kept your changes — saved ${c.path}`);
    } catch (e) {
      setError(String(e));
    }
  }, [openNote, notify]);

  const handleConflictKeepTheirs = useCallback(async () => {
    const c = useEditorStore.getState().conflict;
    if (!c) return;
    useEditorStore.getState().setConflict(null);
    try {
      const fresh = await getNote(c.path);
      setActive(fresh);
      openNote(fresh.path, fresh.content, { title: fileTitleFromPath(fresh.path), reload: true });
      notify(`Discarded your edits — reloaded ${c.path}`);
    } catch (e) {
      setError(String(e));
    }
  }, [openNote, notify]);

  // ---- Navigate wikilinks ----
  const handleNavigate = useCallback(
    async (target: string, options: OpenNoteOptions = {}) => {
      try {
        const path = await resolveLink(target);
        if (path) {
          await handleOpenNote(path, options);
          if (!options.background) notify(`Opened ${target}`);
        } else {
          notify(`Note not found: ${target}`, "error");
        }
      } catch (e) {
        setError(String(e));
      }
    },
    [handleOpenNote, notify],
  );

  // ---- Pane mode helpers ----
  const setActiveMode = useCallback(
    (nextMode: EditorMode) => {
      if (!activeTabId) return;
      setTabMode(activeTabId, nextMode);
    },
    [activeTabId, setTabMode],
  );

  const setActivePaneMode = useCallback(
    (nextMode: EditorMode) => {
      if (activePane === "secondary") {
        splitPane.setSecondaryPaneMode(nextMode);
        return;
      }
      setActiveMode(nextMode);
    },
    [activePane, setActiveMode, splitPane],
  );

  const toggleActivePaneMode = useCallback(() => {
    setActivePaneMode(activePaneMode === "edit" ? "view" : "edit");
  }, [activePaneMode, setActivePaneMode]);

  const handleToggleSplitPane = useCallback(() => {
    splitPane.handleToggleSplitPane(activeRef.current?.path ?? activeTab?.path ?? null, mode);
  }, [activeTab?.path, mode, splitPane]);

  // ---- Global shortcuts ----
  useGlobalShortcuts({
    activeTabId,
    tabs,
    activePaneMode,
    handleActivateTab,
    handleCloseActiveTab,
    handleOpenVault,
    handleToggleSplitPane,
    toggleActivePaneMode,
    showSidebarView,
    reopenClosedTab,
    setPaletteOpen,
    setSearchOpen,
    setSettingsOpen,
  });

  // ---- Backlinks count ----
  const backlinksCount = useBacklinksCount(active?.path ?? null);

  // ---- Derived values ----
  const createFolder = useSettingsStore(
    (s) =>
      s.settings.default_new_note_location === "same_folder" && active ? dirname(active.path) : null,
  );
  const vaultName = vault?.root.split(/[\\/]/).filter(Boolean).pop() ?? "vault";
  const tabMenuTab = tabMenu ? tabs.find((tab) => tab.id === tabMenu.id) ?? null : null;
  const tabMenuIndex = tabMenuTab ? tabs.findIndex((tab) => tab.id === tabMenuTab.id) : -1;
  const tabMenuHasClosableRight =
    tabMenuIndex >= 0 && tabs.slice(tabMenuIndex + 1).some((tab) => !tab.pinned);
  const tabMenuHasClosableOthers = !!tabMenuTab && tabs.some((tab) => tab.id !== tabMenuTab.id && !tab.pinned);

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

  // ---- Confirm-delete wrapper (needs access to splitPane) ----
  const handleConfirmDelete = useCallback(
    async (path: string) => {
      contextMenus.setMenu(null);
      await noteActions.handleConfirmDelete(
        path,
        refresh,
        notify,
        (e) => setError(e),
        sidebarLists.setFavoriteNotes,
        sidebarLists.setRecentNotes,
        activeRef,
        splitPane.setSecondaryPanePath,
      );
    },
    [contextMenus, noteActions, notify, refresh, sidebarLists, splitPane],
  );

  // ---- Render helpers ----
  const renderPaneContent = (paneMode: EditorMode, tab: NoteTab | null = activeTab) => {
    const paneContent = tab?.content ?? editorContent;
    const editsActiveTab = !tab || tab.id === activeTabId;
    const handleTaskToggle = (next: string) => {
      if (tab && tab.id !== activeTabId) {
        useEditorStore.getState().setTabContent(tab.id, next);
        return;
      }
      useEditorStore.getState().setContent(next);
    };
    return paneMode === "edit" ? (
      <EditorPane tabId={editsActiveTab ? null : tab.id} content={editsActiveTab ? undefined : paneContent} />
    ) : (
      <Suspense fallback={<div className="viewpane-loading" />}>
        <ViewPane
          content={paneContent}
          onNavigate={(t, options) => void handleNavigate(t, options)}
          onToggleTask={handleTaskToggle}
        />
      </Suspense>
    );
  };

  const renderPaneModeIcon = (paneMode: EditorMode) =>
    paneMode === "edit" ? (
      <PencilLine size={13} strokeWidth={2} aria-hidden="true" />
    ) : (
      <BookOpen size={13} strokeWidth={2} aria-hidden="true" />
    );

  // ---- JSX ----
  return (
    <div className="app">
      <div className="body">
        <aside className={`sidebar${sidebarCollapsed && vault ? " collapsed" : ""}`}>
          <nav className="activity-rail" aria-label="Workspace navigation">
            {vault && (
              <>
                <button type="button" className="activity-button" onClick={() => setAction({ kind: "create" })} aria-label="New note" title="New note">
                  <Plus size={15} strokeWidth={2} aria-hidden="true" />
                </button>
                <button type="button" className="activity-button" onClick={() => setPaletteOpen(true)} aria-label="Jump to note" title="Jump to note">
                  <Search size={15} strokeWidth={2} aria-hidden="true" />
                </button>
                <div className="activity-divider" role="separator" aria-hidden="true" />
                <button type="button" className={`activity-button${sidebarView === "files" ? " active" : ""}`} onClick={() => showSidebarView("files")} aria-label="Show files" aria-pressed={sidebarView === "files"} title="Files (Cmd+Shift+1)">
                  <FolderIcon size={15} strokeWidth={2} aria-hidden="true" />
                </button>
                <button type="button" className={`activity-button${sidebarView === "favorites" ? " active" : ""}`} onClick={() => showSidebarView("favorites")} aria-label="Show favorites" aria-pressed={sidebarView === "favorites"} title="Favorites (Cmd+Shift+2)">
                  <Star size={15} strokeWidth={2} fill={sidebarView === "favorites" ? "currentColor" : "none"} aria-hidden="true" />
                </button>
                <button type="button" className={`activity-button${sidebarView === "recent" ? " active" : ""}`} onClick={() => showSidebarView("recent")} aria-label="Show recent notes" aria-pressed={sidebarView === "recent"} title="Recent (Cmd+Shift+3)">
                  <Clock3 size={15} strokeWidth={2} aria-hidden="true" />
                </button>
                <button type="button" className={`activity-button${sidebarView === "backlinks" ? " active" : ""}`} onClick={() => showSidebarView("backlinks")} aria-label={`Show backlinks${backlinksCount > 0 ? `, ${backlinksCount} backlinks` : ""}`} aria-pressed={sidebarView === "backlinks"} title="Backlinks (Cmd+Shift+4)">
                  <Link2 size={15} strokeWidth={2} aria-hidden="true" />
                  {backlinksCount > 0 && <span className="activity-count">{backlinksCount}</span>}
                </button>
              </>
            )}
            {vault && <div className="activity-rail-spacer" />}
            {vault && (
              <button type="button" className="activity-button" onClick={() => setSidebarCollapsed((c) => !c)} aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} aria-pressed={sidebarCollapsed} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
                {sidebarCollapsed ? <PanelLeftOpen size={15} strokeWidth={2} aria-hidden="true" /> : <PanelLeftClose size={15} strokeWidth={2} aria-hidden="true" />}
              </button>
            )}
          </nav>

          {(!sidebarCollapsed || !vault) && (
            <div className="sidebar-panel">
              {sidebarView === "backlinks" ? (
                <BacklinksPanel path={active?.path ?? null} onOpenNote={(p, options) => void handleOpenNote(p, options)} />
              ) : sidebarView === "favorites" ? (
                <SidebarNoteList
                  title="Favorites"
                  notes={favoriteNotes}
                  emptyText="Favorite notes from the note menu or file tree."
                  icon={<Star size={13} strokeWidth={2} fill="currentColor" aria-hidden="true" />}
                  activePath={active?.path ?? null}
                  onOpen={(path, event) => void handleOpenNote(path, { background: eventOpensInBackground(event) })}
                  action={(path) => (
                    <button type="button" className="sidebar-note-inline-action" onClick={() => sidebarLists.toggleFavorite(path, notify)} aria-label="Remove favorite" title="Remove favorite">
                      <Star size={12} strokeWidth={2} fill="currentColor" aria-hidden="true" />
                    </button>
                  )}
                />
              ) : sidebarView === "recent" ? (
                <SidebarNoteList
                  title="Recent"
                  notes={recentNotes}
                  emptyText="Open notes will appear here."
                  icon={<Clock3 size={13} strokeWidth={2} aria-hidden="true" />}
                  activePath={active?.path ?? null}
                  onOpen={(path, event) => void handleOpenNote(path, { background: eventOpensInBackground(event) })}
                  clearLabel="Clear"
                  onClear={sidebarLists.clearRecents}
                />
              ) : (
                <>
                  <h2>Files</h2>
                  {activeTag ? (
                    <div className="tag-filter">
                      <div className="tag-filter-head">
                        <span className="tag-filter-name">#{activeTag}</span>
                        <button className="btn-quiet" onClick={() => void sidebarLists.handleTagSelect(null, (e) => setError(e))}>Clear</button>
                      </div>
                      {tagNotes.length === 0 && <p className="muted">No notes with this tag.</p>}
                      <ul className="tag-filter-list">
                        {tagNotes.map((n) => (
                          <li key={n.path}>
                            <button
                              className={active?.path === n.path ? "active" : ""}
                              onClick={(e) => void handleOpenNote(n.path, { background: eventOpensInBackground(e) })}
                              onAuxClick={(e) => { if (e.button !== 1) return; e.preventDefault(); void handleOpenNote(n.path, { background: true }); }}
                            >
                              {n.title}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <>
                      {tree.length === 0 && <p className="muted">{vault ? "No notes yet." : "Open a folder to list notes here"}</p>}
                      <div className="tree-scroll">
                        <Tree
                          nodes={tree}
                          activePath={active?.path ?? null}
                          onOpen={(p, e) => void handleOpenNote(p, { background: eventOpensInBackground(e) })}
                          onContext={(path, x, y) => contextMenus.setMenu({ path, x: Math.min(x, window.innerWidth - 192), y: Math.min(y, window.innerHeight - 280) })}
                        />
                      </div>
                    </>
                  )}
                  <TagSidebar activeTag={activeTag} onSelectTag={(t) => void sidebarLists.handleTagSelect(t, (e) => setError(e))} />
                </>
              )}

              <div className="sidebar-foot">
                <div ref={vaultMenuRef} className={`vault-profile${vaultMenuOpen ? " open" : ""}`}>
                  <button className="vault-profile-trigger" onClick={() => contextMenus.setVaultMenuOpen(!vaultMenuOpen)} aria-expanded={vaultMenuOpen}>
                    <span className="vault-avatar" aria-hidden="true">{vault ? vaultName.slice(0, 1).toUpperCase() : "V"}</span>
                    <span className="vault-profile-copy">
                      <span className="vault-profile-name">{vault ? vaultName : "No vault open"}</span>
                      <span className="vault-profile-meta">{status || (vault ? "Ready" : "Open a folder")}</span>
                    </span>
                    <span className="vault-profile-arrow" aria-hidden="true" />
                  </button>
                  {vaultMenuOpen && (
                    <div className="vault-menu">
                      <button onClick={() => { contextMenus.setVaultMenuOpen(false); void handleOpenVault(); }} disabled={indexing}>
                        {indexing ? "Indexing..." : vault ? "Switch Vault..." : "Open Vault..."}
                      </button>
                      <button onClick={() => { const cur = useSettingsStore.getState().settings.theme; useSettingsStore.getState().update({ theme: cur === "system" ? "dark" : cur === "dark" ? "light" : "system" }); }}>
                        Theme: {themeLabel}
                      </button>
                      <button onClick={() => { contextMenus.setVaultMenuOpen(false); setSettingsOpen(true); }}>Settings…</button>
                      {vault && (
                        <>
                          <div className="file-menu-sep" />
                          <button onClick={() => { contextMenus.setVaultMenuOpen(false); setDiag({ open: true, tab: "broken" }); }}>Broken links…</button>
                          <button onClick={() => { contextMenus.setVaultMenuOpen(false); setDiag({ open: true, tab: "orphan" }); }}>Orphan notes…</button>
                          <button onClick={() => { contextMenus.setVaultMenuOpen(false); void noteActions.handleRebuild(refresh, notify, setIndexing, setStatus, (e) => setError(e)); }} disabled={indexing}>
                            Rebuild index…
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </aside>

        <div className="content-row">
          <main className="content">
            {error && <div className="error">{error}</div>}
            {active ? (
              <>
                <div className="tab-strip">
                  <div className="tab-strip-scroll" role="tablist" aria-label="Open notes">
                    {tabs.map((tab) => (
                      <div
                        key={tab.id}
                        data-tab-id={tab.id}
                        className={[
                          "note-tab",
                          tab.id === activeTabId ? "active" : "",
                          draggingTabId === tab.id ? "dragging" : "",
                          tabDropTarget?.id === tab.id ? `drop-target-${tabDropTarget.position}` : "",
                        ].filter(Boolean).join(" ")}
                        role="presentation"
                        onPointerDown={(e) => tabMgmt.handleTabPointerDown(e, tab.id)}
                        onPointerMove={tabMgmt.handleTabPointerMove}
                        onPointerUp={tabMgmt.handleTabPointerUp}
                        onPointerCancel={() => { tabMgmt.suppressNextTabClickRef.current = false; }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          contextMenus.setTabMenu({ id: tab.id, x: Math.min(e.clientX, window.innerWidth - 220), y: e.clientY });
                        }}
                      >
                        <button
                          type="button"
                          role="tab"
                          aria-selected={tab.id === activeTabId}
                          className="note-tab-main"
                          onClick={() => {
                            if (suppressNextTabClickRef.current) { suppressNextTabClickRef.current = false; return; }
                            handleActivateTab(tab.id);
                          }}
                        >
                          {tab.pinned && (
                            <>
                              <Pin className="note-tab-pin" size={11} strokeWidth={2.2} aria-hidden="true" />
                              <span className="note-tab-initial" aria-hidden="true">{tab.title.trim().slice(0, 1).toUpperCase() || "N"}</span>
                            </>
                          )}
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
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => void tabMgmt.handleCloseTab(tab.id, secondaryPanePath, closeSecondaryPane, notify, (e) => setError(e))}
                        >
                          <X size={12} strokeWidth={2.2} aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="note-actions">
                    <button type="button" className="toolbar-button icon-only" onClick={() => setAction({ kind: "create" })} aria-label="New note" title="New note">
                      <Plus size={15} strokeWidth={2} aria-hidden="true" />
                    </button>
                    <button type="button" className={`toolbar-button icon-only${tabListMenu ? " active" : ""}`} onPointerDown={(e) => e.stopPropagation()} onClick={contextMenus.handleToggleTabListMenu} aria-label="Show open tabs" aria-expanded={!!tabListMenu} title="Show open tabs">
                      <List size={15} strokeWidth={2} aria-hidden="true" />
                    </button>
                    <button type="button" className="toolbar-button mode-toggle" onClick={toggleActivePaneMode} aria-label={activePaneMode === "edit" ? "Switch focused pane to reading" : "Switch focused pane to editing"} title={activePaneMode === "edit" ? "Switch focused pane to reading" : "Switch focused pane to editing"}>
                      {activePaneMode === "edit" ? <PencilLine size={15} strokeWidth={2} aria-hidden="true" /> : <BookOpen size={15} strokeWidth={2} aria-hidden="true" />}
                    </button>
                    <button type="button" className={`toolbar-button icon-only${splitPaneOpen ? " active" : ""}`} onClick={handleToggleSplitPane} aria-label={splitPaneOpen ? "Close split pane" : "Split right"} aria-pressed={splitPaneOpen} title={splitPaneOpen ? "Close split pane (Cmd+\\)" : "Split right (Cmd+\\)"}>
                      <Columns2 size={15} strokeWidth={2} aria-hidden="true" />
                    </button>
                    <NoteMenu
                      disabled={!active}
                      isFavorite={active ? favoriteNotes.some((n) => n.path === active.path) : false}
                      onAction={(a: NoteMenuAction) =>
                        noteActions.handleNoteAction(
                          a, active,
                          (path, n) => sidebarLists.toggleFavorite(path, n),
                          handleConfirmDelete,
                          () => noteActions.handleExportHtml(active, editorContent, notify, (e) => setError(e)),
                          () => noteActions.handlePrintNote(active, editorContent, notify, (e) => setError(e)),
                          notify,
                          (e) => setError(e),
                        )
                      }
                    />
                  </div>
                </div>

                <div className={`note-stage mode-${mode}${splitPaneOpen ? " split-open" : ""}`}>
                  {splitPaneOpen ? (
                    <div className="split-workspace" style={{ gridTemplateColumns: `minmax(0, ${splitRatio}fr) 5px minmax(0, ${1 - splitRatio}fr)` }}>
                      <section className={`workspace-pane${activePane === "main" ? " focused" : ""}`} onPointerDown={() => splitPane.setFocusedPane("main")}>
                        <div className="workspace-pane-head">
                          <span className="workspace-pane-title">{activeTab?.title ?? active.title}</span>
                          <span className="workspace-pane-mode" title={mode === "edit" ? "Editing" : "Reading"}>{renderPaneModeIcon(mode)}</span>
                          <button type="button" className="workspace-pane-close" onClick={(e) => { e.stopPropagation(); splitPane.handleOpenActiveInOtherPane(activeTab?.path ?? null, mode); }} aria-label="Open in other pane" title="Open in other pane">
                            <ArrowLeftRight size={13} strokeWidth={2.2} aria-hidden="true" />
                          </button>
                        </div>
                        <div className={`workspace-pane-body mode-${mode}`}>{renderPaneContent(mode, activeTab)}</div>
                      </section>
                      <div
                        className="split-divider"
                        onPointerDown={splitPane.handleSplitDividerPointerDown}
                        onPointerMove={splitPane.handleSplitDividerPointerMove}
                        onPointerUp={splitPane.handleSplitDividerPointerUp}
                        onPointerCancel={() => { (splitPane as unknown as { splitDragRef?: { current: null } }).splitDragRef && void 0; }}
                        aria-hidden="true"
                      />
                      <section className={`workspace-pane secondary${activePane === "secondary" ? " focused" : ""}`} onPointerDown={() => splitPane.setFocusedPane("secondary")}>
                        <div className="workspace-pane-head">
                          <span className="workspace-pane-title">{secondaryTab?.title ?? active.title}</span>
                          <span className="workspace-pane-mode" title={secondaryPaneMode === "edit" ? "Editing" : "Reading"}>{renderPaneModeIcon(secondaryPaneMode)}</span>
                          <button type="button" className="workspace-pane-close" onClick={(e) => { e.stopPropagation(); splitPane.handleSwapPanes(activeTab?.path ?? null, activateTab, tabs); }} aria-label="Swap panes" title="Swap panes">
                            <ArrowLeftRight size={13} strokeWidth={2.2} aria-hidden="true" />
                          </button>
                          <button type="button" className="workspace-pane-close" onClick={(e) => { e.stopPropagation(); closeSecondaryPane(); }} aria-label="Close split pane" title="Close split pane">
                            <X size={13} strokeWidth={2.2} aria-hidden="true" />
                          </button>
                        </div>
                        <div className={`workspace-pane-body mode-${secondaryPaneMode}`}>{renderPaneContent(secondaryPaneMode, secondaryTab)}</div>
                      </section>
                    </div>
                  ) : (
                    <div className={`pane-body mode-${mode}`}>{renderPaneContent(mode, activeTab)}</div>
                  )}
                </div>
              </>
            ) : (
              <div className="empty-state">
                {vault ? (
                  <button className="empty-cta" onClick={() => setAction({ kind: "create" })}>New note</button>
                ) : (
                  <button className="empty-cta" onClick={() => void handleOpenVault()}>Open Vault…</button>
                )}
              </div>
            )}
          </main>
          <StatusBar />
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenNote={(p, options) => void handleOpenNote(p, options)}
        onStatus={notify}
        createFolder={createFolder}
        onOpenSettings={() => { setPaletteOpen(false); setSettingsOpen(true); }}
        vaultOpen={!!vault}
        onOpenDiagnostics={(tab) => setDiag({ open: true, tab })}
        activeNotePath={active?.path ?? null}
        onRenameActive={() => { if (active) setAction({ kind: "rename", path: active.path, title: active.title }); }}
        onDeleteActive={() => { if (!active) return; if (useSettingsStore.getState().settings.confirm_before_delete) { setAction({ kind: "delete", path: active.path, title: active.title }); } else { void handleConfirmDelete(active.path); } }}
        onShowBacklinks={() => showSidebarView("backlinks")}
        onOpenSearch={() => setSearchOpen(true)}
        onRebuildIndex={() => void noteActions.handleRebuild(refresh, notify, setIndexing, setStatus, (e) => setError(e))}
        onExportHtml={() => void noteActions.handleExportHtml(active, editorContent, notify, (e) => setError(e))}
        onPrintNote={() => void noteActions.handlePrintNote(active, editorContent, notify, (e) => setError(e))}
      />
      <FullSearch open={searchOpen} onClose={() => setSearchOpen(false)} onOpenNote={(p, options) => void handleOpenNote(p, options)} />
      {conflict && (
        <ConflictDialog conflict={conflict} onKeepMine={() => void handleConflictKeepMine()} onKeepTheirs={() => void handleConflictKeepTheirs()} />
      )}
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <DiagnosticsPanel
        open={diag.open}
        tab={diag.tab}
        onClose={() => setDiag((d) => ({ open: false, tab: d.tab }))}
        onOpenNote={(p, options) => void handleOpenNote(p, options)}
        onCreateMissing={(t) => void noteActions.handleCreateMissing(t, createFolder, refresh, (e) => setError(e), notify)}
        onStatus={notify}
      />
      {menu && (
        <FileMenu
          x={menu.x}
          y={menu.y}
          isFavorite={favoriteNotes.some((n) => n.path === menu.path)}
          onAction={(a: NoteAction) =>
            noteActions.handleFileAction(
              a, menu,
              () => contextMenus.setMenu(null),
              (path, n) => sidebarLists.toggleFavorite(path, n),
              (path) => handleOpenNote(path),
              (path) => handleOpenNote(path, { pane: "secondary" }),
              handleConfirmDelete,
              notify,
              (e) => setError(e),
            )
          }
          onClose={() => contextMenus.setMenu(null)}
        />
      )}
      {tabListMenu && (
        <div className="file-menu tab-list-menu" style={{ left: tabListMenu.x, top: tabListMenu.y }} role="menu" aria-label="Open tabs" onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
          <div className="tab-list-menu-head">Open tabs</div>
          {tabs.map((tab, index) => (
            <button key={tab.id} role="menuitem" className={`tab-list-item${tab.id === activeTabId ? " active" : ""}`} title={tab.path} onClick={() => { handleActivateTab(tab.id); contextMenus.setTabListMenu(null); }}>
              {tab.pinned ? <Pin className="tab-list-pin" size={12} strokeWidth={2.2} aria-hidden="true" /> : <span className="tab-list-index">{index + 1}</span>}
              <span className="tab-list-copy">
                <span className="tab-list-title">{tab.title}</span>
                <span className="tab-list-path">{tab.path}</span>
              </span>
              {(tab.saveState === "dirty" || tab.saveState === "error") && (
                <span className={`tab-list-dot ${tab.saveState}`} aria-label={tab.saveState === "error" ? "Save failed" : "Unsaved changes"} />
              )}
            </button>
          ))}
        </div>
      )}
      {tabMenu && tabMenuTab && (
        <div className="file-menu tab-menu" style={{ left: tabMenu.x, top: tabMenu.y }} role="menu" onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
          <button role="menuitem" onClick={() => splitPane.handleOpenTabInSplitPane(tabMenuTab, () => contextMenus.setTabMenu(null))}>Open in split pane</button>
          <div className="file-menu-sep" />
          <button role="menuitem" onClick={() => tabMgmt.handleTabCopyPath(tabMenuTab, () => contextMenus.setTabMenu(null), notify, (e) => setError(e))}>Copy path</button>
          <button role="menuitem" onClick={() => tabMgmt.handleTabCopyMarkdownLink(tabMenuTab, () => contextMenus.setTabMenu(null), notify, (e) => setError(e))}>Copy markdown link</button>
          <button role="menuitem" onClick={() => tabMgmt.handleTabRevealInFinder(tabMenuTab, () => contextMenus.setTabMenu(null), (e) => setError(e))}>Reveal in Finder</button>
          <div className="file-menu-sep" />
          <button role="menuitem" onClick={() => tabMgmt.handleTogglePinTab(tabMenuTab.id, () => contextMenus.setTabMenu(null))}>{tabMenuTab.pinned ? "Unpin tab" : "Pin tab"}</button>
          <div className="file-menu-sep" />
          <button role="menuitem" onClick={() => { contextMenus.setTabMenu(null); void tabMgmt.handleCloseTab(tabMenuTab.id, secondaryPanePath, closeSecondaryPane, notify, (e) => setError(e)); }}>Close</button>
          <button role="menuitem" disabled={tabs.every((t) => t.pinned)} onClick={() => void tabMgmt.handleCloseUnpinnedTabs(secondaryPanePath, closeSecondaryPane, () => contextMenus.setTabMenu(null), notify)}>Close unpinned tabs</button>
          <button role="menuitem" disabled={!tabMenuHasClosableOthers} onClick={() => void tabMgmt.handleCloseOtherTabs(tabMenuTab.id, secondaryPanePath, closeSecondaryPane, () => contextMenus.setTabMenu(null), notify)}>Close others</button>
          <button role="menuitem" disabled={!tabMenuHasClosableRight} onClick={() => void tabMgmt.handleCloseTabsToRight(tabMenuTab.id, secondaryPanePath, closeSecondaryPane, () => contextMenus.setTabMenu(null), notify)}>Close tabs to right</button>
          <div className="file-menu-sep" />
          <button role="menuitem" disabled={closedTabs.length === 0} onClick={() => { contextMenus.setTabMenu(null); reopenClosedTab(); }}>Reopen closed tab</button>
        </div>
      )}
      {action?.kind === "rename" && (
        <ActionDialog title="Rename note" defaultValue={action.title} confirmLabel="Rename"
          onConfirm={(v) => void noteActions.handleConfirmRename(v, filesRef, refresh, notify, (e) => setError(e), sidebarLists.setFavoriteNotes, sidebarLists.setRecentNotes, activeRef)}
          onCancel={() => setAction(null)} />
      )}
      {action?.kind === "move" && (
        <ActionDialog title="Move to folder" placeholder="e.g. Projects/Archive" confirmLabel="Move"
          onConfirm={(v) => void noteActions.handleConfirmMove(v, filesRef, refresh, notify, (e) => setError(e), sidebarLists.setFavoriteNotes, sidebarLists.setRecentNotes, activeRef)}
          onCancel={() => setAction(null)} />
      )}
      {action?.kind === "delete" && (
        <ActionDialog title="Delete note" message={`Delete "${action.title}"? This removes the file from disk.`} confirmLabel="Delete" danger
          onConfirm={() => void handleConfirmDelete(action.path)}
          onCancel={() => setAction(null)} />
      )}
      {action?.kind === "create" && (
        <ActionDialog title="New note" placeholder="Note title" confirmLabel="Create"
          onConfirm={(v) => void noteActions.handleConfirmCreate(v, createFolder, refresh, handleOpenNote, notify, (e) => setError(e))}
          onCancel={() => setAction(null)} />
      )}
      <Toasts />
    </div>
  );
}
