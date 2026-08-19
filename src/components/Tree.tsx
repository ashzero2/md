// Recursive file explorer. Folders expand/collapse; files open notes.
// Supports keyboard navigation: ArrowDown/Up move between visible items,
// ArrowRight expands a folder, ArrowLeft collapses it, Enter opens a file.

import { type CSSProperties, type KeyboardEvent, type MouseEvent, useRef, useState } from "react";
import type { FileNode } from "../lib/types";

interface Props {
  nodes: FileNode[];
  activePath: string | null;
  onOpen: (path: string, event: MouseEvent<HTMLButtonElement>) => void;
  onContext: (path: string, x: number, y: number) => void;
}

function TreeItem({ node, depth, activePath, onOpen, onContext }: {
  node: FileNode;
  depth: number;
  activePath: string | null;
  onOpen: (path: string, event: MouseEvent<HTMLButtonElement>) => void;
  onContext: (path: string, x: number, y: number) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const indent = { "--indent": `${depth * 16}px` } as CSSProperties;

  if (!node.is_dir) {
    const label = node.name.replace(/\.md$/i, "");
    return (
      <li className="tree-node tree-node-file" role="none">
        <button
          className={`tree-file${activePath === node.path ? " active" : ""}`}
          style={indent}
          role="treeitem"
          tabIndex={-1}
          onClick={(e) => onOpen(node.path, e)}
          onAuxClick={(e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            onOpen(node.path, e);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            onContext(node.path, e.clientX, e.clientY);
          }}
          title={node.path}
        >
          <span className="tree-spacer" aria-hidden="true" />
          <span className="tree-icon tree-icon-file" aria-hidden="true" />
          <span className="tree-label">{label}</span>
        </button>
      </li>
    );
  }

  return (
    <li className="tree-node tree-node-dir" role="none">
      <button
        className={`tree-dir${open ? " open" : ""}`}
        style={indent}
        role="treeitem"
        tabIndex={-1}
        data-tree-dir={open ? "open" : "closed"}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className={`caret${open ? " open" : ""}`} aria-hidden="true" />
        <span className="tree-icon tree-icon-folder" aria-hidden="true" />
        <span className="tree-label">{node.name}</span>
      </button>
      {open && (
        <ul role="group">
          {node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              onOpen={onOpen}
              onContext={onContext}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function Tree({ nodes, activePath, onOpen, onContext }: Props) {
  const rootRef = useRef<HTMLUListElement>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const root = rootRef.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLButtonElement>("button[role='treeitem']"));
    if (items.length === 0) return;

    const focused = document.activeElement as HTMLButtonElement | null;
    const idx = focused ? items.indexOf(focused) : -1;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = items[idx + 1] ?? items[0];
      next?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = items[idx - 1] ?? items[items.length - 1];
      prev?.focus();
    } else if (e.key === "ArrowRight") {
      if (focused?.dataset.treeDir === "closed") {
        e.preventDefault();
        focused.click();
      } else if (focused?.dataset.treeDir === "open") {
        // Move into the first child.
        e.preventDefault();
        const next = items[idx + 1];
        next?.focus();
      }
    } else if (e.key === "ArrowLeft") {
      if (focused?.dataset.treeDir === "open") {
        e.preventDefault();
        focused.click();
      } else {
        // Move to the closest parent dir button.
        e.preventDefault();
        for (let i = idx - 1; i >= 0; i--) {
          if (items[i]?.dataset.treeDir !== undefined) {
            items[i]?.focus();
            break;
          }
        }
      }
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  const handleFocus = () => {
    // When the tree root receives focus (e.g. via Tab), move focus to the
    // active note's button or to the first item.
    const root = rootRef.current;
    if (!root || root.contains(document.activeElement)) return;
    const items = Array.from(root.querySelectorAll<HTMLButtonElement>("button[role='treeitem']"));
    const active = items.find((b) => b.classList.contains("active")) ?? items[0];
    active?.focus();
  };

  return (
    <ul
      className="tree"
      role="tree"
      ref={rootRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      aria-label="Files"
    >
      {nodes.map((node) => (
        <TreeItem
          key={node.path}
          node={node}
          depth={0}
          activePath={activePath}
          onOpen={onOpen}
          onContext={onContext}
        />
      ))}
    </ul>
  );
}
