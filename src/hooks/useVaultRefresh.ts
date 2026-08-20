import { useCallback, useRef } from "react";
import { countFiles, getNote, listFiles, listTree } from "../lib/ipc";
import { useEditorStore } from "../store/editor";
import type { SaveState } from "../store/editor";
import type { FileNode, NoteContent, NoteMeta } from "../lib/types";

function fileTitleFromPath(path: string) {
  return (path.split(/[\\/]/).pop() ?? path).replace(/\.md$/i, "");
}

export interface VaultRefreshState {
  refresh: () => Promise<void>;
  scheduleRefresh: () => void;
  saveStateRef: React.MutableRefObject<SaveState>;
}

/**
 * Owns the filesystem-watcher event subscription and the coalesced refresh
 * cycle. On each refresh: updates file/tree lists, checks whether the active
 * note changed on disk (conflict detection), and handles external deletion.
 *
 * ## Refresh optimization
 * Before fetching the full file list, a lightweight `countFiles()` call checks
 * whether the index actually changed. If the count is identical to the last
 * known count, the sidebar list/tree update is skipped entirely and only the
 * active-note check runs. This avoids transferring and re-rendering the full
 * file list on every autosave watcher event.
 */
export function useVaultRefresh(params: {
  activeRef: React.MutableRefObject<NoteContent | null>;
  setFiles: React.Dispatch<React.SetStateAction<NoteMeta[]>>;
  setTree: React.Dispatch<React.SetStateAction<FileNode[]>>;
  setStatus: (msg: string) => void;
  setError: (msg: string) => void;
  onSyncSidebarLists: (list: NoteMeta[]) => void;
  onActiveDeleted: (path: string) => void;
}): VaultRefreshState {
  const {
    activeRef,
    setFiles,
    setTree,
    setStatus,
    setError,
    onSyncSidebarLists,
    onActiveDeleted,
  } = params;

  const saveState = useEditorStore((s) => s.saveState);
  const saveStateRef = useRef<SaveState>("saved");
  saveStateRef.current = saveState;

  const openNote = useEditorStore((s) => s.openNote);
  const closeTabsByPath = useEditorStore((s) => s.closeTabsByPath);

  // Tracks the last known file count so we can skip the full list/tree fetch
  // when the count hasn't changed (e.g. pure autosave events).
  const prevCountRef = useRef<number>(-1);

  const refresh = useCallback(async () => {
    try {
      // Lightweight count check before fetching the full list.
      const count = await countFiles();
      if (count !== prevCountRef.current) {
        // Index changed (file created, deleted, renamed) → full update.
        prevCountRef.current = count;
        const [list, treeNodes] = await Promise.all([listFiles(), listTree()]);
        setFiles(list);
        setTree(treeNodes);
        onSyncSidebarLists(list);
        setStatus(`${list.length} files indexed`);
        window.dispatchEvent(new Event("vault-changed-ui")); // triggers tag sidebar refresh
      }

      // Always check the active note regardless of whether the index changed.
      // (A pure autosave by the user or an external edit needs conflict detection.)
      const current = activeRef.current;
      if (!current) return;

      // Our own autosave also fires the watcher — ignore those events.
      if (saveStateRef.current === "saving") return;

      const dirty = saveStateRef.current === "dirty" || saveStateRef.current === "error";
      try {
        const fresh = await getNote(current.path);
        const store = useEditorStore.getState();
        if (dirty) {
          // Only flag a conflict when disk content differs from what WE last wrote.
          if (fresh.content !== store.savedContent) {
            store.setConflict({
              path: current.path,
              diskContent: fresh.content,
              editorContent: store.content,
            });
          }
        } else {
          openNote(fresh.path, fresh.content, { title: fileTitleFromPath(fresh.path), reload: true });
          // active in App.tsx re-derives from the store automatically after openNote.
        }
      } catch {
        // Active note was deleted externally
        closeTabsByPath(current.path);
        onActiveDeleted(current.path);
      }
    } catch (e) {
      setError(String(e));
    }
  }, [activeRef, closeTabsByPath, onActiveDeleted, onSyncSidebarLists, openNote, setError, setFiles, setStatus, setTree]);

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      void refresh();
    }, 200);
  }, [refresh]);

  return { refresh, scheduleRefresh, saveStateRef };
}
