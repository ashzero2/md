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
      ["a.md"],
      {
        sidebarView: "recent",
        sidebarCollapsed: true,
        splitPaneOpen: true,
        focusedPane: "secondary",
        secondaryPanePath: "a.md",
        secondaryPaneMode: "view",
      },
    );

    expect(workspace.activePath).toBe("b.md");
    expect(workspace.backlinksOpen).toBe(false);
    expect(workspace.sidebarView).toBe("recent");
    expect(workspace.sidebarCollapsed).toBe(true);
    expect(workspace.splitPaneOpen).toBe(true);
    expect(workspace.focusedPane).toBe("secondary");
    expect(workspace.secondaryPanePath).toBe("a.md");
    expect(workspace.secondaryPaneMode).toBe("view");
    expect(workspace.recentPaths).toEqual(["b.md", "a.md"]);
    expect(workspace.favoritePaths).toEqual(["a.md"]);
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

  it("reads older workspaces with chrome defaults", () => {
    localStorage.setItem(
      `vault.workspace.${encodeURIComponent("/tmp/legacy")}`,
      JSON.stringify({
        version: 1,
        activePath: "a.md",
        backlinksOpen: true,
        favoritePaths: [],
        recentPaths: [],
        tabs: [{ path: "a.md", mode: "edit", pinned: false }],
      }),
    );

    expect(readWorkspace("/tmp/legacy")).toMatchObject({
      activePath: "a.md",
      backlinksOpen: true,
      sidebarView: "backlinks",
      sidebarCollapsed: false,
      splitPaneOpen: false,
      focusedPane: "main",
      secondaryPanePath: null,
      secondaryPaneMode: "view",
    });
  });
});
