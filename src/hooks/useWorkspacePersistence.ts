import { useCallback, useEffect, useRef } from "react";
import { getNote } from "../lib/ipc";
import { useEditorStore } from "../store/editor";
import type { EditorMode, NoteTab } from "../store/editor";
import { readWorkspace, workspaceFromTabs, writeWorkspace } from "../lib/workspace";
import type { VaultInfo } from "../lib/types";

type WorkspacePane = "main" | "secondary";
type SidebarView = "files" | "favorites" | "recent" | "backlinks";

function fileTitleFromPath(path: string) {
  return (path.split(/[\\/]/).pop() ?? path).replace(/\.md$/i, "");
}

export interface WorkspacePersistenceState {
  suppressWorkspacePersistRef: React.MutableRefObject<boolean>;
  restoreWorkspace: (
    root: string,
    onRestoredActive: (path: string, content: string, title: string) => void,
    onSetSidebarView: (v: SidebarView) => void,
    onSetSidebarCollapsed: (v: boolean) => void,
    onSetSplitPane: (open: boolean, path: string | null, mode: EditorMode, focusedPane: WorkspacePane) => void,
  ) => Promise<boolean>;
}

/**
 * Persists workspace state (open tabs, pane layout, sidebar view, recents,
 * favorites) to localStorage on every relevant change. Also provides
 * restoreWorkspace for loading persisted state on vault open.
 */
export function useWorkspacePersistence(params: {
  vault: VaultInfo | null;
  tabs: NoteTab[];
  activeTabId: string | null;
  sidebarView: SidebarView;
  sidebarCollapsed: boolean;
  splitPaneOpen: boolean;
  focusedPane: WorkspacePane;
  secondaryPanePath: string | null;
  secondaryPaneMode: EditorMode;
  recentPaths: string[];
  favoritePaths: string[];
}): WorkspacePersistenceState {
  const {
    vault,
    tabs,
    activeTabId,
    sidebarView,
    sidebarCollapsed,
    splitPaneOpen,
    focusedPane,
    secondaryPanePath,
    secondaryPaneMode,
    recentPaths,
    favoritePaths,
  } = params;

  const suppressWorkspacePersistRef = useRef(false);

  // Stable key to detect tab list changes without deep equality
  const workspaceTabsKey = tabs
    .map((tab) => `${tab.path}\u001f${tab.mode}\u001f${tab.pinned ? "1" : "0"}`)
    .join("\u001e");
  const recentPathsKey = recentPaths.join("\u001e");
  const favoritePathsKey = favoritePaths.join("\u001e");

  useEffect(() => {
    if (!vault || suppressWorkspacePersistRef.current) return;
    writeWorkspace(
      vault.root,
      workspaceFromTabs(
        tabs,
        activeTabId,
        sidebarView === "backlinks",
        recentPaths,
        favoritePaths,
        {
          sidebarView,
          sidebarCollapsed,
          splitPaneOpen,
          focusedPane,
          secondaryPanePath,
          secondaryPaneMode,
        },
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    vault?.root,
    workspaceTabsKey,
    activeTabId,
    sidebarView,
    sidebarCollapsed,
    splitPaneOpen,
    focusedPane,
    secondaryPanePath,
    secondaryPaneMode,
    recentPathsKey,
    favoritePathsKey,
  ]);

  const openNote = useEditorStore((s) => s.openNote);

  const restoreWorkspace = useCallback(
    async (
      root: string,
      onRestoredActive: (path: string, content: string, title: string) => void,
      onSetSidebarView: (v: SidebarView) => void,
      onSetSidebarCollapsed: (v: boolean) => void,
      onSetSplitPane: (open: boolean, path: string | null, mode: EditorMode, focusedPane: WorkspacePane) => void,
    ): Promise<boolean> => {
      const workspace = readWorkspace(root);
      if (!workspace || workspace.tabs.length === 0) return false;

      let restoredAny = false;
      for (const tab of workspace.tabs) {
        try {
          const note = await getNote(tab.path);
          openNote(note.path, note.content, {
            title: fileTitleFromPath(note.path),
            activate: false,
            mode: tab.mode,
          });
          restoredAny = true;
        } catch {
          // Missing files are silently skipped; workspace compacts on next save.
        }
      }

      const store = useEditorStore.getState();
      for (const tab of workspace.tabs.filter((t) => t.pinned)) {
        const restored = store.tabs.find((c) => c.path === tab.path);
        if (restored && !restored.pinned) store.togglePinTab(restored.id);
      }

      const nextStore = useEditorStore.getState();
      const activeTab =
        nextStore.tabs.find((tab) => tab.path === workspace.activePath) ??
        nextStore.tabs[0] ??
        null;
      if (activeTab) {
        nextStore.activateTab(activeTab.id);
        onRestoredActive(activeTab.path, activeTab.content, activeTab.title);
      }

      const restoredPaths = new Set(nextStore.tabs.map((tab) => tab.path));
      const secondaryPath =
        workspace.secondaryPanePath && restoredPaths.has(workspace.secondaryPanePath)
          ? workspace.secondaryPanePath
          : activeTab?.path ?? null;

      onSetSidebarView(workspace.sidebarView);
      onSetSidebarCollapsed(workspace.sidebarCollapsed);
      onSetSplitPane(
        workspace.splitPaneOpen && !!secondaryPath,
        secondaryPath,
        workspace.secondaryPaneMode,
        workspace.splitPaneOpen ? workspace.focusedPane : "main",
      );

      return restoredAny;
    },
    [openNote],
  );

  return { suppressWorkspacePersistRef, restoreWorkspace };
}
