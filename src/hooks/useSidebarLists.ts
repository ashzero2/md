import { useCallback, useRef, useState } from "react";
import { filesByTag } from "../lib/ipc";
import type { NoteMeta } from "../lib/types";

const MAX_RECENT_NOTES = 6;

function fileTitleFromPath(path: string) {
  return (path.split(/[\\/]/).pop() ?? path).replace(/\.md$/i, "");
}

function noteMetaForPath(path: string, files: NoteMeta[]): NoteMeta | null {
  return files.find((f) => f.path === path) ?? null;
}

function fallbackNoteMeta(path: string): NoteMeta {
  return { path, title: fileTitleFromPath(path), tags: [] };
}

function notesFromPaths(
  paths: string[],
  files: NoteMeta[],
  options: { keepMissing?: boolean; limit?: number } = {},
): NoteMeta[] {
  const seen = new Set<string>();
  const notes: NoteMeta[] = [];
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    const note = noteMetaForPath(path, files) ?? (options.keepMissing ? fallbackNoteMeta(path) : null);
    if (note) notes.push({ ...note, title: fileTitleFromPath(note.path) });
    if (options.limit && notes.length >= options.limit) break;
  }
  return notes;
}

export interface SidebarListsState {
  recentNotes: NoteMeta[];
  setRecentNotes: React.Dispatch<React.SetStateAction<NoteMeta[]>>;
  favoriteNotes: NoteMeta[];
  setFavoriteNotes: React.Dispatch<React.SetStateAction<NoteMeta[]>>;
  activeTag: string | null;
  tagNotes: NoteMeta[];
  /** filesRef must be kept up-to-date by the parent (set on every files change). */
  filesRef: React.MutableRefObject<NoteMeta[]>;
  rememberRecent: (path: string) => void;
  clearRecents: () => void;
  toggleFavorite: (path: string, notify: (msg: string) => void) => void;
  handleTagSelect: (tag: string | null, onError: (e: string) => void) => Promise<void>;
  /** Sync list meta when the full file list refreshes. */
  syncWithFileList: (list: NoteMeta[]) => void;
}

/**
 * Manages the three sidebar list states: recent notes, favorite notes, and
 * tag-filtered notes. Owns filesRef so rememberRecent/toggleFavorite always
 * see a fresh file list without capturing stale closures.
 */
export function useSidebarLists(): SidebarListsState {
  const [recentNotes, setRecentNotes] = useState<NoteMeta[]>([]);
  const [favoriteNotes, setFavoriteNotes] = useState<NoteMeta[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [tagNotes, setTagNotes] = useState<NoteMeta[]>([]);
  const filesRef = useRef<NoteMeta[]>([]);

  const syncWithFileList = useCallback((list: NoteMeta[]) => {
    filesRef.current = list;
    setRecentNotes((prev) =>
      notesFromPaths(prev.map((n) => n.path), list, { limit: MAX_RECENT_NOTES }),
    );
    setFavoriteNotes((prev) =>
      notesFromPaths(prev.map((n) => n.path), list),
    );
  }, []);

  const rememberRecent = useCallback((path: string) => {
    setRecentNotes((prev) =>
      notesFromPaths(
        [path, ...prev.map((n) => n.path)],
        filesRef.current,
        { keepMissing: true, limit: MAX_RECENT_NOTES },
      ),
    );
  }, []);

  const clearRecents = useCallback(() => {
    setRecentNotes([]);
  }, []);

  const toggleFavorite = useCallback((path: string, notify: (msg: string) => void) => {
    setFavoriteNotes((prev) => {
      const isFavorite = prev.some((n) => n.path === path);
      if (isFavorite) {
        notify(`Removed ${fileTitleFromPath(path)} from favorites`);
        return prev.filter((n) => n.path !== path);
      }
      const note = noteMetaForPath(path, filesRef.current) ?? fallbackNoteMeta(path);
      notify(`Favorited ${note.title}`);
      return notesFromPaths([path, ...prev.map((n) => n.path)], filesRef.current, { keepMissing: true });
    });
  }, []);

  const handleTagSelect = useCallback(async (tag: string | null, onError: (e: string) => void) => {
    setActiveTag(tag);
    if (!tag) {
      setTagNotes([]);
      return;
    }
    try {
      setTagNotes(await filesByTag(tag));
    } catch (e) {
      onError(String(e));
    }
  }, []);

  return {
    recentNotes,
    setRecentNotes,
    favoriteNotes,
    setFavoriteNotes,
    activeTag,
    tagNotes,
    filesRef,
    rememberRecent,
    clearRecents,
    toggleFavorite,
    handleTagSelect,
    syncWithFileList,
  };
}
