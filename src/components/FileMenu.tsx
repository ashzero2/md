// Right-click context menu for a note in the file tree.

import { useEffect, useRef } from "react";

export type NoteAction =
  | "open"
  | "open-split"
  | "toggle-favorite"
  | "rename"
  | "move"
  | "delete"
  | "reveal"
  | "copy-wikilink"
  | "copy-markdown";

interface Props {
  x: number;
  y: number;
  isFavorite?: boolean;
  onAction: (action: NoteAction) => void;
  onClose: () => void;
}

export default function FileMenu({ x, y, isFavorite = false, onAction, onClose }: Props) {
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
      <button role="menuitem" onClick={() => onAction("open-split")}>Open in split pane</button>
      <button role="menuitem" onClick={() => onAction("toggle-favorite")}>
        {isFavorite ? "Remove from favorites" : "Add to favorites"}
      </button>
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
