import { useCallback, useState } from "react";
import {
  copyText,
  createNote,
  deleteNoteFile,
  getNote,
  moveNote,
  openHtmlPreview,
  rebuildIndex,
  renameNote,
  revealNote,
  writeTextFile,
} from "../lib/ipc";
import { useEditorStore } from "../store/editor";
import { useSettingsStore } from "../store/settings";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import type { NoteContent, NoteMeta } from "../lib/types";
import type { NoteAction } from "../components/FileMenu";
import type { NoteMenuAction } from "../components/NoteMenu";

function fileTitleFromPath(path: string) {
  return (path.split(/[\\/]/).pop() ?? path).replace(/\.md$/i, "");
}

function notesFromPaths(
  paths: string[],
  files: NoteMeta[],
  options: { keepMissing?: boolean } = {},
): NoteMeta[] {
  const seen = new Set<string>();
  const notes: NoteMeta[] = [];
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    const note = files.find((f) => f.path === path);
    if (note) {
      notes.push({ ...note, title: fileTitleFromPath(note.path) });
    } else if (options.keepMissing) {
      notes.push({ path, title: fileTitleFromPath(path), tags: [] });
    }
  }
  return notes;
}

export type NoteActionKind =
  | { kind: "rename"; path: string; title: string }
  | { kind: "move"; path: string }
  | { kind: "delete"; path: string; title: string }
  | { kind: "create" }
  | null;

export interface NoteActionsState {
  action: NoteActionKind;
  setAction: React.Dispatch<React.SetStateAction<NoteActionKind>>;
  handleFileAction: (
    a: NoteAction,
    menu: { path: string } | null,
    clearMenu: () => void,
    toggleFavorite: (path: string, notify: (msg: string) => void) => void,
    handleOpenNote: (path: string) => Promise<void>,
    handleOpenNoteSplit: (path: string) => Promise<void>,
    handleConfirmDelete: (path: string) => Promise<void>,
    notify: (msg: string) => void,
    setError: (e: string) => void,
  ) => void;
  handleNoteAction: (
    a: NoteMenuAction,
    active: NoteContent | null,
    toggleFavorite: (path: string, notify: (msg: string) => void) => void,
    handleConfirmDelete: (path: string) => Promise<void>,
    handleExportHtml: () => Promise<void>,
    handlePrintNote: () => Promise<void>,
    notify: (msg: string) => void,
    setError: (e: string) => void,
  ) => void;
  handleConfirmRename: (
    rawTitle: string,
    filesRef: React.MutableRefObject<NoteMeta[]>,
    refresh: () => Promise<void>,
    notify: (msg: string) => void,
    setError: (e: string) => void,
    setFavoriteNotes: React.Dispatch<React.SetStateAction<NoteMeta[]>>,
    setRecentNotes: React.Dispatch<React.SetStateAction<NoteMeta[]>>,
    activeRef: React.MutableRefObject<NoteContent | null>,
  ) => Promise<void>;
  handleConfirmMove: (
    folder: string,
    filesRef: React.MutableRefObject<NoteMeta[]>,
    refresh: () => Promise<void>,
    notify: (msg: string) => void,
    setError: (e: string) => void,
    setFavoriteNotes: React.Dispatch<React.SetStateAction<NoteMeta[]>>,
    setRecentNotes: React.Dispatch<React.SetStateAction<NoteMeta[]>>,
    activeRef: React.MutableRefObject<NoteContent | null>,
  ) => Promise<void>;
  handleConfirmDelete: (
    path: string,
    refresh: () => Promise<void>,
    notify: (msg: string) => void,
    setError: (e: string) => void,
    setFavoriteNotes: React.Dispatch<React.SetStateAction<NoteMeta[]>>,
    setRecentNotes: React.Dispatch<React.SetStateAction<NoteMeta[]>>,
    activeRef: React.MutableRefObject<NoteContent | null>,
    setSecondaryPanePath: (v: string | null | ((prev: string | null) => string | null)) => void,
  ) => Promise<void>;
  handleConfirmCreate: (
    rawTitle: string,
    createFolder: string | null,
    refresh: () => Promise<void>,
    handleOpenNote: (path: string) => Promise<void>,
    notify: (msg: string) => void,
    setError: (e: string) => void,
  ) => Promise<void>;
  handleCreateMissing: (
    target: string,
    createFolder: string | null,
    refresh: () => Promise<void>,
    setError: (e: string) => void,
    notify: (msg: string) => void,
  ) => Promise<void>;
  handleRebuild: (
    refresh: () => Promise<void>,
    notify: (msg: string) => void,
    setIndexing: (v: boolean) => void,
    setStatus: (v: string) => void,
    setError: (e: string) => void,
  ) => Promise<void>;
  handleExportHtml: (
    active: NoteContent | null,
    editorContent: string,
    notify: (msg: string) => void,
    setError: (e: string) => void,
  ) => Promise<void>;
  handlePrintNote: (
    active: NoteContent | null,
    editorContent: string,
    notify: (msg: string) => void,
    setError: (e: string) => void,
  ) => Promise<void>;
}

/**
 * All note CRUD and export operations: rename, move, delete, create, rebuild
 * index, export HTML, print. Owns the `action` dialog state.
 */
export function useNoteActions(): NoteActionsState {
  const [action, setAction] = useState<NoteActionKind>(null);

  const updateNotePath = useEditorStore((s) => s.updateNotePath);
  const closeTabsByPath = useEditorStore((s) => s.closeTabsByPath);

  const handleFileAction = useCallback(
    (
      a: NoteAction,
      menu: { path: string } | null,
      clearMenu: () => void,
      toggleFavorite: (path: string, notify: (msg: string) => void) => void,
      handleOpenNote: (path: string) => Promise<void>,
      handleOpenNoteSplit: (path: string) => Promise<void>,
      handleConfirmDelete: (path: string) => Promise<void>,
      notify: (msg: string) => void,
      setError: (e: string) => void,
    ) => {
      if (!menu) return;
      const path = menu.path;
      clearMenu();
      const titleOf = () => getNote(path).then((n) => n.title).catch(() => null);
      switch (a) {
        case "open":
          void handleOpenNote(path);
          return;
        case "open-split":
          void handleOpenNoteSplit(path);
          return;
        case "toggle-favorite":
          toggleFavorite(path, notify);
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
          void revealNote(path).catch((e: unknown) => setError(String(e)));
          return;
        case "copy-wikilink":
          void titleOf().then((t) => {
            const title = t ?? path;
            void copyText(`[[${title}]]`)
              .then(() => notify(`Copied [[${title}]]`))
              .catch((e: unknown) => setError(String(e)));
          });
          return;
        case "copy-markdown":
          void titleOf().then((t) => {
            const title = t ?? path;
            void copyText(`[${title}](${path})`)
              .then(() => notify(`Copied markdown link for ${title}`))
              .catch((e: unknown) => setError(String(e)));
          });
          return;
      }
    },
    [],
  );

  const handleNoteAction = useCallback(
    (
      a: NoteMenuAction,
      active: NoteContent | null,
      toggleFavorite: (path: string, notify: (msg: string) => void) => void,
      handleConfirmDelete: (path: string) => Promise<void>,
      handleExportHtml: () => Promise<void>,
      handlePrintNote: () => Promise<void>,
      notify: (msg: string) => void,
      setError: (e: string) => void,
    ) => {
      if (!active) return;
      switch (a) {
        case "toggle-favorite":
          toggleFavorite(active.path, notify);
          break;
        case "rename":
          setAction({ kind: "rename", path: active.path, title: active.title });
          break;
        case "move":
          setAction({ kind: "move", path: active.path });
          break;
        case "copy-wikilink":
          void copyText(`[[${active.title}]]`)
            .then(() => notify(`Copied [[${active.title}]]`))
            .catch((e: unknown) => setError(String(e)));
          break;
        case "copy-markdown":
          void copyText(`[${active.title}](${active.path})`)
            .then(() => notify("Copied markdown link"))
            .catch((e: unknown) => setError(String(e)));
          break;
        case "export":
          void handleExportHtml();
          break;
        case "print":
          void handlePrintNote();
          break;
        case "reveal":
          void revealNote(active.path).catch((e: unknown) => setError(String(e)));
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
    [],
  );

  const handleConfirmRename = useCallback(
    async (
      rawTitle: string,
      filesRef: React.MutableRefObject<NoteMeta[]>,
      refresh: () => Promise<void>,
      notify: (msg: string) => void,
      setError: (e: string) => void,
      setFavoriteNotes: React.Dispatch<React.SetStateAction<NoteMeta[]>>,
      setRecentNotes: React.Dispatch<React.SetStateAction<NoteMeta[]>>,
      activeRef: React.MutableRefObject<NoteContent | null>,
    ) => {
      if (!action || action.kind !== "rename") return;
      const { path } = action;
      setAction(null);
      const title = rawTitle.trim();
      if (!title) return;
      try {
        const res = await renameNote(path, title);
        notify(`Renamed — ${res.links_updated} file(s) link-updated`);
        setFavoriteNotes((prev) =>
          notesFromPaths(
            prev.map((n) => (n.path === path ? res.path : n.path)),
            filesRef.current,
            { keepMissing: true },
          ),
        );
        setRecentNotes((prev) =>
          notesFromPaths(
            prev.map((n) => (n.path === path ? res.path : n.path)),
            filesRef.current,
            { keepMissing: true },
          ),
        );
        await refresh();
        const fresh = await getNote(res.path);
        updateNotePath(path, fresh.path, fileTitleFromPath(fresh.path), fresh.content);
        if (activeRef.current?.path === path) {
          activeRef.current = fresh;
        }
      } catch (e) {
        setError(String(e));
      }
    },
    [action, updateNotePath],
  );

  const handleConfirmMove = useCallback(
    async (
      folder: string,
      filesRef: React.MutableRefObject<NoteMeta[]>,
      refresh: () => Promise<void>,
      notify: (msg: string) => void,
      setError: (e: string) => void,
      setFavoriteNotes: React.Dispatch<React.SetStateAction<NoteMeta[]>>,
      setRecentNotes: React.Dispatch<React.SetStateAction<NoteMeta[]>>,
      activeRef: React.MutableRefObject<NoteContent | null>,
    ) => {
      if (!action || action.kind !== "move") return;
      const { path } = action;
      setAction(null);
      try {
        const res = await moveNote(path, folder.trim());
        notify(`Moved — ${res.links_updated} file(s) link-updated`);
        setFavoriteNotes((prev) =>
          notesFromPaths(
            prev.map((n) => (n.path === path ? res.path : n.path)),
            filesRef.current,
            { keepMissing: true },
          ),
        );
        setRecentNotes((prev) =>
          notesFromPaths(
            prev.map((n) => (n.path === path ? res.path : n.path)),
            filesRef.current,
            { keepMissing: true },
          ),
        );
        await refresh();
        const fresh = await getNote(res.path);
        updateNotePath(path, fresh.path, fileTitleFromPath(fresh.path), fresh.content);
        if (activeRef.current?.path === path) {
          activeRef.current = fresh;
        }
      } catch (e) {
        setError(String(e));
      }
    },
    [action, updateNotePath],
  );

  const handleConfirmDelete = useCallback(
    async (
      path: string,
      refresh: () => Promise<void>,
      notify: (msg: string) => void,
      setError: (e: string) => void,
      setFavoriteNotes: React.Dispatch<React.SetStateAction<NoteMeta[]>>,
      setRecentNotes: React.Dispatch<React.SetStateAction<NoteMeta[]>>,
      activeRef: React.MutableRefObject<NoteContent | null>,
      setSecondaryPanePath: (v: string | null | ((prev: string | null) => string | null)) => void,
    ) => {
      setAction(null);
      try {
        await deleteNoteFile(path);
        await refresh();
        closeTabsByPath(path);
        setFavoriteNotes((prev) => prev.filter((n) => n.path !== path));
        setRecentNotes((prev) => prev.filter((n) => n.path !== path));
        if (activeRef.current?.path === path) activeRef.current = null;
        setSecondaryPanePath((current) => (current === path ? null : current));
        notify(`Deleted ${path}`);
      } catch (e) {
        setError(String(e));
      }
    },
    [closeTabsByPath],
  );

  const handleConfirmCreate = useCallback(
    async (
      rawTitle: string,
      createFolder: string | null,
      refresh: () => Promise<void>,
      handleOpenNote: (path: string) => Promise<void>,
      notify: (msg: string) => void,
      setError: (e: string) => void,
    ) => {
      setAction(null);
      const title = rawTitle.trim();
      if (!title) return;
      try {
        const note = await createNote(title, createFolder);
        await refresh();
        await handleOpenNote(note.path);
        notify(`Created "${note.title}"`);
      } catch (e) {
        setError(String(e));
      }
    },
    [],
  );

  const handleCreateMissing = useCallback(
    async (
      target: string,
      createFolder: string | null,
      refresh: () => Promise<void>,
      setError: (e: string) => void,
      notify: (msg: string) => void,
    ) => {
      try {
        const note = await createNote(target, createFolder);
        notify(`Created "${note.title}"`);
        await refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [],
  );

  const handleRebuild = useCallback(
    async (
      refresh: () => Promise<void>,
      notify: (msg: string) => void,
      setIndexing: (v: boolean) => void,
      setStatus: (v: string) => void,
      setError: (e: string) => void,
    ) => {
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
    },
    [],
  );

  const handleExportHtml = useCallback(
    async (
      active: NoteContent | null,
      editorContent: string,
      notify: (msg: string) => void,
      setError: (e: string) => void,
    ) => {
      if (!active) return;
      try {
        const { buildExportHtml } = await import("../lib/exportHtml");
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
    },
    [],
  );

  const handlePrintNote = useCallback(
    async (
      active: NoteContent | null,
      editorContent: string,
      notify: (msg: string) => void,
      setError: (e: string) => void,
    ) => {
      if (!active) return;
      try {
        const { buildExportHtml } = await import("../lib/exportHtml");
        const html = await buildExportHtml(editorContent, active.title);
        await openHtmlPreview(html, active.title);
        notify("Opened print preview — use Cmd+P to Save as PDF");
      } catch (e) {
        setError(String(e));
      }
    },
    [],
  );

  return {
    action,
    setAction,
    handleFileAction,
    handleNoteAction,
    handleConfirmRename,
    handleConfirmMove,
    handleConfirmDelete,
    handleConfirmCreate,
    handleCreateMissing,
    handleRebuild,
    handleExportHtml,
    handlePrintNote,
  };
}
