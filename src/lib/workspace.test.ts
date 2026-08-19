import { describe, expect, it, beforeEach } from "vitest";
import { readWorkspace, workspaceFromTabs, writeWorkspace } from "./workspace";
import type { NoteTab } from "../store/editor";

function tab(patch: Partial<NoteTab>): NoteTab {
  return {
    id: "tab-1",
    path: "a.md",
    title: "a",
    content: "",
    savedContent: "",
    saveState: "saved",
    mode: "edit",
    pinned: false,
    lastScrollTop: 0,
    lastCursor: null,
    ...patch,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("workspace persistence helpers", () => {
  it("serializes tabs with active path and chrome state", () => {
    const workspace = workspaceFromTabs(
      [tab({ id: "a", path: "a.md" }), tab({ id: "b", path: "b.md", mode: "view", pinned: true })],
      "b",
      true,
      ["b.md", "a.md"],
    );

    expect(workspace.activePath).toBe("b.md");
    expect(workspace.backlinksOpen).toBe(true);
    expect(workspace.recentPaths).toEqual(["b.md", "a.md"]);
    expect(workspace.tabs).toEqual([
      { path: "a.md", mode: "edit", pinned: false },
      { path: "b.md", mode: "view", pinned: true },
    ]);
  });

  it("round-trips a workspace per vault root", () => {
    const workspace = workspaceFromTabs([tab({ id: "a", path: "Folder/A.md" })], "a", false);

    writeWorkspace("/tmp/vault one", workspace);

    expect(readWorkspace("/tmp/vault one")).toEqual(workspace);
    expect(readWorkspace("/tmp/other")).toBeNull();
  });
});
