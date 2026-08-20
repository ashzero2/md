import { useCallback, useEffect, useRef } from "react";
import { listFiles, listTree, openVault, pickVaultFolder } from "../lib/ipc";
import { useEditorStore } from "../store/editor";
import { useSettingsStore } from "../store/settings";
import { readWorkspace } from "../lib/workspace";
import type { FileNode, NoteMeta, VaultInfo } from "../lib/types";
import type { EditorMode } from "../store/editor";

type WorkspacePane = "main" | "secondary";
type SidebarView = "files" | "favorites" | "recent" | "backlinks";

function notesFromPaths(paths: string[], files: NoteMeta[]): NoteMeta[] {
  const seen = new Set<string>();
  return paths.filter((p) => {
    if (seen.has(p)) return false;
    seen.add(p);
    return files.some((f) => f.path === p);
  }).map((p) => {
    const f = files.find((x) => x.path === p)!;
    return { ...f };
  });
}

function recentsFromPaths(paths: string[], files: NoteMeta[]): NoteMeta[] {
  return notesFromPaths(paths.slice(0, 6), files);
}

export interface VaultLifecycleState {
  handleOpenVault: () => Promise<void>;
}

/**
 * Manages the vault open/close lifecycle: picking a folder, opening a vault,
 * auto-reopening the last vault on launch, and subscribing to Rust-sourced
 * index progress and watcher events.
 *
 * All mutable state (vault, files, tree, indexing, status, error) is owned by
 * the parent (App) and received via setters, so sibling hooks can also access
 * them without circular hook dependencies.
 */
export function useVaultLifecycle(params: {
  vault: VaultInfo | null;
  setVault: (v: VaultInfo | null) => void;
  setFiles: React.Dispatch<React.SetStateAction<NoteMeta[]>>;
  setTree: React.Dispatch<React.SetStateAction<FileNode[]>>;
  setIndexing: React.Dispatch<React.SetStateAction<boolean>>;
  setStatus: (s: string) => void;
  setError: (e: string | null) => void;
  refresh: () => Promise<void>;
  scheduleRefresh: () => void;
  suppressWorkspacePersistRef: React.MutableRefObject<boolean>;
  restoreWorkspace: (
    root: string,
    onSetSidebarView: (v: SidebarView) => void,
    onSetSidebarCollapsed: (v: boolean) => void,
    onSetSplitPane: (open: boolean, path: string | null, mode: EditorMode, focusedPane: WorkspacePane) => void,
  ) => Promise<boolean>;
  onSetSidebarView: (v: SidebarView) => void;
  onSetSidebarCollapsed: (v: boolean) => void;
  onSetSplitPane: (open: boolean, path: string | null, mode: EditorMode, focusedPane: WorkspacePane) => void;
  onSetFavoriteNotes: (notes: NoteMeta[]) => void;
  onSetRecentNotes: (notes: NoteMeta[]) => void;
  resetWorkspaceChrome: () => void;
}): VaultLifecycleState {
  const {
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
    onSetSidebarView,
    onSetSidebarCollapsed,
    onSetSplitPane,
    onSetFavoriteNotes,
    onSetRecentNotes,
    resetWorkspaceChrome,
  } = params;

  const resetEditor = useEditorStore((s) => s.reset);

  // Stable refs so watcher subscriptions don't re-subscribe on every render
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const scheduleRefreshRef = useRef(scheduleRefresh);
  scheduleRefreshRef.current = scheduleRefresh;

  const openVaultFull = useCallback(
    async (path: string) => {
      suppressWorkspacePersistRef.current = true;
      const info = await openVault(path);
      setVault(info);
      resetWorkspaceChrome();
      resetEditor();
      const [list, treeNodes] = await Promise.all([listFiles(), listTree()]);
      setFiles(list);
      setTree(treeNodes);
      const workspace = readWorkspace(info.root);
      onSetFavoriteNotes(notesFromPaths(workspace?.favoritePaths ?? [], list));
      onSetRecentNotes(recentsFromPaths(workspace?.recentPaths ?? [], list));
      await restoreWorkspace(info.root, onSetSidebarView, onSetSidebarCollapsed, onSetSplitPane);
      setStatus(`${info.files} files indexed`);
      suppressWorkspacePersistRef.current = false;
    },
    [
      onSetFavoriteNotes,
      onSetRecentNotes,
      onSetSidebarCollapsed,
      onSetSidebarView,
      onSetSplitPane,
      resetEditor,
      resetWorkspaceChrome,
      restoreWorkspace,
      setVault,
      suppressWorkspacePersistRef,
    ],
  );

  const handleOpenVault = useCallback(async () => {
    try {
      setError(null);
      const path = await pickVaultFolder();
      if (!path) return;
      setIndexing(true);
      setStatus("Indexing…");
      await openVaultFull(path);
    } catch (e) {
      setError(String(e));
      suppressWorkspacePersistRef.current = false;
    } finally {
      setIndexing(false);
    }
  }, [openVaultFull, suppressWorkspacePersistRef]);

  // Auto-reopen last vault on launch (runs once on mount)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await useSettingsStore.getState().load();
      const s = useSettingsStore.getState().settings;
      if (cancelled || !s.reopen_last_vault || !s.last_vault || vault) return;
      try {
        setIndexing(true);
        setStatus("Opening…");
        await openVaultFull(s.last_vault);
      } catch (e) {
        setError(String(e));
        suppressWorkspacePersistRef.current = false;
      } finally {
        if (!cancelled) setIndexing(false);
      }
    })();
    return () => { cancelled = true; };
    // Intentionally omitting vault — we only want to run on mount, not when
    // vault changes (user switching vault should use handleOpenVault).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to Rust-sourced events once for the app lifetime
  useEffect(() => {
    let disposed = false;
    const unlisten: Array<() => void> = [];
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten.push(
        await listen("vault-changed", () => {
          if (!disposed) scheduleRefreshRef.current();
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
          void refreshRef.current();
        }),
      );
    })();
    return () => {
      disposed = true;
      unlisten.forEach((u) => u());
    };
  }, []);

  return { handleOpenVault };
}
