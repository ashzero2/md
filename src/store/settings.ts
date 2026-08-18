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
  editor_font: "serif",
  editor_font_size: 16,
  line_numbers: false,
  reading_font_size: 17,
  reading_width: "medium",
  last_vault: null,
};

export type ThemeChoice = "system" | "light" | "dark";

const FONT_STACKS: Record<string, string> = {
  serif: "Newsreader, 'New York', Georgia, serif",
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono: "ui-monospace, 'SF Mono', Menlo, monospace",
};

const WIDTHS: Record<string, string> = {
  narrow: "36rem",
  medium: "42rem",
  wide: "48rem",
};

function applyThemeToDoc(theme: string) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

/** Push editor/reading typography + width onto CSS vars (live, no remount). */
function applyLayout(s: Settings) {
  const d = document.documentElement.style;
  d.setProperty("--editor-font", FONT_STACKS[s.editor_font] ?? FONT_STACKS.serif);
  d.setProperty("--editor-font-size", `${s.editor_font_size}px`);
  d.setProperty("--reading-font-size", `${s.reading_font_size}px`);
  d.setProperty("--reading-width", WIDTHS[s.reading_width] ?? WIDTHS.medium);
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
      applyLayout(s);
    } catch {
      set({ loaded: true });
    }
  },
  update: (patch) => {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    if ("theme" in patch) applyThemeToDoc(next.theme);
    applyLayout(next);
    saveSettings(next).catch(() => {});
  },
}));