import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

export interface ContextMenuState {
  /** File-tree right-click menu */
  menu: { path: string; x: number; y: number } | null;
  setMenu: (m: { path: string; x: number; y: number } | null) => void;
  /** Tab right-click menu */
  tabMenu: { id: string; x: number; y: number } | null;
  setTabMenu: (m: { id: string; x: number; y: number } | null) => void;
  /** Tab-list overflow menu */
  tabListMenu: { x: number; y: number } | null;
  setTabListMenu: (m: { x: number; y: number } | null) => void;
  handleToggleTabListMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  /** Vault profile dropdown */
  vaultMenuOpen: boolean;
  setVaultMenuOpen: (open: boolean) => void;
  vaultMenuRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Manages all four context/dropdown menus in the app.
 * Handles close-on-outside-click and close-on-Escape for each.
 */
export function useContextMenus(): ContextMenuState {
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const [tabMenu, setTabMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [tabListMenu, setTabListMenu] = useState<{ x: number; y: number } | null>(null);
  const [vaultMenuOpen, setVaultMenuOpen] = useState(false);
  const vaultMenuRef = useRef<HTMLDivElement | null>(null);

  // Vault profile dropdown: close on outside click or Escape
  useEffect(() => {
    if (!vaultMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!vaultMenuRef.current?.contains(event.target as Node)) {
        setVaultMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setVaultMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [vaultMenuOpen]);

  // Tab context menu: close on any pointer-down or Escape
  useEffect(() => {
    if (!tabMenu) return;
    const onPointerDown = () => setTabMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTabMenu(null);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [tabMenu]);

  // Tab-list overflow menu: close on any pointer-down or Escape
  useEffect(() => {
    if (!tabListMenu) return;
    const onPointerDown = () => setTabListMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTabListMenu(null);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [tabListMenu]);

  const handleToggleTabListMenu = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setTabListMenu((current) =>
      current
        ? null
        : {
            x: Math.max(8, Math.min(rect.right - 248, window.innerWidth - 260)),
            y: rect.bottom + 6,
          },
    );
  }, []);

  return {
    menu,
    setMenu,
    tabMenu,
    setTabMenu,
    tabListMenu,
    setTabListMenu,
    handleToggleTabListMenu,
    vaultMenuOpen,
    setVaultMenuOpen,
    vaultMenuRef,
  };
}
