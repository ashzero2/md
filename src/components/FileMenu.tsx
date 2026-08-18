// Right-click context menu for a note in the file tree.

import { useEffect, useRef } from "react";

export type NoteAction =
  | "open"
  | "rename"
  | "move"
  | "delete"
  | "reveal"
  | "copy-wikilink"
  | "copy-markdown";

interface Props {
  x: number;
  y: number;
  onAction: (action: NoteAction) => void;
  onClose: () => void;
}

export default function FileMenu({ x, y, onAction, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="file-menu"
      style={{ left: x, top: y }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      <button role="menuitem" onClick={() => onAction("open")}>Open</button>
      <div className="file-menu-sep" />
      <button role="menuitem" onClick={() => onAction("copy-wikilink")}>Copy wikilink</button>
      <button role="menuitem" onClick={() => onAction("copy-markdown")}>Copy markdown link</button>
      <div className="file-menu-sep" />
      <button role="menuitem" onClick={() => onAction("rename")}>Rename…</button>
      <button role="menuitem" onClick={() => onAction("move")}>Move to folder…</button>
      <button role="menuitem" onClick={() => onAction("reveal")}>Reveal in Finder</button>
      <div className="file-menu-sep" />
      <button role="menuitem" className="danger" onClick={() => onAction("delete")}>Delete…</button>
    </div>
  );
}