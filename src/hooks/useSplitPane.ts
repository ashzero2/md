import { useCallback, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { EditorMode, NoteTab } from "../store/editor";

export type WorkspacePane = "main" | "secondary";

export interface SplitPaneState {
  splitPaneOpen: boolean;
  focusedPane: WorkspacePane;
  secondaryPanePath: string | null;
  secondaryPaneMode: EditorMode;
  splitRatio: number;
  setSplitPaneOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  setFocusedPane: (v: WorkspacePane) => void;
  setSecondaryPanePath: (v: string | null | ((prev: string | null) => string | null)) => void;
  setSecondaryPaneMode: (v: EditorMode) => void;
  closeSecondaryPane: () => void;
  /** Toggle split pane; opens with secondary showing the active note. */
  handleToggleSplitPane: (activeTabPath: string | null, activeMode: EditorMode) => void;
  /** Open active note in the other pane (opposite mode). */
  handleOpenActiveInOtherPane: (activeTabPath: string | null, activeMode: EditorMode) => void;
  /** Open a specific tab in the secondary pane. */
  handleOpenTabInSplitPane: (tab: NoteTab, clearTabMenu: () => void) => void;
  /** Swap main and secondary pane contents. */
  handleSwapPanes: (
    mainPath: string | null,
    activateTab: (id: string) => void,
    tabs: NoteTab[],
  ) => void;
  handleSplitDividerPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  handleSplitDividerPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  handleSplitDividerPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
}

/**
 * Manages split-pane layout state: open/close, focused pane, secondary pane
 * path and mode, resize ratio, and divider drag handling.
 */
export function useSplitPane(): SplitPaneState {
  const [splitPaneOpen, setSplitPaneOpen] = useState(false);
  const [focusedPane, setFocusedPane] = useState<WorkspacePane>("main");
  const [secondaryPanePath, setSecondaryPanePath] = useState<string | null>(null);
  const [secondaryPaneMode, setSecondaryPaneMode] = useState<EditorMode>("view");
  const [splitRatio, setSplitRatio] = useState(0.5);
  const splitDragRef = useRef<{
    active: boolean;
    pointerId: number;
    containerLeft: number;
    containerWidth: number;
  } | null>(null);

  const closeSecondaryPane = useCallback(() => {
    setSplitPaneOpen(false);
    setFocusedPane("main");
    setSecondaryPanePath(null);
  }, []);

  const handleToggleSplitPane = useCallback(
    (activeTabPath: string | null, activeMode: EditorMode) => {
      setSplitPaneOpen((open) => {
        if (open) {
          setFocusedPane("main");
          return false;
        }
        setSecondaryPaneMode(activeMode === "edit" ? "view" : "edit");
        setSecondaryPanePath(activeTabPath);
        setFocusedPane("secondary");
        return true;
      });
    },
    [],
  );

  const handleOpenActiveInOtherPane = useCallback(
    (activeTabPath: string | null, activeMode: EditorMode) => {
      if (!activeTabPath) return;
      setSplitPaneOpen(true);
      setSecondaryPanePath(activeTabPath);
      setSecondaryPaneMode(activeMode === "edit" ? "view" : "edit");
      setFocusedPane("secondary");
    },
    [],
  );

  const handleOpenTabInSplitPane = useCallback(
    (tab: NoteTab, clearTabMenu: () => void) => {
      setSplitPaneOpen(true);
      setSecondaryPanePath(tab.path);
      setSplitPaneOpen((wasOpen) => {
        if (!wasOpen) setSecondaryPaneMode(tab.mode === "edit" ? "view" : "edit");
        return true;
      });
      setFocusedPane("secondary");
      clearTabMenu();
    },
    [],
  );

  const handleSwapPanes = useCallback(
    (
      mainPath: string | null,
      activateTab: (id: string) => void,
      tabs: NoteTab[],
    ) => {
      const secPath = secondaryPanePath;
      if (!mainPath || !secPath) return;
      const secTab = tabs.find((t) => t.path === secPath);
      if (secTab) activateTab(secTab.id);
      setSecondaryPanePath(mainPath);
      setFocusedPane("main");
    },
    [secondaryPanePath],
  );

  const handleSplitDividerPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const container = (e.currentTarget as HTMLDivElement).parentElement;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      splitDragRef.current = {
        active: true,
        pointerId: e.pointerId,
        containerLeft: rect.left,
        containerWidth: rect.width,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    [],
  );

  const handleSplitDividerPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = splitDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const DIVIDER_WIDTH = 5;
      const ratio = Math.max(
        0.2,
        Math.min(0.8, (e.clientX - drag.containerLeft - DIVIDER_WIDTH / 2) / drag.containerWidth),
      );
      setSplitRatio(ratio);
    },
    [],
  );

  const handleSplitDividerPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = splitDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      splitDragRef.current = null;
    },
    [],
  );

  return {
    splitPaneOpen,
    focusedPane,
    secondaryPanePath,
    secondaryPaneMode,
    splitRatio,
    setSplitPaneOpen,
    setFocusedPane,
    setSecondaryPanePath,
    setSecondaryPaneMode,
    closeSecondaryPane,
    handleToggleSplitPane,
    handleOpenActiveInOtherPane,
    handleOpenTabInSplitPane,
    handleSwapPanes,
    handleSplitDividerPointerDown,
    handleSplitDividerPointerMove,
    handleSplitDividerPointerUp,
  };
}
