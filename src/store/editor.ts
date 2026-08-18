// Editor state: content + debounced autosave (600ms) with save status.

import { create } from "zustand";
import { saveNote } from "../lib/ipc";
import { useSettingsStore } from "./settings";

export type SaveState = "saved" | "saving" | "dirty" | "error";

/** A file changed on disk while the editor had unsaved local edits. */
export interface Conflict {
  path: string;
  diskContent: string;
  editorContent: string;
}

interface EditorState {
  /** Currently open note (vault-relative path), or null. */
  path: string | null;
  content: string;
  saveState: SaveState;
  conflict: Conflict | null;
  /** Effective editor-plane content (local regardless of conflict). */
  openNote: (path: string, content: string) => void;
  closeNote: () => void;
  setContent: (content: string) => void;
  /** Force-write pending edits immediately (e.g. on toggle or app hide). */
  flush: () => Promise<void>;
  setConflict: (c: Conflict | null) => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;

async function persist(path: string, content: string, set: (p: Partial<EditorState>) => void) {
  set({ saveState: "saving" });
  try {
    await saveNote(path, content);
    set({ saveState: "saved" });
  } catch {
    set({ saveState: "error" });
  }
}

export const useEditorStore = create<EditorState>((set, get) => ({
  path: null,
  content: "",
  saveState: "saved",
  conflict: null,
  openNote: (path, content) => {
    if (timer) clearTimeout(timer);
    set({ path, content, saveState: "saved", conflict: null });
  },
  closeNote: () => {
    if (timer) clearTimeout(timer);
    set({ path: null, content: "", saveState: "saved", conflict: null });
  },
  setConflict: (c) => set({ conflict: c }),
  setContent: (content) => {
    set({ content, saveState: "dirty" });
    if (timer) clearTimeout(timer);
    const delay = useSettingsStore.getState().settings.autosave_delay_ms || 600;
    timer = setTimeout(() => {
      const { path, content: c } = get();
      if (!path) return;
      void persist(path, c, set);
    }, delay);
  },
  flush: async () => {
    if (timer) clearTimeout(timer);
    const { path, content, saveState } = get();
    if (!path || saveState === "saved") return;
    await persist(path, content, set);
  },
}));