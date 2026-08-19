import type { NoteTab } from "../store/editor";

const VERSION = 1;

export interface PersistedWorkspaceTab {
  path: string;
  mode: NoteTab["mode"];
  pinned: boolean;
}

export interface PersistedWorkspace {
  version: typeof VERSION;
  activePath: string | null;
  backlinksOpen: boolean;
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
): PersistedWorkspace {
  const active = tabs.find((tab) => tab.id === activeTabId) ?? null;
  return {
    version: VERSION,
    activePath: active?.path ?? null,
    backlinksOpen,
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
    return {
      version: VERSION,
      activePath: typeof parsed.activePath === "string" ? parsed.activePath : null,
      backlinksOpen: parsed.backlinksOpen === true,
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
