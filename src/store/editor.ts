// Editor state: tab-aware content + debounced autosave with save status.

import { create } from "zustand";
import { saveNote } from "../lib/ipc";
import { useSettingsStore } from "./settings";

export type SaveState = "saved" | "saving" | "dirty" | "error";
export type EditorMode = "edit" | "view";

/** A file changed on disk while the editor had unsaved local edits. */
export interface Conflict {
  path: string;
  diskContent: string;
  editorContent: string;
}

export interface NoteTab {
  id: string;
  path: string;
  title: string;
  content: string;
  /** Last content successfully written to disk by the app (conflict baseline). */
  savedContent: string;
  saveState: SaveState;
  mode: EditorMode;
  pinned: boolean;
  lastScrollTop: number;
  lastCursor: unknown;
}

interface OpenNoteOptions {
  title?: string;
  activate?: boolean;
  mode?: EditorMode;
  reload?: boolean;
}

interface EditorState {
  tabs: NoteTab[];
  activeTabId: string | null;
  closedTabs: NoteTab[];
  /** Currently active note (vault-relative path), or null. Compatibility field. */
  path: string | null;
  content: string;
  savedContent: string;
  saveState: SaveState;
  conflict: Conflict | null;
  openNote: (path: string, content: string, options?: OpenNoteOptions) => void;
  closeNote: () => void;
  closeTab: (id: string) => void;
  closeTabsByPath: (path: string) => void;
  activateTab: (id: string) => void;
  reopenClosedTab: () => void;
  updateNotePath: (oldPath: string, path: string, title: string, content: string) => void;
  setContent: (content: string) => void;
  setTabMode: (id: string, mode: EditorMode) => void;
  /** Force-write pending edits immediately (e.g. on toggle or app hide). */
  flush: (id?: string) => Promise<void>;
  setConflict: (c: Conflict | null) => void;
  reset: () => void;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const saveTokens = new Map<string, number>();
let tabSeq = 0;

function nextTabId() {
  tabSeq += 1;
  return `tab-${tabSeq}`;
}

function fileTitleFromPath(path: string) {
  return (path.split(/[\\/]/).pop() ?? path).replace(/\.md$/i, "");
}

function clearTimer(id: string) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
}

function clearAllTimers() {
  for (const id of Array.from(timers.keys())) clearTimer(id);
}

function activeFields(tab: NoteTab | null) {
  return {
    path: tab?.path ?? null,
    content: tab?.content ?? "",
    savedContent: tab?.savedContent ?? "",
    saveState: tab?.saveState ?? "saved",
  };
}

function createTab(path: string, content: string, options: OpenNoteOptions = {}): NoteTab {
  return {
    id: nextTabId(),
    path,
    title: options.title ?? fileTitleFromPath(path),
    content,
    savedContent: content,
    saveState: "saved",
    mode: options.mode ?? "edit",
    pinned: false,
    lastScrollTop: 0,
    lastCursor: null,
  };
}

function updateTab(
  id: string,
  patch: Partial<NoteTab>,
  set: (p: Partial<EditorState>) => void,
  get: () => EditorState,
) {
  const tabs = get().tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab));
  const activeTab = tabs.find((tab) => tab.id === get().activeTabId) ?? null;
  set({ tabs, ...activeFields(activeTab) });
}

async function persist(
  id: string,
  path: string,
  content: string,
  set: (p: Partial<EditorState>) => void,
  get: () => EditorState,
) {
  const token = (saveTokens.get(id) ?? 0) + 1;
  saveTokens.set(id, token);
  updateTab(id, { saveState: "saving" }, set, get);
  try {
    await saveNote(path, content);
    if (saveTokens.get(id) === token) {
      updateTab(id, { saveState: "saved", savedContent: content }, set, get);
    }
  } catch {
    if (saveTokens.get(id) === token) updateTab(id, { saveState: "error" }, set, get);
  }
}

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  closedTabs: [],
  path: null,
  content: "",
  savedContent: "",
  saveState: "saved",
  conflict: null,
  openNote: (path, content, options = {}) => {
    const activate = options.activate ?? true;
    const existing = get().tabs.find((tab) => tab.path === path);
    if (existing) {
      const shouldReload = options.reload || existing.saveState === "saved";
      const patch: Partial<NoteTab> = {
        title: options.title ?? existing.title,
        mode: options.mode ?? existing.mode,
      };
      if (shouldReload) {
        patch.content = content;
        patch.savedContent = content;
        patch.saveState = "saved";
      }
      const tabs = get().tabs.map((tab) => (tab.id === existing.id ? { ...tab, ...patch } : tab));
      const activeTabId = activate ? existing.id : get().activeTabId;
      const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
      set({ tabs, activeTabId, conflict: activate ? null : get().conflict, ...activeFields(activeTab) });
      return;
    }

    const tab = createTab(path, content, options);
    const tabs = [...get().tabs, tab];
    const activeTabId = activate || !get().activeTabId ? tab.id : get().activeTabId;
    const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
    set({ tabs, activeTabId, conflict: activate ? null : get().conflict, ...activeFields(activeTab) });
  },
  closeNote: () => {
    const activeId = get().activeTabId;
    if (!activeId) return;
    get().closeTab(activeId);
  },
  closeTab: (id) => {
    clearTimer(id);
    saveTokens.delete(id);
    const tab = get().tabs.find((t) => t.id === id);
    const tabs = get().tabs.filter((t) => t.id !== id);
    let activeTabId = get().activeTabId;
    if (activeTabId === id) {
      activeTabId = tabs[tabs.length - 1]?.id ?? null;
    }
    const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
    set({
      tabs,
      activeTabId,
      closedTabs: tab ? [tab, ...get().closedTabs].slice(0, 10) : get().closedTabs,
      conflict: activeTab ? get().conflict : null,
      ...activeFields(activeTab),
    });
  },
  closeTabsByPath: (path) => {
    const closing = get().tabs.filter((tab) => tab.path === path);
    for (const tab of closing) {
      clearTimer(tab.id);
      saveTokens.delete(tab.id);
    }
    const tabs = get().tabs.filter((tab) => tab.path !== path);
    let activeTabId = get().activeTabId;
    if (activeTabId && !tabs.some((tab) => tab.id === activeTabId)) {
      activeTabId = tabs[tabs.length - 1]?.id ?? null;
    }
    const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
    set({
      tabs,
      activeTabId,
      closedTabs: [...closing, ...get().closedTabs].slice(0, 10),
      conflict: activeTab ? get().conflict : null,
      ...activeFields(activeTab),
    });
  },
  activateTab: (id) => {
    const activeTab = get().tabs.find((tab) => tab.id === id) ?? null;
    if (!activeTab) return;
    set({ activeTabId: id, conflict: null, ...activeFields(activeTab) });
  },
  reopenClosedTab: () => {
    const [tab, ...rest] = get().closedTabs;
    if (!tab) return;
    const restored = { ...tab, id: nextTabId(), saveState: "saved" as SaveState };
    const tabs = [...get().tabs, restored];
    set({ tabs, activeTabId: restored.id, closedTabs: rest, conflict: null, ...activeFields(restored) });
  },
  updateNotePath: (oldPath, path, title, content) => {
    const tabs = get().tabs.map((tab) =>
      tab.path === oldPath
        ? { ...tab, path, title, content, savedContent: content, saveState: "saved" as SaveState }
        : tab,
    );
    const activeTab = tabs.find((tab) => tab.id === get().activeTabId) ?? null;
    set({ tabs, ...activeFields(activeTab) });
  },
  setConflict: (c) => set({ conflict: c }),
  setContent: (content) => {
    const id = get().activeTabId;
    if (!id) return;
    updateTab(id, { content, saveState: "dirty" }, set, get);
    clearTimer(id);
    const delay = useSettingsStore.getState().settings.autosave_delay_ms || 600;
    timers.set(
      id,
      setTimeout(() => {
        const tab = get().tabs.find((t) => t.id === id);
        if (!tab) return;
        void persist(tab.id, tab.path, tab.content, set, get);
      }, delay),
    );
  },
  setTabMode: (id, mode) => updateTab(id, { mode }, set, get),
  flush: async (id) => {
    const tabId = id ?? get().activeTabId;
    if (!tabId) return;
    clearTimer(tabId);
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.saveState === "saved") return;
    await persist(tab.id, tab.path, tab.content, set, get);
  },
  reset: () => {
    clearAllTimers();
    saveTokens.clear();
    set({
      tabs: [],
      activeTabId: null,
      closedTabs: [],
      path: null,
      content: "",
      savedContent: "",
      saveState: "saved",
      conflict: null,
    });
  },
}));
