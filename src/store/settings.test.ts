import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSettingsStore } from "./settings";
import { getSettings, saveSettings } from "../lib/ipc";

vi.mock("../lib/ipc", () => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.removeProperty("--editor-font-size");
  vi.clearAllMocks();
  (getSettings as any).mockResolvedValue({
    reopen_last_vault: false,
    confirm_before_delete: true,
    update_links_on_rename: true,
    default_new_note_location: "root",
    autosave_delay_ms: 600,
    theme: "dark",
    editor_font: "mono",
    editor_font_size: 18,
    line_numbers: true,
    reading_font_size: 17,
    reading_width: "wide",
    last_vault: null,
  });
});

describe("settings store", () => {
  it("load applies theme and layout CSS variables", async () => {
    await useSettingsStore.getState().load();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--editor-font-size")).toBe("18px");
  });

  it("update persists merged settings", () => {
    useSettingsStore.getState().load();
    useSettingsStore.getState().update({ theme: "light" });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(saveSettings).toHaveBeenCalled();
  });
});
