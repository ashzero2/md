import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEditorStore } from "./editor";
import { useSettingsStore } from "./settings";
import { saveNote } from "../lib/ipc";

vi.mock("../lib/ipc", () => ({
  saveNote: vi.fn().mockResolvedValue(undefined),
  getSettings: vi.fn().mockResolvedValue({
    reopen_last_vault: false,
    confirm_before_delete: true,
    update_links_on_rename: true,
    default_new_note_location: "root",
    autosave_delay_ms: 300,
    theme: "system",
    editor_font: "serif",
    editor_font_size: 16,
    line_numbers: false,
    reading_font_size: 17,
    reading_width: "medium",
    last_vault: null,
  }),
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(saveNote).mockClear();
  useEditorStore.getState().reset();
  useSettingsStore.setState({
    settings: {
      reopen_last_vault: false,
      confirm_before_delete: true,
      update_links_on_rename: true,
      default_new_note_location: "root",
      autosave_delay_ms: 300,
      theme: "system",
      editor_font: "serif",
      editor_font_size: 16,
      line_numbers: false,
      reading_font_size: 17,
      reading_width: "medium",
      last_vault: null,
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("editor store autosave", () => {
  it("opens a note clean (saved), then typing marks it dirty", () => {
    useEditorStore.getState().openNote("a.md", "hello");
    expect(useEditorStore.getState().saveState).toBe("saved");
    useEditorStore.getState().setContent("hello world");
    expect(useEditorStore.getState().saveState).toBe("dirty");
  });

  it("autosaves after the configured delay and resets to saved", async () => {
    useEditorStore.getState().openNote("a.md", "hello");
    useEditorStore.getState().setContent("hello world");
    expect(saveNote).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    expect(saveNote).toHaveBeenCalledWith("a.md", "hello world");
    expect(useEditorStore.getState().saveState).toBe("saved");
  });

  it("flush persists immediately even before the debounce fires", async () => {
    useEditorStore.getState().openNote("a.md", "hello");
    useEditorStore.getState().setContent("hello world");
    await useEditorStore.getState().flush();
    expect(saveNote).toHaveBeenCalledWith("a.md", "hello world");
  });

  it("opening another note clears conflict state", () => {
    useEditorStore.setState({ conflict: { path: "a.md", diskContent: "x", editorContent: "y" } });
    useEditorStore.getState().openNote("b.md", "z");
    expect(useEditorStore.getState().conflict).toBeNull();
  });

  it("tracks savedContent after autosave (the conflict-change baseline)", async () => {
    useEditorStore.getState().openNote("a.md", "v1");
    expect(useEditorStore.getState().savedContent).toBe("v1");
    useEditorStore.getState().setContent("v2");
    await vi.advanceTimersByTimeAsync(400);
    expect(saveNote).toHaveBeenCalledWith("a.md", "v2");
    expect(useEditorStore.getState().savedContent).toBe("v2");
    expect(useEditorStore.getState().content).toBe("v2");
  });

  it("can open a note in the background without changing the active buffer", () => {
    useEditorStore.getState().openNote("a.md", "alpha", { title: "Alpha" });
    useEditorStore.getState().openNote("b.md", "bravo", { title: "Bravo", activate: false });

    const state = useEditorStore.getState();
    expect(state.tabs).toHaveLength(2);
    expect(state.path).toBe("a.md");
    expect(state.content).toBe("alpha");
    expect(state.tabs.map((tab) => tab.title)).toEqual(["Alpha", "Bravo"]);
  });

  it("keeps dirty tab content isolated when switching notes", () => {
    useEditorStore.getState().openNote("a.md", "alpha");
    useEditorStore.getState().setContent("alpha dirty");
    useEditorStore.getState().openNote("b.md", "bravo");

    const state = useEditorStore.getState();
    expect(state.path).toBe("b.md");
    expect(state.content).toBe("bravo");
    expect(state.tabs.find((tab) => tab.path === "a.md")?.content).toBe("alpha dirty");
    expect(state.tabs.find((tab) => tab.path === "a.md")?.saveState).toBe("dirty");
  });

  it("autosaves the edited tab even after another tab becomes active", async () => {
    useEditorStore.getState().openNote("a.md", "alpha");
    useEditorStore.getState().setContent("alpha dirty");
    useEditorStore.getState().openNote("b.md", "bravo");

    await vi.advanceTimersByTimeAsync(400);

    expect(saveNote).toHaveBeenCalledWith("a.md", "alpha dirty");
    expect(useEditorStore.getState().path).toBe("b.md");
    expect(useEditorStore.getState().saveState).toBe("saved");
    expect(useEditorStore.getState().tabs.find((tab) => tab.path === "a.md")?.savedContent).toBe(
      "alpha dirty",
    );
  });
});
