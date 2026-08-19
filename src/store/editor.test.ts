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

  it("uses the file name as the default tab title", () => {
    useEditorStore.getState().openNote(
      "Sprint Plans/Client Action Closure.md",
      "# Sprint Summary",
    );

    expect(useEditorStore.getState().tabs[0].title).toBe("Client Action Closure");
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

  it("keeps edit/read mode per tab", () => {
    useEditorStore.getState().openNote("a.md", "alpha");
    const firstId = useEditorStore.getState().activeTabId;
    expect(firstId).toBeTruthy();

    useEditorStore.getState().setTabMode(firstId!, "view");
    useEditorStore.getState().openNote("b.md", "bravo");
    useEditorStore.getState().activateTab(firstId!);

    expect(useEditorStore.getState().tabs.find((tab) => tab.id === firstId)?.mode).toBe("view");
    expect(useEditorStore.getState().path).toBe("a.md");
  });

  it("closes the active tab and activates the previous open tab", () => {
    useEditorStore.getState().openNote("a.md", "alpha");
    useEditorStore.getState().openNote("b.md", "bravo");
    const closingId = useEditorStore.getState().activeTabId;
    expect(closingId).toBeTruthy();

    useEditorStore.getState().closeTab(closingId!);

    expect(useEditorStore.getState().path).toBe("a.md");
    expect(useEditorStore.getState().tabs.map((tab) => tab.path)).toEqual(["a.md"]);
    expect(useEditorStore.getState().closedTabs[0]?.path).toBe("b.md");
  });

  it("pins tabs and keeps pinned tabs before regular tabs", () => {
    useEditorStore.getState().openNote("a.md", "alpha");
    useEditorStore.getState().openNote("b.md", "bravo");
    const secondId = useEditorStore.getState().activeTabId;

    useEditorStore.getState().togglePinTab(secondId!);

    expect(useEditorStore.getState().tabs.map((tab) => tab.path)).toEqual(["b.md", "a.md"]);
    expect(useEditorStore.getState().tabs[0].pinned).toBe(true);
  });

  it("closes other tabs while preserving pinned tabs", () => {
    useEditorStore.getState().openNote("a.md", "alpha");
    const firstId = useEditorStore.getState().activeTabId;
    useEditorStore.getState().openNote("b.md", "bravo");
    useEditorStore.getState().togglePinTab(firstId!);
    useEditorStore.getState().openNote("c.md", "charlie");
    const thirdId = useEditorStore.getState().activeTabId;

    useEditorStore.getState().closeOtherTabs(thirdId!);

    expect(useEditorStore.getState().tabs.map((tab) => tab.path)).toEqual(["a.md", "c.md"]);
    expect(useEditorStore.getState().path).toBe("c.md");
  });

  it("closes tabs to the right while preserving pinned tabs", () => {
    useEditorStore.getState().openNote("a.md", "alpha");
    const firstId = useEditorStore.getState().activeTabId;
    useEditorStore.getState().openNote("b.md", "bravo");
    useEditorStore.getState().openNote("c.md", "charlie");
    const thirdId = useEditorStore.getState().activeTabId;
    useEditorStore.getState().togglePinTab(thirdId!);

    useEditorStore.getState().closeTabsToRight(firstId!);

    expect(useEditorStore.getState().tabs.map((tab) => tab.path)).toEqual(["c.md", "a.md"]);
    expect(useEditorStore.getState().tabs[0].pinned).toBe(true);
  });

  it("activates adjacent tabs circularly", () => {
    useEditorStore.getState().openNote("a.md", "alpha");
    useEditorStore.getState().openNote("b.md", "bravo");
    useEditorStore.getState().openNote("c.md", "charlie");

    useEditorStore.getState().activateAdjacentTab(1);
    expect(useEditorStore.getState().path).toBe("a.md");

    useEditorStore.getState().activateAdjacentTab(-1);
    expect(useEditorStore.getState().path).toBe("c.md");
  });

  it("reopens the last closed tab", () => {
    useEditorStore.getState().openNote("a.md", "alpha", { title: "Alpha" });
    const id = useEditorStore.getState().activeTabId;
    useEditorStore.getState().closeTab(id!);

    useEditorStore.getState().reopenClosedTab();

    expect(useEditorStore.getState().path).toBe("a.md");
    expect(useEditorStore.getState().tabs).toHaveLength(1);
    expect(useEditorStore.getState().tabs[0].title).toBe("Alpha");
  });
});
