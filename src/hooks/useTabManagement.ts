import { useCallback, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useEditorStore } from "../store/editor";
import type { NoteTab } from "../store/editor";
import { copyText, revealNote } from "../lib/ipc";

export interface TabManagementState {
  draggingTabId: string | null;
  tabDropTarget: { id: string; position: "before" | "after" } | null;
  suppressNextTabClickRef: React.MutableRefObject<boolean>;
  handleTabPointerDown: (event: ReactPointerEvent<HTMLDivElement>, id: string) => void;
  handleTabPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleTabPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleCloseTab: (
    id: string,
    secondaryPanePath: string | null,
    closeSecondaryPane: () => void,
    notify: (msg: string, level?: "error") => void,
    setError: (e: string) => void,
  ) => Promise<void>;
  flushTabsBeforeClose: (
    ids: string[],
    notify: (msg: string, level?: "error") => void,
  ) => Promise<boolean>;
  handleCloseOtherTabs: (
    id: string,
    secondaryPanePath: string | null,
    closeSecondaryPane: () => void,
    clearTabMenu: () => void,
    notify: (msg: string, level?: "error") => void,
  ) => Promise<void>;
  handleCloseTabsToRight: (
    id: string,
    secondaryPanePath: string | null,
    closeSecondaryPane: () => void,
    clearTabMenu: () => void,
    notify: (msg: string, level?: "error") => void,
  ) => Promise<void>;
  handleCloseUnpinnedTabs: (
    secondaryPanePath: string | null,
    closeSecondaryPane: () => void,
    clearTabMenu: () => void,
    notify: (msg: string, level?: "error") => void,
  ) => Promise<void>;
  handleTogglePinTab: (id: string, clearTabMenu: () => void) => void;
  handleTabCopyPath: (tab: NoteTab, clearTabMenu: () => void, notify: (msg: string) => void, setError: (e: string) => void) => void;
  handleTabCopyMarkdownLink: (tab: NoteTab, clearTabMenu: () => void, notify: (msg: string) => void, setError: (e: string) => void) => void;
  handleTabRevealInFinder: (tab: NoteTab, clearTabMenu: () => void, setError: (e: string) => void) => void;
}

/**
 * Manages tab drag-and-drop, close/flush operations, and tab context-menu
 * actions. Reads and writes the editor store directly for tab state.
 */
export function useTabManagement(): TabManagementState {
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [tabDropTarget, setTabDropTarget] = useState<{
    id: string;
    position: "before" | "after";
  } | null>(null);

  const draggingTabRef = useRef<{
    active: boolean;
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const suppressNextTabClickRef = useRef(false);

  const reorderTab = useEditorStore((s) => s.reorderTab);
  const togglePinTab = useEditorStore((s) => s.togglePinTab);
  const closeOtherTabs = useEditorStore((s) => s.closeOtherTabs);
  const closeTabsToRight = useEditorStore((s) => s.closeTabsToRight);

  const tabDropTargetFromPoint = useCallback((clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-tab-id]");
    if (!element?.dataset.tabId) return null;
    const rect = element.getBoundingClientRect();
    return {
      id: element.dataset.tabId,
      position: clientX > rect.left + rect.width / 2 ? "after" : "before",
    } as const;
  }, []);

  const clearTabDragState = useCallback(() => {
    draggingTabRef.current = null;
    setDraggingTabId(null);
    setTabDropTarget(null);
  }, []);

  const handleTabPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, id: string) => {
      if (event.button !== 0) return;
      draggingTabRef.current = {
        active: false,
        id,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [],
  );

  const handleTabPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = draggingTabRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (!drag.active && moved < 4) return;
      if (!drag.active) {
        drag.active = true;
        setDraggingTabId(drag.id);
      }
      event.preventDefault();
      const target = tabDropTargetFromPoint(event.clientX, event.clientY);
      setTabDropTarget(
        target && target.id !== drag.id
          ? (current) =>
              current?.id === target.id && current.position === target.position ? current : target
          : null,
      );
    },
    [tabDropTargetFromPoint],
  );

  const handleTabPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = draggingTabRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const target = drag.active ? tabDropTargetFromPoint(event.clientX, event.clientY) : null;
      if (drag.active) {
        suppressNextTabClickRef.current = true;
        event.preventDefault();
        event.stopPropagation();
      }
      clearTabDragState();
      if (target && target.id !== drag.id) reorderTab(drag.id, target.id, target.position);
    },
    [clearTabDragState, reorderTab, tabDropTargetFromPoint],
  );

  const flushTabsBeforeClose = useCallback(
    async (
      ids: string[],
      notify: (msg: string, level?: "error") => void,
    ): Promise<boolean> => {
      for (const id of ids) {
        await useEditorStore.getState().flush(id);
      }
      const failed = useEditorStore.getState().tabs.filter(
        (tab) => ids.includes(tab.id) && tab.saveState === "error",
      );
      if (failed.length > 0) {
        notify(`Could not save ${failed[0].title}. Tabs kept open.`, "error");
        return false;
      }
      return true;
    },
    [],
  );

  const handleCloseTab = useCallback(
    async (
      id: string,
      secondaryPanePath: string | null,
      closeSecondaryPane: () => void,
      notify: (msg: string, level?: "error") => void,
      _setError: (e: string) => void,
    ) => {
      const store = useEditorStore.getState();
      const tab = store.tabs.find((t) => t.id === id);
      if (!tab) return;

      await store.flush(id);
      const afterFlush = useEditorStore.getState();
      const freshTab = afterFlush.tabs.find((t) => t.id === id);
      if (freshTab?.saveState === "error") {
        notify(`Could not save ${freshTab.title}. Tab kept open.`, "error");
        return;
      }

      afterFlush.closeTab(id);
      if (secondaryPanePath === tab.path) closeSecondaryPane();
    },
    [],
  );

  const handleCloseOtherTabs = useCallback(
    async (
      id: string,
      secondaryPanePath: string | null,
      closeSecondaryPane: () => void,
      clearTabMenu: () => void,
      notify: (msg: string, level?: "error") => void,
    ) => {
      const closingTabs = useEditorStore.getState().tabs.filter(
        (tab) => tab.id !== id && !tab.pinned,
      );
      const closingIds = closingTabs.map((tab) => tab.id);
      const closingPaths = new Set(closingTabs.map((tab) => tab.path));
      if (!(await flushTabsBeforeClose(closingIds, notify))) return;
      closeOtherTabs(id);
      if (secondaryPanePath && closingPaths.has(secondaryPanePath)) closeSecondaryPane();
      clearTabMenu();
    },
    [closeOtherTabs, flushTabsBeforeClose],
  );

  const handleCloseTabsToRight = useCallback(
    async (
      id: string,
      secondaryPanePath: string | null,
      closeSecondaryPane: () => void,
      clearTabMenu: () => void,
      notify: (msg: string, level?: "error") => void,
    ) => {
      const tabs = useEditorStore.getState().tabs;
      const index = tabs.findIndex((tab) => tab.id === id);
      const closingTabs =
        index < 0 ? [] : tabs.slice(index + 1).filter((tab) => !tab.pinned);
      const closingIds = closingTabs.map((tab) => tab.id);
      const closingPaths = new Set(closingTabs.map((tab) => tab.path));
      if (!(await flushTabsBeforeClose(closingIds, notify))) return;
      closeTabsToRight(id);
      if (secondaryPanePath && closingPaths.has(secondaryPanePath)) closeSecondaryPane();
      clearTabMenu();
    },
    [closeTabsToRight, flushTabsBeforeClose],
  );

  const handleCloseUnpinnedTabs = useCallback(
    async (
      secondaryPanePath: string | null,
      closeSecondaryPane: () => void,
      clearTabMenu: () => void,
      notify: (msg: string, level?: "error") => void,
    ) => {
      const closingTabs = useEditorStore.getState().tabs.filter((tab) => !tab.pinned);
      const closingIds = closingTabs.map((tab) => tab.id);
      const closingPaths = new Set(closingTabs.map((tab) => tab.path));
      if (!(await flushTabsBeforeClose(closingIds, notify))) return;
      for (const tab of closingTabs) {
        useEditorStore.getState().closeTab(tab.id);
      }
      if (secondaryPanePath && closingPaths.has(secondaryPanePath)) closeSecondaryPane();
      clearTabMenu();
    },
    [flushTabsBeforeClose],
  );

  const handleTogglePinTab = useCallback((id: string, clearTabMenu: () => void) => {
    togglePinTab(id);
    clearTabMenu();
  }, [togglePinTab]);

  const handleTabCopyPath = useCallback(
    (tab: NoteTab, clearTabMenu: () => void, notify: (msg: string) => void, setError: (e: string) => void) => {
      void copyText(tab.path)
        .then(() => notify("Copied path"))
        .catch((e: unknown) => setError(String(e)));
      clearTabMenu();
    },
    [],
  );

  const handleTabCopyMarkdownLink = useCallback(
    (tab: NoteTab, clearTabMenu: () => void, notify: (msg: string) => void, setError: (e: string) => void) => {
      void copyText(`[${tab.title}](${tab.path})`)
        .then(() => notify("Copied markdown link"))
        .catch((e: unknown) => setError(String(e)));
      clearTabMenu();
    },
    [],
  );

  const handleTabRevealInFinder = useCallback(
    (tab: NoteTab, clearTabMenu: () => void, setError: (e: string) => void) => {
      void revealNote(tab.path).catch((e: unknown) => setError(String(e)));
      clearTabMenu();
    },
    [],
  );

  return {
    draggingTabId,
    tabDropTarget,
    suppressNextTabClickRef,
    handleTabPointerDown,
    handleTabPointerMove,
    handleTabPointerUp,
    handleCloseTab,
    flushTabsBeforeClose,
    handleCloseOtherTabs,
    handleCloseTabsToRight,
    handleCloseUnpinnedTabs,
    handleTogglePinTab,
    handleTabCopyPath,
    handleTabCopyMarkdownLink,
    handleTabRevealInFinder,
  };
}
