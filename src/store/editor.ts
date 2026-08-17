// Editor state: content + debounced autosave (600ms) with save status.

import { create } from "zustand";
import { saveNote } from "../lib/ipc";

export type SaveState = "saved" | "saving" | "dirty" | "error";

interface EditorState {
  /** Currently open note (vault-relative path), or null. */
  path: string | null;
  content: string;
  saveState: SaveState;
  openNote: (path: string, content: string) => void;
  closeNote: () => void;
  setContent: (content: string) => void;
  /** Force-write pending edits immediately (e.g. on toggle or app hide). */
  flush: () => Promise<void>;
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
  openNote: (path, content) => {
    if (timer) clearTimeout(timer);
    set({ path, content, saveState: "saved" });
  },
  closeNote: () => {
    if (timer) clearTimeout(timer);
    set({ path: null, content: "", saveState: "saved" });
  },
  setContent: (content) => {
    set({ content, saveState: "dirty" });
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const { path, content: c } = get();
      if (!path) return;
      void persist(path, c, set);
    }, 600);
  },
  flush: async () => {
    if (timer) clearTimeout(timer);
    const { path, content, saveState } = get();
    if (!path || saveState === "saved") return;
    await persist(path, content, set);
  },
}));