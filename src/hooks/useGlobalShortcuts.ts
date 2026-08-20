import { useEffect } from "react";
import { useEditorStore } from "../store/editor";
import { useSettingsStore } from "../store/settings";
import type { EditorMode, NoteTab } from "../store/editor";

type SidebarView = "files" | "favorites" | "recent" | "backlinks";

/**
 * Wires all global keyboard shortcuts for the app. Must be called after all
 * the handlers it depends on are stable.
 */
export function useGlobalShortcuts(params: {
  activeTabId: string | null;
  tabs: NoteTab[];
  activePaneMode: EditorMode;
  handleActivateTab: (id: string) => void;
  handleCloseActiveTab: () => void;
  handleOpenVault: () => Promise<void>;
  handleToggleSplitPane: () => void;
  toggleActivePaneMode: () => void;
  showSidebarView: (view: SidebarView) => void;
  reopenClosedTab: () => void;
  setPaletteOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  setSearchOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  setSettingsOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
}) {
  const {
    activeTabId,
    tabs,
    handleActivateTab,
    handleCloseActiveTab,
    handleOpenVault,
    handleToggleSplitPane,
    toggleActivePaneMode,
    showSidebarView,
    reopenClosedTab,
    setPaletteOpen,
    setSearchOpen,
    setSettingsOpen,
  } = params;

  const activateAdjacentTab = useEditorStore((s) => s.activateAdjacentTab);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      // Cmd+Shift+1–4: sidebar view switching
      if (e.shiftKey && e.code.startsWith("Digit")) {
        const panelNumber = Number(e.code.slice("Digit".length));
        const views: SidebarView[] = ["files", "favorites", "recent", "backlinks"];
        const view = views[panelNumber - 1];
        if (view) {
          e.preventDefault();
          showSidebarView(view);
          return;
        }
      }

      // Cmd+Tab / Cmd+Shift+Tab: cycle tabs
      if (e.key === "Tab") {
        e.preventDefault();
        activateAdjacentTab(e.shiftKey ? -1 : 1);
        return;
      }

      // Cmd+1–9: jump to tab by index
      const tabNumber = Number(e.key);
      if (tabNumber >= 1 && tabNumber <= 9) {
        const tab = tabs[tabNumber - 1];
        if (tab) {
          e.preventDefault();
          handleActivateTab(tab.id);
        }
        return;
      }

      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        toggleActivePaneMode();
      } else if (e.key === "w" || e.key === "W") {
        e.preventDefault();
        if (activeTabId) handleCloseActiveTab();
      } else if (e.shiftKey && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        reopenClosedTab();
      } else if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        void handleOpenVault();
      } else if (e.key === "p" || e.key === "P" || e.key === "k" || e.key === "K") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      } else if (e.key === "\\") {
        e.preventDefault();
        handleToggleSplitPane();
      } else if (e.key === ",") {
        e.preventDefault();
        setSettingsOpen((o) => !o);
      } else if (e.shiftKey && (e.key === "L" || e.key === "l")) {
        e.preventDefault();
        const cur = useSettingsStore.getState().settings.theme;
        const next = cur === "system" ? "dark" : cur === "dark" ? "light" : "system";
        useSettingsStore.getState().update({ theme: next });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    activeTabId,
    activateAdjacentTab,
    handleActivateTab,
    handleCloseActiveTab,
    handleOpenVault,
    handleToggleSplitPane,
    reopenClosedTab,
    setSearchOpen,
    setPaletteOpen,
    setSettingsOpen,
    showSidebarView,
    tabs,
    toggleActivePaneMode,
  ]);
}
