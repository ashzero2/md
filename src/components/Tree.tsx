// Recursive folder tree for the sidebar. Folders expand/collapse; file rows
// show the note title with tags. Plain styling for now (Phase 6 designs it).

import { useState } from "react";
import type { FileNode } from "../lib/types";

interface Props {
  nodes: FileNode[];
  activePath: string | null;
  onOpen: (path: string) => void;
}

function TreeItem({ node, depth, activePath, onOpen }: {
  node: FileNode;
  depth: number;
  activePath: string | null;
  onOpen: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const indent = { paddingLeft: `${8 + depth * 14}px` };

  if (!node.is_dir) {
    const label = node.name.replace(/\.md$/i, "");
    return (
      <li>
        <button
          className={`tree-file${activePath === node.path ? " active" : ""}`}
          style={indent}
          onClick={() => onOpen(node.path)}
          title={node.path}
        >
          {label}
        </button>
      </li>
    );
  }

  return (
    <li>
      <button
        className="tree-dir"
        style={indent}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`caret${open ? " open" : ""}`}>▸</span>
        {node.name}
      </button>
      {open && (
        <ul>
          {node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function Tree({ nodes, activePath, onOpen }: Props) {
  return (
    <ul className="tree">
      {nodes.map((node) => (
        <TreeItem
          key={node.path}
          node={node}
          depth={0}
          activePath={activePath}
          onOpen={onOpen}
        />
      ))}
    </ul>
  );
}