// Note toolbar overflow menu: current-note utility + destructive actions.

import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";

export type NoteMenuAction =
  | "rename"
  | "move"
  | "copy-wikilink"
  | "copy-markdown"
  | "export"
  | "print"
  | "reveal"
  | "delete";

interface Props {
  disabled?: boolean;
  onAction: (action: NoteMenuAction) => void;
}

export default function NoteMenu({ disabled, onAction }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (a: NoteMenuAction) => {
    setOpen(false);
    onAction(a);
  };

  return (
    <div className="note-menu" ref={ref}>
      <button
        type="button"
        className="toolbar-button icon-only"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title="Note actions"
      >
        <MoreHorizontal size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      {open && (
        <div className="note-menu-list" role="menu">
          <button role="menuitem" onClick={() => pick("rename")}>Rename…</button>
          <button role="menuitem" onClick={() => pick("move")}>Move to folder…</button>
          <div className="file-menu-sep" />
          <button role="menuitem" onClick={() => pick("copy-wikilink")}>Copy wikilink</button>
          <button role="menuitem" onClick={() => pick("copy-markdown")}>Copy markdown link</button>
          <div className="file-menu-sep" />
          <button role="menuitem" onClick={() => pick("export")}>Export HTML…</button>
          <button role="menuitem" onClick={() => pick("print")}>Print / Save as PDF…</button>
          <button role="menuitem" onClick={() => pick("reveal")}>Reveal in Finder</button>
          <div className="file-menu-sep" />
          <button role="menuitem" className="danger" onClick={() => pick("delete")}>
            Delete…
          </button>
        </div>
      )}
    </div>
  );
}
