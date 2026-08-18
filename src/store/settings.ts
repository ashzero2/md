// Settings store — loaded from / persisted to the Rust backend (app-data JSON).

import { create } from "zustand";
import { getSettings, saveSettings } from "../lib/ipc";
import type { Settings } from "../lib/types";

const DEFAULTS: Settings = {
  reopen_last_vault: false,
  confirm_before_delete: true,
  default_new_note_location: "root",
  autosave_delay_ms: 600,
  theme: "system",
  last_vault: null,
};

export type ThemeChoice = "system" | "light" | "dark";

function applyThemeToDoc(theme: string) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULTS,
  loaded: false,
  load: async () => {
    try {
      const s = await getSettings();
      set({ settings: s, loaded: true });
      applyThemeToDoc(s.theme);
    } catch {
      set({ loaded: true });
    }
  },
  update: (patch) => {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    if ("theme" in patch) applyThemeToDoc(next.theme);
    saveSettings(next).catch(() => {});
  },
}));