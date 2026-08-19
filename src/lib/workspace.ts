import type { NoteTab } from "../store/editor";

const VERSION = 1;
type WorkspacePane = "main" | "secondary";
type SidebarView = "files" | "favorites" | "recent" | "backlinks";

export interface PersistedWorkspaceTab {
  path: string;
  mode: NoteTab["mode"];
  pinned: boolean;
}

export interface PersistedWorkspaceChrome {
  sidebarView: SidebarView;
  sidebarCollapsed: boolean;
  splitPaneOpen: boolean;
  focusedPane: WorkspacePane;
  secondaryPanePath: string | null;
  secondaryPaneMode: NoteTab["mode"];
}

export interface PersistedWorkspace {
  version: typeof VERSION;
  activePath: string | null;
  backlinksOpen: boolean;
  sidebarView: SidebarView;
  sidebarCollapsed: boolean;
  splitPaneOpen: boolean;
  focusedPane: WorkspacePane;
  secondaryPanePath: string | null;
  secondaryPaneMode: NoteTab["mode"];
  favoritePaths: string[];
  recentPaths: string[];
  tabs: PersistedWorkspaceTab[];
}

function keyForVault(root: string) {
  return `vault.workspace.${encodeURIComponent(root)}`;
}

export function workspaceFromTabs(
  tabs: NoteTab[],
  activeTabId: string | null,
  backlinksOpen: boolean,
  recentPaths: string[] = [],
  favoritePaths: string[] = [],
  chrome: Partial<PersistedWorkspaceChrome> = {},
): PersistedWorkspace {
  const active = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const sidebarView = chrome.sidebarView ?? (backlinksOpen ? "backlinks" : "files");
  return {
    version: VERSION,
    activePath: active?.path ?? null,
    backlinksOpen: sidebarView === "backlinks",
    sidebarView,
    sidebarCollapsed: chrome.sidebarCollapsed ?? false,
    splitPaneOpen: chrome.splitPaneOpen ?? false,
    focusedPane: chrome.focusedPane ?? "main",
    secondaryPanePath: chrome.secondaryPanePath ?? null,
    secondaryPaneMode: chrome.secondaryPaneMode ?? "view",
    favoritePaths,
    recentPaths,
    tabs: tabs.map((tab) => ({
      path: tab.path,
      mode: tab.mode,
      pinned: tab.pinned,
    })),
  };
}

export function readWorkspace(root: string): PersistedWorkspace | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(keyForVault(root));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedWorkspace>;
    if (parsed.version !== VERSION || !Array.isArray(parsed.tabs)) return null;
    const sidebarView =
      parsed.sidebarView === "files" ||
      parsed.sidebarView === "favorites" ||
      parsed.sidebarView === "recent" ||
      parsed.sidebarView === "backlinks"
        ? parsed.sidebarView
        : parsed.backlinksOpen === true
          ? "backlinks"
          : "files";
    const focusedPane = parsed.focusedPane === "secondary" ? "secondary" : "main";
    const secondaryPaneMode = parsed.secondaryPaneMode === "edit" ? "edit" : "view";
    return {
      version: VERSION,
      activePath: typeof parsed.activePath === "string" ? parsed.activePath : null,
      backlinksOpen: sidebarView === "backlinks",
      sidebarView,
      sidebarCollapsed: parsed.sidebarCollapsed === true,
      splitPaneOpen: parsed.splitPaneOpen === true,
      focusedPane,
      secondaryPanePath: typeof parsed.secondaryPanePath === "string" ? parsed.secondaryPanePath : null,
      secondaryPaneMode,
      favoritePaths: Array.isArray(parsed.favoritePaths)
        ? parsed.favoritePaths.filter((path): path is string => typeof path === "string")
        : [],
      recentPaths: Array.isArray(parsed.recentPaths)
        ? parsed.recentPaths.filter((path): path is string => typeof path === "string")
        : [],
      tabs: parsed.tabs
        .filter((tab): tab is PersistedWorkspaceTab => {
          return (
            !!tab &&
            typeof tab.path === "string" &&
            (tab.mode === "edit" || tab.mode === "view") &&
            typeof tab.pinned === "boolean"
          );
        }),
    };
  } catch {
    return null;
  }
}

export function writeWorkspace(root: string, workspace: PersistedWorkspace) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(keyForVault(root), JSON.stringify(workspace));
}
